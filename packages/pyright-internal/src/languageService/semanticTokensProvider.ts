import { Position, SemanticTokensBuilder } from 'vscode-languageserver';
import { CancellationToken, SemanticTokens } from 'vscode-languageserver-protocol';

import { Declaration, DeclarationType } from '../analyzer/declaration';
import { isDeclInEnumClass } from '../analyzer/enums';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { ClassType, FunctionType, getTypeAliasInfo, isTypeVar, TypeCategory } from '../analyzer/types';
import { isMaybeDescriptorInstance } from '../analyzer/typeUtils';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { assertNever } from '../common/debug';
import { ProgramView } from '../common/extensibility';
import { convertOffsetToPosition } from '../common/positionUtils';
import { TextRange } from '../common/textRange';
import { FunctionNode, isExpressionNode, NameNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';

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
        private _parseResults: ParseResults,
        private _evaluator: TypeEvaluator,
        private _cancellationToken: CancellationToken
    ) {
        super();
    }

    findSemanticTokens() {
        this.walk(this._parseResults.parseTree);
    }

    override visitName(node: NameNode): boolean {
        throwIfCancellationRequested(this._cancellationToken);

        const primaryDeclaration = SemanticTokensTreeWalker._getPrimaryDeclaration(
            node,
            this._evaluator,
            this._cancellationToken
        );

        if (primaryDeclaration) {
            return SemanticTokensTreeWalker._addResultsForDeclaration(
                primaryDeclaration,
                node,
                this._builder,
                this._parseResults,
                this._evaluator
            );
        }

        return false;
    }

    private static _addResultsForDeclaration(
        declaration: Declaration,
        node: NameNode,
        builder: SemanticTokensBuilder,
        parseResults: ParseResults,
        evaluator: TypeEvaluator
    ): boolean {
        const start = convertOffsetToPosition(node.start, parseResults.tokenizerOutput.lines);
        const end = convertOffsetToPosition(TextRange.getEnd(node), parseResults.tokenizerOutput.lines);

        const resolvedDecl = evaluator.resolveAliasDeclaration(declaration, /* resolveLocalNames */ true);
        if (!resolvedDecl) {
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
                if (resolvedDecl.isConstant || evaluator.isFinalVariableDeclaration(resolvedDecl)) {
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

                if (declaration.type === DeclarationType.Variable && isDeclInEnumClass(evaluator, declaration)) {
                    declarationType = TokenType.enumMember;
                    break;
                }

                // Determine if this identifier is a type alias. If so, expand
                // the type alias when printing the type information.
                let type = evaluator.getType(typeNode);

                // We may have more type information in the alternativeTypeNode. Use that if it's better.
                if (
                    (!type || type.category === TypeCategory.Unknown) &&
                    resolvedDecl.alternativeTypeNode &&
                    isExpressionNode(resolvedDecl.alternativeTypeNode)
                ) {
                    const inferredType = evaluator.getType(resolvedDecl.alternativeTypeNode);
                    if (inferredType && inferredType.category !== TypeCategory.Unknown) {
                        type = inferredType;
                        typeNode = resolvedDecl.alternativeTypeNode;
                    }
                }

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
                if (ParseTreeUtils.getEnclosingClass(declaration.node, /*stopAtFunction*/ true)) {
                    declarationType = TokenType.property;
                    break;
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
                if (this._isDecorator(node)) {
                    declarationType = TokenType.decorator;
                    break;
                }

                const classNode = node.parent;
                if (classNode && classNode.nodeType === ParseNodeType.Class) {
                    const classTypeResult = evaluator.getTypeOfClass(classNode);
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
                if (this._isDecorator(node)) {
                    declarationType = TokenType.decorator;
                    break;
                }

                this._functionMods(evaluator, resolvedDecl.node, declarationModifiers);
                if (resolvedDecl.isMethod) {
                    // Handle properties separately
                    const declaredType = evaluator.getTypeForDeclaration(resolvedDecl)?.type;
                    declarationType =
                        declaredType && isMaybeDescriptorInstance(declaredType, /*requireSetter*/ false)
                            ? TokenType.property
                            : TokenType.method;
                } else {
                    declarationType = TokenType.function;
                }
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
            this._push(builder, start, end, declarationType, declarationModifiers);
        }

        return true;
    }

    private static _getPrimaryDeclaration(
        node: NameNode,
        evaluator: TypeEvaluator,
        token: CancellationToken
    ): Declaration | undefined {
        const declarations: Declaration[] | undefined = evaluator.getDeclarationsForNameNode(node);
        if (declarations && declarations.length > 0) {
            // In most cases, it's best to treat the first declaration as the
            // "primary". This works well for properties that have setters
            // which often have doc strings on the getter but not the setter.
            // The one case where using the first declaration doesn't work as
            // well is the case where an import statement within an __init__.py
            // file uses the form "from .A import A". In this case, if we use
            // the first declaration, it will show up as a module rather than
            // the imported symbol type.
            let primaryDeclaration = declarations[0];
            if (primaryDeclaration.type === DeclarationType.Alias && declarations.length > 1) {
                primaryDeclaration = declarations[1];
            } else if (
                primaryDeclaration.type === DeclarationType.Variable &&
                declarations.length > 1 &&
                primaryDeclaration.isDefinedBySlots
            ) {
                // Slots cannot have docstrings, so pick the secondary.
                primaryDeclaration = declarations[1];
            }
            return primaryDeclaration;
        }
        return undefined;
    }

    private static _isDecorator(startNode: ParseNode): boolean {
        let isDecorator = false;
        let node: ParseNode | undefined = startNode;
        while (node) {
            if (node.nodeType === ParseNodeType.Decorator) {
                isDecorator = true;
                break;
            }
            node = node.parent;
        }
        return isDecorator;
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

    static getSemanticTokens(
        program: ProgramView,
        filePath: string,
        token: CancellationToken
    ): SemanticTokens | undefined {
        const parseResults = program.getParseResults(filePath);
        if (!parseResults) {
            return undefined;
        }

        const evaluator = program.evaluator;
        if (!evaluator) {
            return undefined;
        }

        const builder = new SemanticTokensBuilder();
        new SemanticTokensTreeWalker(builder, parseResults, evaluator, token).findSemanticTokens();
        return builder.build();
    }

    private static _filterTypes(shape: TokenType | string): shape is string {
        return typeof shape === 'string';
    }
    private static _fiterMods(shape: TokenModifier | string): shape is string {
        return typeof shape === 'string';
    }
}
