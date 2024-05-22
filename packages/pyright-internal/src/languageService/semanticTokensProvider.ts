import { Position, SemanticTokensBuilder } from 'vscode-languageserver';
import { CancellationToken, SemanticTokens } from 'vscode-languageserver-protocol';

import { Declaration, DeclarationType, isUnresolvedAliasDeclaration } from '../analyzer/declaration';
import { isDeclInEnumClass } from '../analyzer/enums';
import { getEnclosingClass } from '../analyzer/parseTreeUtils';
import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { isMaybeDescriptorInstance } from '../analyzer/typeUtils';
import {
    ClassType,
    FunctionType,
    TypeCategory,
    UnknownType,
    getTypeAliasInfo,
    isModule,
    isTypeVar,
} from '../analyzer/types';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { assertNever } from '../common/debug';
import { ProgramView } from '../common/extensibility';
import { convertOffsetToPosition } from '../common/positionUtils';
import { TextRange } from '../common/textRange';
import { Uri } from '../common/uri/uri';
import { FunctionNode, NameNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { ParseFileResults } from '../parser/parser';

enum TokenType {
    namespace,
    type,
    class,
    enum,
    interface,
    struct,
    typeParameter,
    parameter,
    variable,
    property,
    enumMember,
    event,
    function,
    method,
    macro,
    keyword,
    modifier,
    comment,
    string,
    number,
    regexp,
    operator,
    decorator,
}

enum TokenModifier {
    declaration,
    definition,
    readonly,
    static,
    deprecated,
    abstract,
    async,
    modification,
    documentation,
    defaultLibrary,
}

class TokenModifiers {
    private _repr = 0;

    add(modifier: TokenModifier) {
        this._repr |= 1 << modifier;
    }

    repr(): number {
        return this._repr;
    }
}

class SemanticTokensTreeWalker extends ParseTreeWalker {
    constructor(
        private _builder: SemanticTokensBuilder,
        private _parseResults: ParseFileResults,
        private _evaluator: TypeEvaluator,
        private _cancellationToken: CancellationToken
    ) {
        super();
    }

    findSemanticTokens() {
        this.walk(this._parseResults.parserOutput.parseTree);
    }

    override visitName(node: NameNode): boolean {
        throwIfCancellationRequested(this._cancellationToken);

        const declarations = this._evaluator.getDeclarationsForNameNode(node);
        if (declarations && declarations.length > 0) {
            // In most cases, it's best to treat the first declaration as the
            // "primary". This works well for properties that have setters
            // which often have doc strings on the getter but not the setter.
            // The one case where using the first declaration doesn't work as
            // well is the case where an import statement within an __init__.py
            // file uses the form "from .A import A". In this case, if we use
            // the first declaration, it will show up as a module rather than
            // the imported symbol type.
            const primaryDeclaration = declarations[0];
            if (primaryDeclaration.type === DeclarationType.Alias && declarations.length > 1) {
                return this._addResultsForDeclaration(declarations[1], node);
            } else if (
                primaryDeclaration.type === DeclarationType.Variable &&
                declarations.length > 1 &&
                primaryDeclaration.isDefinedBySlots
            ) {
                // Slots cannot have docstrings, so pick the secondary.
                return this._addResultsForDeclaration(declarations[1], node);
            }

            return this._addResultsForDeclaration(primaryDeclaration, node);
        } else if (!node.parent || node.parent.nodeType !== ParseNodeType.ModuleName) {
            const type = this._evaluator.getType(node) ?? UnknownType.create();
            let tokenType: TokenType;
            if (isModule(type)) {
                // Handle modules specially because submodules aren't associated with
                // declarations, but we want them to be presented in the same way as
                // the top-level module, which does have a declaration.
                tokenType = TokenType.namespace;
            } else {
                const isProperty = isMaybeDescriptorInstance(type, /* requireSetter */ false);
                tokenType = isProperty ? TokenType.property : TokenType.function;
            }

            const start = convertOffsetToPosition(node.start, this._parseResults.tokenizerOutput.lines);
            const end = convertOffsetToPosition(TextRange.getEnd(node), this._parseResults.tokenizerOutput.lines);
            SemanticTokensTreeWalker._push(this._builder, start, end, tokenType, new TokenModifiers());
        }

        return false;
    }

    private _addResultsForDeclaration(declaration: Declaration, node: NameNode): boolean {
        const start = convertOffsetToPosition(node.start, this._parseResults.tokenizerOutput.lines);
        const end = convertOffsetToPosition(TextRange.getEnd(node), this._parseResults.tokenizerOutput.lines);

        const resolvedDecl = this._evaluator.resolveAliasDeclaration(declaration, /* resolveLocalNames */ true);
        if (!resolvedDecl || isUnresolvedAliasDeclaration(resolvedDecl)) {
            // import
            return true;
        }

        let declarationType: TokenType | null = null;
        const declarationModifiers = new TokenModifiers();
        switch (resolvedDecl.type) {
            case DeclarationType.Intrinsic: {
                switch (resolvedDecl.intrinsicType) {
                    case 'str':
                    case 'str | None':
                    case 'int':
                    case 'Iterable[str]':
                    case 'Dict[str, Any]': {
                        declarationType = TokenType.variable;
                        break;
                    }
                    case 'class': {
                        declarationType = TokenType.class;
                        break;
                    }
                }
                break;
            }

            case DeclarationType.Variable: {
                if (resolvedDecl.isConstant || this._evaluator.isFinalVariableDeclaration(resolvedDecl)) {
                    declarationModifiers.add(TokenModifier.readonly);
                }

                // If the named node is an aliased import symbol, we can't call
                // getType on the original name because it's not in the symbol
                // table. Instead, use the node from the resolved alias.
                let typeNode: ParseNode = node;
                if (
                    declaration.node.nodeType === ParseNodeType.ImportAs ||
                    declaration.node.nodeType === ParseNodeType.ImportFromAs
                ) {
                    if (declaration.node.alias && node !== declaration.node.alias) {
                        if (resolvedDecl.node.nodeType === ParseNodeType.Name) {
                            typeNode = resolvedDecl.node;
                        }
                    }
                } else if (node.parent?.nodeType === ParseNodeType.Argument && node.parent.name === node) {
                    // If this is a named argument, we would normally have received a Parameter declaration
                    // rather than a variable declaration, but we can get here in the case of a dataclass.
                    // Replace the typeNode with the node of the variable declaration.
                    if (declaration.node.nodeType === ParseNodeType.Name) {
                        typeNode = declaration.node;
                    }
                }

                if (declaration.type === DeclarationType.Variable && isDeclInEnumClass(this._evaluator, declaration)) {
                    declarationType = TokenType.enumMember;
                    break;
                }

                // Determine if this identifier is a type alias. If so, expand
                // the type alias when printing the type information.
                const type = this._evaluator.getType(typeNode);

                if (type?.typeAliasInfo && typeNode.nodeType === ParseNodeType.Name) {
                    const typeAliasInfo = getTypeAliasInfo(type);
                    if (typeAliasInfo?.name === typeNode.value) {
                        if (isTypeVar(type)) {
                            declarationType = TokenType.typeParameter;
                        } else {
                            declarationType = TokenType.type;
                        }
                        break;
                    }
                }

                // Determine if this is a variable that has been declared in a class,
                // i.e. a class or member variable, and mark it as a property
                if (getEnclosingClass(declaration.node, /*stopAtFunction*/ true)) {
                    declarationType = TokenType.property;
                    break;
                }

                // Handle the case where type is a function and was assigned to a variable.
                if (type?.category === TypeCategory.Function || type?.category === TypeCategory.OverloadedFunction) {
                    declarationType = TokenType.function;
                }

                declarationType = TokenType.variable;
                break;
            }

            case DeclarationType.Parameter: {
                declarationType = TokenType.parameter;
                break;
            }

            case DeclarationType.TypeParameter: {
                declarationType = TokenType.typeParameter;
                break;
            }

            case DeclarationType.Class:
            case DeclarationType.SpecialBuiltInClass: {
                if (SemanticTokensTreeWalker._isDecorator(node)) {
                    declarationType = TokenType.decorator;
                    break;
                }

                const classNode = node.parent;
                if (classNode && classNode.nodeType === ParseNodeType.Class) {
                    const classTypeResult = this._evaluator.getTypeOfClass(classNode);
                    const classType = classTypeResult?.classType;
                    if (classType && ClassType.isEnumClass(classType)) {
                        declarationType = TokenType.enum;
                        break;
                    }
                }

                declarationType = TokenType.class;
                break;
            }

            case DeclarationType.Function: {
                if (SemanticTokensTreeWalker._isDecorator(node)) {
                    declarationType = TokenType.decorator;
                    break;
                }

                SemanticTokensTreeWalker._functionMods(this._evaluator, resolvedDecl.node, declarationModifiers);
                if (resolvedDecl.isMethod) {
                    const declaredType = this._evaluator.getTypeForDeclaration(resolvedDecl)?.type;
                    const isProperty =
                        !!declaredType && isMaybeDescriptorInstance(declaredType, /* requireSetter */ false);
                    declarationType = isProperty ? TokenType.property : TokenType.method;
                    break;
                }

                declarationType = TokenType.function;
                break;
            }

            case DeclarationType.Alias: {
                declarationType = TokenType.namespace;
                break;
            }

            case DeclarationType.TypeAlias: {
                declarationType = TokenType.type;
                break;
            }

            default:
                assertNever(resolvedDecl);
        }

        if (declarationType !== null) {
            SemanticTokensTreeWalker._push(this._builder, start, end, declarationType, declarationModifiers);
        }

        return true;
    }

    private static _isDecorator(startNode: ParseNode): boolean {
        let node: ParseNode | undefined = startNode;
        while (node) {
            if (node.nodeType === ParseNodeType.Decorator) {
                return true;
            }
            node = node.parent;
        }
        return false;
    }

    private static _functionMods(evaluator: TypeEvaluator, functionNode: FunctionNode, mods: TokenModifiers) {
        const functionTypeResult = evaluator.getTypeOfFunction(functionNode);
        if (functionTypeResult) {
            const functionType = functionTypeResult.functionType;
            if (FunctionType.isStaticMethod(functionType)) {
                mods.add(TokenModifier.static);
            }
        }
    }

    private static _push(
        builder: SemanticTokensBuilder,
        start: Position,
        end: Position,
        declarationType: TokenType,
        declarationModifiers: TokenModifiers
    ) {
        builder.push(
            start.line,
            start.character,
            end.character - start.character,
            declarationType,
            declarationModifiers.repr()
        );
    }
}

export class SemanticTokensProvider {
    static tokenTypes: string[] = Object.values(TokenType).filter(this._filterTypes);
    static tokenModifiers: string[] = Object.values(TokenModifier).filter(this._fiterMods);

    static tokenTypeIndices = new Map(
        SemanticTokensProvider.tokenTypes.map((t) => [t, SemanticTokensProvider.tokenTypes.indexOf(t)])
    );
    static tokenModifierIndices = new Map(
        SemanticTokensProvider.tokenModifiers.map((t) => [t, SemanticTokensProvider.tokenModifiers.indexOf(t)])
    );

    private readonly _parseResults: ParseFileResults | undefined;

    constructor(private _program: ProgramView, private _fileUri: Uri, private _token: CancellationToken) {
        this._parseResults = this._program.getParseResults(this._fileUri);
    }

    getSemanticTokens(): SemanticTokens | undefined {
        throwIfCancellationRequested(this._token);
        if (!this._parseResults) {
            return undefined;
        }

        const evaluator = this._program.evaluator;
        if (!evaluator) {
            return undefined;
        }

        const builder = new SemanticTokensBuilder();
        new SemanticTokensTreeWalker(builder, this._parseResults, evaluator, this._token).findSemanticTokens();
        return builder.build();
    }

    private static _filterTypes(shape: TokenType | string): shape is string {
        return typeof shape === 'string';
    }
    private static _fiterMods(shape: TokenModifier | string): shape is string {
        return typeof shape === 'string';
    }
}
