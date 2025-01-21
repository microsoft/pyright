/*
 * hoverProvider.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Logic that maps a position within a Python program file into
 * markdown text that is displayed when the user hovers over that
 * position within a smart editor.
 */

import { CancellationToken, Hover, MarkupKind } from 'vscode-languageserver';

import {
    Declaration,
    DeclarationType,
    VariableDeclaration,
    isUnresolvedAliasDeclaration,
} from '../analyzer/declaration';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { SourceMapper } from '../analyzer/sourceMapper';
import { SynthesizedTypeInfo } from '../analyzer/symbol';
import { isBuiltInModule } from '../analyzer/typeDocStringUtils';
import { PrintTypeOptions, TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { convertToInstance, doForEachSubtype, isMaybeDescriptorInstance } from '../analyzer/typeUtils';
import {
    ClassType,
    Type,
    TypeCategory,
    getTypeAliasInfo,
    isAnyOrUnknown,
    isClassInstance,
    isFunction,
    isModule,
    isOverloaded,
    isParamSpec,
    isTypeVar,
} from '../analyzer/types';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { SignatureDisplayType } from '../common/configOptions';
import { assertNever, fail } from '../common/debug';
import { ProgramView } from '../common/extensibility';
import { convertOffsetToPosition, convertPositionToOffset } from '../common/positionUtils';
import { ServiceProvider } from '../common/serviceProvider';
import { Position, Range, TextRange } from '../common/textRange';
import { Uri } from '../common/uri/uri';
import { ExpressionNode, NameNode, ParseNode, ParseNodeType, StringNode } from '../parser/parseNodes';
import { ParseFileResults } from '../parser/parser';
import {
    getClassAndConstructorTypes,
    getConstructorTooltip,
    getDocumentationPartsForTypeAndDecl,
    getToolTipForType,
    getTypeForToolTip,
} from './tooltipUtils';

export interface HoverTextPart {
    python?: boolean;
    text: string;
}

export interface HoverResults {
    parts: HoverTextPart[];
    range: Range;
}

export function convertHoverResults(hoverResults: HoverResults | null, format: MarkupKind): Hover | null {
    if (!hoverResults) {
        return null;
    }

    const markupString = hoverResults.parts
        .map((part) => {
            if (part.python) {
                if (format === MarkupKind.Markdown) {
                    return '```python\n' + part.text + '\n```\n';
                } else if (format === MarkupKind.PlainText) {
                    return part.text + '\n\n';
                } else {
                    fail(`Unsupported markup type: ${format}`);
                }
            }
            return part.text;
        })
        .join('')
        .trimEnd();

    return {
        contents: {
            kind: format,
            value: markupString,
        },
        range: hoverResults.range,
    };
}

export function addParameterResultsPart(
    serviceProvider: ServiceProvider,
    paramNameNode: NameNode,
    resolvedDecl: Declaration | undefined,
    format: MarkupKind,
    parts: HoverTextPart[]
) {
    // See if we have a docstring for the parent function.
    let docString: string | undefined = undefined;
    const funcNode = ParseTreeUtils.getEnclosingFunction(resolvedDecl?.node || paramNameNode);
    if (funcNode) {
        docString = ParseTreeUtils.getDocString(funcNode?.d.suite?.d.statements ?? []);
        if (docString) {
            // Compute the docstring now.
            docString = serviceProvider
                .docStringService()
                .extractParameterDocumentation(docString, paramNameNode.d.value, format);
        }
    }
    if (!docString) {
        return;
    }

    parts.push({
        python: false,
        text: docString,
    });
}

export function addDocumentationResultsPart(
    serviceProvider: ServiceProvider,
    docString: string | undefined,
    format: MarkupKind,
    parts: HoverTextPart[],
    resolvedDecl: Declaration | undefined
) {
    if (!docString) {
        return;
    }

    if (format === MarkupKind.Markdown) {
        const markDown = serviceProvider
            .docStringService()
            .convertDocStringToMarkdown(docString, isBuiltInModule(resolvedDecl?.uri));

        if (parts.length > 0 && markDown.length > 0) {
            parts.push({ text: '---\n' });
        }

        parts.push({ text: markDown, python: false });
        return;
    }

    if (format === MarkupKind.PlainText) {
        parts.push({ text: serviceProvider.docStringService().convertDocStringToPlainText(docString), python: false });
        return;
    }

    fail(`Unsupported markup type: ${format}`);
}

export function getVariableTypeText(
    evaluator: TypeEvaluator,
    declaration: VariableDeclaration | undefined,
    name: string,
    type: Type,
    typeNode: ExpressionNode,
    functionSignatureDisplay: SignatureDisplayType
) {
    let label = 'variable';
    if (declaration) {
        label = declaration.isConstant || evaluator.isFinalVariableDeclaration(declaration) ? 'constant' : 'variable';
    }

    let typeVarName: string | undefined;

    if (type.props?.typeAliasInfo && typeNode.nodeType === ParseNodeType.Name) {
        const typeAliasInfo = getTypeAliasInfo(type);
        if (typeAliasInfo?.shared.name === typeNode.d.value) {
            if (isTypeVar(type)) {
                label = isParamSpec(type) ? 'param spec' : 'type variable';
                typeVarName = type.shared.name;
            } else {
                // Handle type aliases specially.
                const typeText = evaluator.printType(convertToInstance(getTypeForToolTip(evaluator, typeNode)), {
                    expandTypeAlias: true,
                });

                return `(type) ${name} = ` + typeText;
            }
        }
    }

    if (
        type.category === TypeCategory.Function ||
        type.category === TypeCategory.Overloaded ||
        typeNode.parent?.nodeType === ParseNodeType.Call
    ) {
        return getToolTipForType(
            type,
            label,
            name,
            evaluator,
            /* isProperty */ false,
            functionSignatureDisplay,
            typeNode
        );
    }

    const typeText = typeVarName ?? name + ': ' + evaluator.printType(getTypeForToolTip(evaluator, typeNode));

    return `(${label}) ` + typeText;
}

export class HoverProvider {
    private readonly _parseResults: ParseFileResults | undefined;
    private readonly _sourceMapper: SourceMapper;

    constructor(
        private readonly _program: ProgramView,
        private readonly _fileUri: Uri,
        private readonly _position: Position,
        private readonly _format: MarkupKind,
        private readonly _token: CancellationToken
    ) {
        this._parseResults = this._program.getParseResults(this._fileUri);
        this._sourceMapper = this._program.getSourceMapper(this._fileUri, this._token, /* mapCompiled */ true);
    }

    getHover(): Hover | null {
        return convertHoverResults(this._getHoverResult(), this._format);
    }

    static getPrimaryDeclaration(declarations: Declaration[]) {
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
            return declarations[1];
        } else if (
            primaryDeclaration.type === DeclarationType.Variable &&
            declarations.length > 1 &&
            primaryDeclaration.isDefinedBySlots
        ) {
            // Slots cannot have docstrings, so pick the secondary.
            return declarations[1];
        }

        return primaryDeclaration;
    }

    private get _evaluator(): TypeEvaluator {
        return this._program.evaluator!;
    }

    private get _functionSignatureDisplay() {
        return this._program.configOptions.functionSignatureDisplay;
    }

    private _getHoverResult(): HoverResults | null {
        throwIfCancellationRequested(this._token);

        if (!this._parseResults) {
            return null;
        }

        const offset = convertPositionToOffset(this._position, this._parseResults.tokenizerOutput.lines);
        if (offset === undefined) {
            return null;
        }

        let node = ParseTreeUtils.findNodeByOffset(this._parseResults.parserOutput.parseTree, offset);
        if (node === undefined) {
            return null;
        }

        const results: HoverResults = {
            parts: [],
            range: {
                start: convertOffsetToPosition(node.start, this._parseResults.tokenizerOutput.lines),
                end: convertOffsetToPosition(TextRange.getEnd(node), this._parseResults.tokenizerOutput.lines),
            },
        };

        if (node.nodeType === ParseNodeType.Name) {
            // Handle the case where we're pointing to a "fused" keyword argument.
            // We want to display the hover information for the value expression.
            if (
                node.parent?.nodeType === ParseNodeType.Argument &&
                node.parent.d.isNameSameAsValue &&
                node.parent.d.name === node &&
                node.parent.d.valueExpr.nodeType === ParseNodeType.Name
            ) {
                node = node.parent.d.valueExpr;
            }

            const declInfo = this._evaluator.getDeclInfoForNameNode(node);
            const declarations = declInfo?.decls;

            if (declarations && declarations.length > 0) {
                const primaryDeclaration = HoverProvider.getPrimaryDeclaration(declarations);
                this._addResultsForDeclaration(results.parts, primaryDeclaration, node);
            } else if (declInfo && declInfo.synthesizedTypes.length > 0) {
                const nameNode = node;
                declInfo?.synthesizedTypes.forEach((type) => {
                    this._addResultsForSynthesizedType(results.parts, type, nameNode);
                });
                this._addDocumentationPart(results.parts, node, /* resolvedDecl */ undefined);
            } else if (!node.parent || node.parent.nodeType !== ParseNodeType.ModuleName) {
                // If we had no declaration, see if we can provide a minimal tooltip. We'll skip
                // this if it's part of a module name, since a module name part with no declaration
                // is a directory (a namespace package), and we don't want to provide any hover
                // information in that case.
                if (results.parts.length === 0) {
                    const type = this._getType(node);
                    let typeText: string;
                    if (isModule(type)) {
                        // Handle modules specially because submodules aren't associated with
                        // declarations, but we want them to be presented in the same way as
                        // the top-level module, which does have a declaration.
                        typeText = '(module) ' + node.d.value;
                    } else {
                        let label = 'function';
                        let isProperty = false;

                        if (isMaybeDescriptorInstance(type, /* requireSetter */ false)) {
                            isProperty = true;
                            label = 'property';
                        }

                        typeText = getToolTipForType(
                            type,
                            label,
                            node.d.value,
                            this._evaluator,
                            isProperty,
                            this._functionSignatureDisplay
                        );
                    }

                    this._addResultsPart(results.parts, typeText, /* python */ true);
                    this._addDocumentationPart(results.parts, node, /* resolvedDecl */ undefined);
                }
            }
        } else if (node.nodeType === ParseNodeType.String) {
            const type = this._evaluator.getExpectedType(node)?.type;
            if (type !== undefined) {
                this._tryAddPartsForTypedDictKey(node, type, results.parts);
            }
        }

        return results.parts.length > 0 ? results : null;
    }

    private _addResultsForDeclaration(parts: HoverTextPart[], declaration: Declaration, node: NameNode): void {
        const resolvedDecl =
            declaration.type === DeclarationType.Alias
                ? this._evaluator.resolveAliasDeclaration(declaration, /* resolveLocalNames */ true)
                : declaration;
        if (
            !resolvedDecl ||
            (resolvedDecl.type === DeclarationType.Alias && isUnresolvedAliasDeclaration(resolvedDecl))
        ) {
            this._addResultsPart(parts, `(import) ` + node.d.value + this._getTypeText(node), /* python */ true);
            return;
        }

        switch (resolvedDecl.type) {
            case DeclarationType.Intrinsic: {
                this._addResultsPart(parts, node.d.value + this._getTypeText(node), /* python */ true);
                this._addDocumentationPart(parts, node, resolvedDecl);
                break;
            }

            case DeclarationType.Variable: {
                // If the named node is an aliased import symbol, we can't call
                // getType on the original name because it's not in the symbol
                // table. Instead, use the node from the resolved alias.
                let typeNode: ParseNode = node;
                if (
                    declaration.node.nodeType === ParseNodeType.ImportAs ||
                    declaration.node.nodeType === ParseNodeType.ImportFromAs
                ) {
                    if (declaration.node.d.alias && node !== declaration.node.d.alias) {
                        if (resolvedDecl.node.nodeType === ParseNodeType.Name) {
                            typeNode = resolvedDecl.node;
                        }
                    }
                } else if (node.parent?.nodeType === ParseNodeType.Argument && node.parent.d.name === node) {
                    // If this is a named argument, we would normally have received a Parameter declaration
                    // rather than a variable declaration, but we can get here in the case of a dataclass.
                    // Replace the typeNode with the node of the variable declaration.
                    if (declaration.node.nodeType === ParseNodeType.Name) {
                        typeNode = declaration.node;
                    }
                }

                // Determine if this identifier is a type alias. If so, expand
                // the type alias when printing the type information.
                const type = this._getType(typeNode);
                const typeText = getVariableTypeText(
                    this._evaluator,
                    resolvedDecl,
                    node.d.value,
                    type,
                    typeNode,
                    this._functionSignatureDisplay
                );

                this._addResultsPart(parts, typeText, /* python */ true);
                this._addDocumentationPart(parts, node, resolvedDecl);
                break;
            }

            case DeclarationType.Param: {
                this._addResultsPart(parts, '(parameter) ' + node.d.value + this._getTypeText(node), /* python */ true);
                addParameterResultsPart(this._program.serviceProvider, node, resolvedDecl, this._format, parts);
                this._addDocumentationPart(parts, node, resolvedDecl);
                break;
            }

            case DeclarationType.TypeParam: {
                // If the user is hovering over a type parameter name in a class type parameter
                // list, display the computed variance of the type param.
                const typeParamListNode = ParseTreeUtils.getParentNodeOfType(node, ParseNodeType.TypeParameterList);
                const nodeType = typeParamListNode?.parent?.nodeType;
                const printTypeVarVariance = nodeType === ParseNodeType.Class || nodeType === ParseNodeType.TypeAlias;

                this._addResultsPart(
                    parts,
                    '(type parameter) ' + node.d.value + this._getTypeText(node, { printTypeVarVariance }),
                    /* python */ true
                );
                this._addDocumentationPart(parts, node, resolvedDecl);
                break;
            }

            case DeclarationType.Class:
            case DeclarationType.SpecialBuiltInClass: {
                if (this._addInitOrNewMethodInsteadIfCallNode(node, parts, resolvedDecl)) {
                    return;
                }

                const nameNode = resolvedDecl.type === DeclarationType.Class ? resolvedDecl.node.d.name : node;
                this._addResultsPart(parts, '(class) ' + nameNode.d.value, /* python */ true);
                this._addDocumentationPart(parts, node, resolvedDecl);
                break;
            }

            case DeclarationType.Function: {
                let label = 'function';
                let isProperty = false;
                if (resolvedDecl.isMethod) {
                    const declaredType = this._evaluator.getTypeForDeclaration(resolvedDecl)?.type;
                    isProperty = !!declaredType && isMaybeDescriptorInstance(declaredType, /* requireSetter */ false);
                    label = isProperty ? 'property' : 'method';
                }

                let type = this._getType(node);
                const resolvedType = this._getType(resolvedDecl.node.d.name);
                type = isAnyOrUnknown(type) ? resolvedType : type;
                const signatureString = getToolTipForType(
                    type,
                    label,
                    node.d.value,
                    this._evaluator,
                    isProperty,
                    this._functionSignatureDisplay
                );

                this._addResultsPart(parts, signatureString, /* python */ true);
                this._addDocumentationPart(parts, node, resolvedDecl);
                break;
            }

            case DeclarationType.Alias: {
                // First the 'module' header.
                this._addResultsPart(parts, '(module) ' + node.d.value, /* python */ true);
                this._addDocumentationPart(parts, node, resolvedDecl);
                break;
            }

            case DeclarationType.TypeAlias: {
                const type = convertToInstance(this._getType(node));
                const typeText = this._evaluator.printType(type, { expandTypeAlias: true });
                this._addResultsPart(parts, `(type) ${node.d.value} = ${typeText}`, /* python */ true);
                this._addDocumentationPart(parts, node, resolvedDecl);
                break;
            }

            default:
                assertNever(resolvedDecl);
        }
    }

    private _addResultsForSynthesizedType(parts: HoverTextPart[], typeInfo: SynthesizedTypeInfo, hoverNode: NameNode) {
        let typeText: string | undefined;

        if (isModule(typeInfo.type)) {
            typeText = '(module) ' + hoverNode.d.value;
        } else {
            const node = typeInfo.node ?? hoverNode;

            const type = this._getType(node);
            typeText = getVariableTypeText(
                this._evaluator,
                /* declaration */ undefined,
                node.d.value,
                type,
                node,
                this._functionSignatureDisplay
            );
        }

        if (typeText) {
            this._addResultsPart(parts, typeText, /* python */ true);
        }
    }

    private _tryAddPartsForTypedDictKey(node: StringNode, type: Type, parts: HoverTextPart[]) {
        // If the expected type is a TypedDict and the current node is a key entry then we can provide a tooltip
        // with the type of the TypedDict key and its docstring, if available.
        doForEachSubtype(type, (subtype) => {
            if (isClassInstance(subtype) && ClassType.isTypedDictClass(subtype)) {
                const entry = subtype.shared.typedDictEntries?.knownItems.get(node.d.value);
                if (entry) {
                    // If we have already added parts for another declaration (e.g. for a union of TypedDicts that share the same key)
                    // then we need to add a separator to prevent a visual bug.
                    if (parts.length > 0) {
                        parts.push({ text: '\n\n---\n' });
                    }

                    // e.g. (key) name: str
                    const text = '(key) ' + node.d.value + ': ' + this._evaluator.printType(entry.valueType);
                    this._addResultsPart(parts, text, /* python */ true);

                    const declarations = ClassType.getSymbolTable(subtype).get(node.d.value)?.getDeclarations();
                    if (declarations !== undefined && declarations?.length !== 0) {
                        // As we are just interested in the docString we don't have to worry about
                        // anything other than the first declaration. There also shouldn't be more
                        // than one declaration for a TypedDict key variable.
                        const declaration = declarations[0];
                        if (declaration.type === DeclarationType.Variable && declaration.docString !== undefined) {
                            this._addDocumentationPartForType(parts, subtype, declaration);
                        }
                    }
                }
            }
        });
    }

    private _addInitOrNewMethodInsteadIfCallNode(node: NameNode, parts: HoverTextPart[], declaration: Declaration) {
        const result = getClassAndConstructorTypes(node, this._evaluator);
        if (!result) {
            return false;
        }

        if (result.methodType && (isFunction(result.methodType) || isOverloaded(result.methodType))) {
            this._addResultsPart(
                parts,
                getConstructorTooltip(node.d.value, result.methodType, this._evaluator, this._functionSignatureDisplay),
                /* python */ true
            );

            const addedDoc = this._addDocumentationPartForType(parts, result.methodType, declaration);

            if (!addedDoc) {
                this._addDocumentationPartForType(parts, result.classType, declaration);
            }
            return true;
        }
        return false;
    }

    private _getType(node: ExpressionNode) {
        // It does common work necessary for hover for a type we got
        // from raw type evaluator.
        return getTypeForToolTip(this._evaluator, node);
    }

    private _getTypeText(node: ExpressionNode, options?: PrintTypeOptions): string {
        const type = this._getType(node);
        return ': ' + this._evaluator.printType(type, options);
    }

    private _addDocumentationPart(parts: HoverTextPart[], node: NameNode, resolvedDecl: Declaration | undefined) {
        const type = this._getType(node);
        this._addDocumentationPartForType(parts, type, resolvedDecl, node.d.value);
    }

    private _addDocumentationPartForType(
        parts: HoverTextPart[],
        type: Type | undefined,
        resolvedDecl: Declaration | undefined,
        name?: string
    ): boolean {
        const docString = getDocumentationPartsForTypeAndDecl(this._sourceMapper, type, resolvedDecl, this._evaluator, {
            name,
        });

        addDocumentationResultsPart(this._program.serviceProvider, docString, this._format, parts, resolvedDecl);
        return !!docString;
    }

    private _addResultsPart(parts: HoverTextPart[], text: string, python = false) {
        parts.push({
            python,
            text,
        });
    }
}
