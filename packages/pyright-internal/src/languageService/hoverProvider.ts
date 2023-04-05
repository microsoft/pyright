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

import { Declaration, DeclarationType } from '../analyzer/declaration';
import { convertDocStringToMarkdown, convertDocStringToPlainText } from '../analyzer/docStringConversion';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { SourceMapper } from '../analyzer/sourceMapper';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import {
    ClassType,
    FunctionType,
    getTypeAliasInfo,
    isAnyOrUnknown,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    isModule,
    isOverloadedFunction,
    isTypeVar,
    isUnknown,
    OverloadedFunctionType,
    Type,
    UnknownType,
} from '../analyzer/types';
import {
    ClassMemberLookupFlags,
    doForEachSubtype,
    isMaybeDescriptorInstance,
    lookUpClassMember,
} from '../analyzer/typeUtils';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { SignatureDisplayType } from '../common/configOptions';
import { assertNever, fail } from '../common/debug';
import { DeclarationUseCase, Extensions } from '../common/extensibility';
import { convertOffsetToPosition, convertPositionToOffset } from '../common/positionUtils';
import { hashString } from '../common/stringUtils';
import { Position, Range } from '../common/textRange';
import { TextRange } from '../common/textRange';
import { ExpressionNode, isExpressionNode, NameNode, ParseNode, ParseNodeType, StringNode } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import {
    combineExpressionTypes,
    getConstructorTooltip,
    getDocumentationPartsForTypeAndDecl,
    getToolTipForType,
} from './tooltipUtils';

export interface HoverTextPart {
    python?: boolean;
    text: string;
}

export interface HoverResults {
    parts: HoverTextPart[];
    lastKnownModule?: string;
    range: Range;
}

export class HoverProvider {
    static getHoverForPosition(
        sourceMapper: SourceMapper,
        parseResults: ParseResults,
        position: Position,
        format: MarkupKind,
        evaluator: TypeEvaluator,
        functionSignatureDisplay: SignatureDisplayType,
        token: CancellationToken
    ): HoverResults | undefined {
        throwIfCancellationRequested(token);

        const offset = convertPositionToOffset(position, parseResults.tokenizerOutput.lines);
        if (offset === undefined) {
            return undefined;
        }

        const node = ParseTreeUtils.findNodeByOffset(parseResults.parseTree, offset);
        if (node === undefined) {
            return undefined;
        }

        const results: HoverResults = {
            parts: [],
            range: {
                start: convertOffsetToPosition(node.start, parseResults.tokenizerOutput.lines),
                end: convertOffsetToPosition(TextRange.getEnd(node), parseResults.tokenizerOutput.lines),
            },
        };

        if (node.nodeType === ParseNodeType.Name) {
            // First give extensions a crack at getting a declaration.
            let declarations: Declaration[] | undefined = Extensions.getProgramExtensions(node)
                .map(
                    (e) =>
                        e.declarationProviderExtension?.tryGetDeclarations(
                            evaluator,
                            node,
                            DeclarationUseCase.Definition,
                            token
                        ) || []
                )
                .flat();
            if (declarations.length === 0) {
                declarations = evaluator.getDeclarationsForNameNode(node);
            }
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

                this._addResultsForDeclaration(
                    format,
                    sourceMapper,
                    results.parts,
                    primaryDeclaration,
                    node,
                    evaluator,
                    functionSignatureDisplay,
                    token
                );

                // Add the lastKnownModule for this declaration. We'll use this
                // in telemetry for hover.
                results.lastKnownModule = primaryDeclaration.moduleName;
            } else if (!node.parent || node.parent.nodeType !== ParseNodeType.ModuleName) {
                // If we had no declaration, see if we can provide a minimal tooltip. We'll skip
                // this if it's part of a module name, since a module name part with no declaration
                // is a directory (a namespace package), and we don't want to provide any hover
                // information in that case.
                if (results.parts.length === 0) {
                    const type = this._getType(evaluator, node);
                    let typeText: string;
                    if (isModule(type)) {
                        // Handle modules specially because submodules aren't associated with
                        // declarations, but we want them to be presented in the same way as
                        // the top-level module, which does have a declaration.
                        typeText = '(module) ' + node.value;
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
                            node.value,
                            evaluator,
                            isProperty,
                            functionSignatureDisplay
                        );
                    }

                    this._addResultsPart(results.parts, typeText, /* python */ true);
                    this._addDocumentationPart(
                        format,
                        sourceMapper,
                        results.parts,
                        node,
                        evaluator,
                        /* resolvedDecl */ undefined
                    );
                }
            }
        } else if (node.nodeType === ParseNodeType.String) {
            const type = evaluator.getExpectedType(node)?.type;
            if (type !== undefined) {
                this._tryAddPartsForTypedDictKey(format, sourceMapper, evaluator, node, type, results.parts);
            }
        }

        return results.parts.length > 0 ? results : undefined;
    }

    private static _addResultsForDeclaration(
        format: MarkupKind,
        sourceMapper: SourceMapper,
        parts: HoverTextPart[],
        declaration: Declaration,
        node: NameNode,
        evaluator: TypeEvaluator,
        functionSignatureDisplay: SignatureDisplayType,
        token: CancellationToken
    ): void {
        const resolvedDecl = evaluator.resolveAliasDeclaration(declaration, /* resolveLocalNames */ true);
        if (!resolvedDecl) {
            this._addResultsPart(
                parts,
                `(import) ` + node.value + this._getTypeText(node, evaluator),
                /* python */ true
            );
            return;
        }

        switch (resolvedDecl.type) {
            case DeclarationType.Intrinsic: {
                this._addResultsPart(parts, node.value + this._getTypeText(node, evaluator), /* python */ true);
                this._addDocumentationPart(format, sourceMapper, parts, node, evaluator, resolvedDecl);
                break;
            }

            case DeclarationType.Variable: {
                let label =
                    resolvedDecl.isConstant || evaluator.isFinalVariableDeclaration(resolvedDecl)
                        ? 'constant'
                        : 'variable';

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

                // Determine if this identifier is a type alias. If so, expand
                // the type alias when printing the type information.
                let type = this._getType(evaluator, typeNode);

                // We may have more type information in the alternativeTypeNode. Use that if it's better.
                if (
                    isUnknown(type) &&
                    resolvedDecl.alternativeTypeNode &&
                    isExpressionNode(resolvedDecl.alternativeTypeNode)
                ) {
                    const inferredType = this._getType(evaluator, resolvedDecl.alternativeTypeNode);
                    if (!isUnknown(inferredType)) {
                        type = inferredType;
                        typeNode = resolvedDecl.alternativeTypeNode;
                    }
                }

                let expandTypeAlias = false;
                let typeVarName: string | undefined;
                if (type.typeAliasInfo && typeNode.nodeType === ParseNodeType.Name) {
                    const typeAliasInfo = getTypeAliasInfo(type);
                    if (typeAliasInfo?.name === typeNode.value) {
                        if (isTypeVar(type)) {
                            label = type.details.isParamSpec ? 'param spec' : 'type variable';
                            typeVarName = type.details.name;
                        } else {
                            expandTypeAlias = true;
                            label = 'type alias';
                        }
                    }
                }

                const typeText = typeVarName || node.value + this._getTypeText(typeNode, evaluator, expandTypeAlias);
                this._addResultsPart(parts, `(${label}) ${typeText}`, /* python */ true);
                this._addDocumentationPart(format, sourceMapper, parts, node, evaluator, resolvedDecl);
                break;
            }

            case DeclarationType.Parameter: {
                if (resolvedDecl.inferredName && resolvedDecl.inferredTypeNodes) {
                    this._addResultsPart(
                        parts,
                        '(parameter) ' +
                            resolvedDecl.inferredName +
                            this._getTypesText(resolvedDecl.inferredTypeNodes, evaluator),
                        /* python */ true
                    );
                } else {
                    this._addResultsPart(
                        parts,
                        '(parameter) ' + node.value + this._getTypeText(node, evaluator),
                        /* python */ true
                    );
                }
                if (resolvedDecl.docString) {
                    this._addResultsPart(parts, resolvedDecl.docString);
                }
                this._addDocumentationPart(format, sourceMapper, parts, node, evaluator, resolvedDecl);
                break;
            }

            case DeclarationType.TypeParameter: {
                this._addResultsPart(
                    parts,
                    '(type parameter) ' + node.value + this._getTypeText(node, evaluator),
                    /* python */ true
                );
                this._addDocumentationPart(format, sourceMapper, parts, node, evaluator, resolvedDecl);
                break;
            }

            case DeclarationType.Class:
            case DeclarationType.SpecialBuiltInClass: {
                const nameNode = resolvedDecl.type === DeclarationType.Class ? resolvedDecl.node.name : node;
                if (
                    this._addInitOrNewMethodInsteadIfCallNode(
                        format,
                        node,
                        evaluator,
                        parts,
                        sourceMapper,
                        resolvedDecl,
                        functionSignatureDisplay
                    )
                ) {
                    return;
                }

                this._addResultsPart(parts, '(class) ' + nameNode.value, /* python */ true);
                this._addDocumentationPart(format, sourceMapper, parts, node, evaluator, resolvedDecl);
                break;
            }

            case DeclarationType.Function: {
                let label = 'function';
                let isProperty = false;
                if (resolvedDecl.isMethod) {
                    const declaredType = evaluator.getTypeForDeclaration(resolvedDecl)?.type;
                    isProperty = !!declaredType && isMaybeDescriptorInstance(declaredType, /* requireSetter */ false);
                    label = isProperty ? 'property' : 'method';
                }

                let type = this._getType(evaluator, node);
                const resolvedType =
                    Extensions.getProgramExtensions(resolvedDecl.node)
                        .map((e) =>
                            e.typeProviderExtension?.tryGetFunctionNodeType(resolvedDecl.node, evaluator, token)
                        )
                        .find((t) => !!t) || this._getType(evaluator, resolvedDecl.node.name);
                type = isAnyOrUnknown(type) ? resolvedType : type;
                const signatureString = getToolTipForType(
                    type,
                    label,
                    node.value,
                    evaluator,
                    isProperty,
                    functionSignatureDisplay
                );

                this._addResultsPart(parts, signatureString, /* python */ true);
                this._addDocumentationPart(format, sourceMapper, parts, node, evaluator, resolvedDecl);
                break;
            }

            case DeclarationType.Alias: {
                // First the 'module' header.
                this._addResultsPart(parts, '(module) ' + node.value, /* python */ true);
                this._addDocumentationPart(format, sourceMapper, parts, node, evaluator, resolvedDecl);
                break;
            }

            case DeclarationType.TypeAlias: {
                const typeText = node.value + this._getTypeText(node, evaluator, /* expandTypeAlias */ true);
                this._addResultsPart(parts, `(type alias) ${typeText}`, /* python */ true);
                this._addDocumentationPart(format, sourceMapper, parts, node, evaluator, resolvedDecl);
                break;
            }

            default:
                assertNever(resolvedDecl);
        }
    }

    private static _tryAddPartsForTypedDictKey(
        format: MarkupKind,
        sourceMapper: SourceMapper,
        evaluator: TypeEvaluator,
        node: StringNode,
        type: Type,
        parts: HoverTextPart[]
    ) {
        // If the expected type is a TypedDict and the current node is a key entry then we can provide a tooltip
        // with the type of the TypedDict key and its docstring, if available.
        doForEachSubtype(type, (subtype) => {
            if (isClassInstance(subtype) && ClassType.isTypedDictClass(subtype)) {
                const entry = subtype.details.typedDictEntries?.get(node.value);
                if (entry) {
                    // If we have already added parts for another declaration (e.g. for a union of TypedDicts that share the same key)
                    // then we need to add a separator to prevent a visual bug.
                    if (parts.length > 0) {
                        parts.push({ text: '\n\n---\n' });
                    }

                    // e.g. (key) name: str
                    const text = '(key) ' + node.value + ': ' + evaluator.printType(entry.valueType);
                    this._addResultsPart(parts, text, /* python */ true);

                    const declarations = subtype.details.fields.get(node.value)?.getDeclarations();
                    if (declarations !== undefined && declarations?.length !== 0) {
                        // As we are just interested in the docString we don't have to worry about
                        // anything other than the first declaration. There also shouldn't be more
                        // than one declaration for a TypedDict key variable.
                        const declaration = declarations[0];
                        if (declaration.type === DeclarationType.Variable && declaration.docString !== undefined) {
                            this._addDocumentationPartForType(
                                format,
                                sourceMapper,
                                parts,
                                subtype,
                                declaration,
                                evaluator
                            );
                        }
                    }
                }
            }
        });
    }

    private static _addInitOrNewMethodInsteadIfCallNode(
        format: MarkupKind,
        node: NameNode,
        evaluator: TypeEvaluator,
        parts: HoverTextPart[],
        sourceMapper: SourceMapper,
        declaration: Declaration,
        functionSignatureDisplay: SignatureDisplayType
    ) {
        // If the class is used as part of a call (i.e. it is being
        // instantiated), include the constructor arguments within the
        // hover text.
        let callLeftNode: ParseNode | undefined = node;

        // Allow the left to be a member access chain (e.g. a.b.c) if the
        // node in question is the last item in the chain.
        if (callLeftNode?.parent?.nodeType === ParseNodeType.MemberAccess && node === callLeftNode.parent.memberName) {
            callLeftNode = node.parent;
            // Allow the left to be a generic class constructor (e.g. foo[int]())
        } else if (callLeftNode?.parent?.nodeType === ParseNodeType.Index) {
            callLeftNode = node.parent;
        }

        if (
            !callLeftNode ||
            !callLeftNode.parent ||
            callLeftNode.parent.nodeType !== ParseNodeType.Call ||
            callLeftNode.parent.leftExpression !== callLeftNode
        ) {
            return false;
        }

        // Get the init method for this class.
        const classType = this._getType(evaluator, node);
        if (!isInstantiableClass(classType)) {
            return false;
        }

        const instanceType = this._getType(evaluator, callLeftNode.parent);
        if (!isClassInstance(instanceType)) {
            return false;
        }

        let methodType: Type | undefined;

        // Try to get the `__init__` method first because it typically has more type information than `__new__`.
        // Don't exclude `object.__init__` since in the plain case we want to show Foo().
        const initMember = lookUpClassMember(classType, '__init__', ClassMemberLookupFlags.SkipInstanceVariables);

        if (initMember) {
            const functionType = evaluator.getTypeOfMember(initMember);

            if (isFunction(functionType) || isOverloadedFunction(functionType)) {
                methodType = this._bindFunctionToClassOrObject(evaluator, node, instanceType, functionType);
            }
        }

        // If there was no `__init__`, excluding `object` class `__init__`, or if `__init__` only had default params (*args: Any, **kwargs: Any) or no params (),
        // see if we can find a better `__new__` method.
        if (
            !methodType ||
            (methodType &&
                isFunction(methodType) &&
                (FunctionType.hasDefaultParameters(methodType) || methodType.details.parameters.length === 0))
        ) {
            const newMember = lookUpClassMember(
                classType,
                '__new__',
                ClassMemberLookupFlags.SkipObjectBaseClass | ClassMemberLookupFlags.SkipInstanceVariables
            );

            if (newMember) {
                const newMemberType = evaluator.getTypeOfMember(newMember);

                // Prefer `__new__` if it doesn't have default params (*args: Any, **kwargs: Any) or no params ().
                if (isFunction(newMemberType) || isOverloadedFunction(newMemberType)) {
                    // Set `treatConstructorAsClassMember` to true to exclude `cls` as a parameter.
                    methodType = this._bindFunctionToClassOrObject(
                        evaluator,
                        node,
                        instanceType,
                        newMemberType,
                        /* treatConstructorAsClassMember */ true
                    );
                }
            }
        }

        if (methodType && (isFunction(methodType) || isOverloadedFunction(methodType))) {
            this._addResultsPart(
                parts,
                getConstructorTooltip(node.value, methodType, evaluator, functionSignatureDisplay),
                /* python */ true
            );

            const addedDoc = this._addDocumentationPartForType(
                format,
                sourceMapper,
                parts,
                methodType,
                declaration,
                evaluator
            );

            if (!addedDoc) {
                this._addDocumentationPartForType(format, sourceMapper, parts, classType, declaration, evaluator);
            }
            return true;
        }
        return false;
    }

    private static _getTypeText(node: ExpressionNode, evaluator: TypeEvaluator, expandTypeAlias = false): string {
        const type = this._getType(evaluator, node);
        return ': ' + evaluator.printType(type, { expandTypeAlias });
    }

    private static _getTypesText(nodes: ExpressionNode[], evaluator: TypeEvaluator, expandTypeAlias = false): string {
        const type = combineExpressionTypes(nodes, evaluator);
        return ': ' + evaluator.printType(type, { expandTypeAlias });
    }

    private static _bindFunctionToClassOrObject(
        evaluator: TypeEvaluator,
        node: ExpressionNode,
        baseType: ClassType | undefined,
        memberType: FunctionType | OverloadedFunctionType,
        treatConstructorAsClassMember?: boolean
    ): FunctionType | OverloadedFunctionType | undefined {
        const methodType = evaluator.bindFunctionToClassOrObject(
            baseType,
            memberType,
            /* memberClass */ undefined,
            /* errorNode */ undefined,
            /* recursiveCount */ undefined,
            treatConstructorAsClassMember
        );

        if (!methodType) {
            return undefined;
        }

        return this._limitOverloadBasedOnCall(evaluator, methodType, node);
    }

    private static _getType(evaluator: TypeEvaluator, node: ExpressionNode) {
        // It does common work necessary for hover for a type we got
        // from raw type evaluator.
        const type = evaluator.getType(node) ?? UnknownType.create();
        return this._limitOverloadBasedOnCall(evaluator, type, node);
    }

    private static _limitOverloadBasedOnCall<T extends Type>(
        evaluator: TypeEvaluator,
        type: T,
        node: ExpressionNode
    ): T | FunctionType | OverloadedFunctionType {
        // If it's an overloaded function, see if it's part of a call expression.
        // If so, we may be able to eliminate some of the overloads based on
        // the overload resolution.
        if (!isOverloadedFunction(type) || node.nodeType !== ParseNodeType.Name) {
            return type;
        }

        const callNode = ParseTreeUtils.getCallForName(node);
        if (!callNode) {
            return type;
        }

        const callTypeResult = evaluator.getTypeResult(callNode);
        if (
            !callTypeResult ||
            !callTypeResult.overloadsUsedForCall ||
            callTypeResult.overloadsUsedForCall.length === 0
        ) {
            return type;
        }

        if (callTypeResult.overloadsUsedForCall.length === 1) {
            return callTypeResult.overloadsUsedForCall[0];
        }

        return OverloadedFunctionType.create(callTypeResult.overloadsUsedForCall);
    }

    private static _addDocumentationPart(
        format: MarkupKind,
        sourceMapper: SourceMapper,
        parts: HoverTextPart[],
        node: NameNode,
        evaluator: TypeEvaluator,
        resolvedDecl: Declaration | undefined
    ) {
        const type = this._getType(evaluator, node);
        this._addDocumentationPartForType(format, sourceMapper, parts, type, resolvedDecl, evaluator, node.value);
    }

    private static _addDocumentationPartForType(
        format: MarkupKind,
        sourceMapper: SourceMapper,
        parts: HoverTextPart[],
        type: Type | undefined,
        resolvedDecl: Declaration | undefined,
        evaluator: TypeEvaluator,
        name?: string
    ): boolean {
        const docString = getDocumentationPartsForTypeAndDecl(sourceMapper, type, resolvedDecl, evaluator, { name });
        if (docString) {
            this._addDocumentationResultsPart(format, parts, docString);
            return true;
        }

        return false;
    }

    private static _addDocumentationResultsPart(format: MarkupKind, parts: HoverTextPart[], docString?: string) {
        if (docString) {
            if (format === MarkupKind.Markdown) {
                const markDown = convertDocStringToMarkdown(docString);

                if (parts.length > 0 && markDown.length > 0) {
                    parts.push({ text: '---\n' });
                }

                this._addResultsPart(parts, markDown);
            } else if (format === MarkupKind.PlainText) {
                this._addResultsPart(parts, convertDocStringToPlainText(docString));
            } else {
                fail(`Unsupported markup type: ${format}`);
            }
        }
    }

    private static _addResultsPart(parts: HoverTextPart[], text: string, python = false) {
        parts.push({
            python,
            text,
        });
    }
}

export function convertHoverResults(
    format: MarkupKind,
    hoverResults: HoverResults | undefined,
    includeHash?: boolean
): Hover | undefined {
    if (!hoverResults) {
        return undefined;
    }

    let markupString = hoverResults.parts
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

    // If we have a lastKnownModule in the hover results, stick in a comment with
    // the hashed module name. This is used by the other side to send telemetry.
    if (hoverResults.lastKnownModule && format === MarkupKind.Markdown && includeHash) {
        markupString += `\n<!--moduleHash:${hashString(hoverResults.lastKnownModule)}-->`;
    }

    return {
        contents: {
            kind: format,
            value: markupString,
        },
        range: hoverResults.range,
    };
}
