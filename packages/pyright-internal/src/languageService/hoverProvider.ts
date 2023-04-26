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
    ClassMemberLookupFlags,
    doForEachSubtype,
    isMaybeDescriptorInstance,
    lookUpClassMember,
} from '../analyzer/typeUtils';
import {
    ClassType,
    FunctionType,
    OverloadedFunctionType,
    Type,
    TypeCategory,
    UnknownType,
    getTypeAliasInfo,
    isAnyOrUnknown,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    isModule,
    isOverloadedFunction,
    isTypeVar,
    isUnknown,
} from '../analyzer/types';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { assertNever, fail } from '../common/debug';
import { DeclarationUseCase, Extensions, ProgramView } from '../common/extensibility';
import { convertOffsetToPosition, convertPositionToOffset } from '../common/positionUtils';
import { hashString } from '../common/stringUtils';
import { Position, Range, TextRange } from '../common/textRange';
import { ExpressionNode, NameNode, ParseNode, ParseNodeType, StringNode, isExpressionNode } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import {
    combineExpressionTypes,
    getConstructorTooltip,
    getDocumentationPartsForTypeAndDecl,
    getToolTipForType,
} from './tooltipUtils';

export class HoverProvider {
    private readonly _parseResults: ParseResults | undefined;
    private readonly _sourceMapper: SourceMapper;

    constructor(
        private _program: ProgramView,
        private _filePath: string,
        private _position: Position,
        private _format: MarkupKind,
        private _supportTelemetry: boolean,
        private _token: CancellationToken
    ) {
        this._parseResults = this._program.getParseResults(this._filePath);
        this._sourceMapper = this._program.getSourceMapper(this._filePath, this._token, /* mapCompiled */ true);
    }

    getHover(): Hover | undefined {
        return this._convertHoverResults(this._getHoverResult());
    }

    private get _evaluator(): TypeEvaluator {
        return this._program.evaluator!;
    }

    private get _functionSignatureDisplay() {
        return this._program.configOptions.functionSignatureDisplay;
    }

    private _getHoverResult(): HoverResults | undefined {
        throwIfCancellationRequested(this._token);

        if (!this._parseResults) {
            return undefined;
        }

        const offset = convertPositionToOffset(this._position, this._parseResults.tokenizerOutput.lines);
        if (offset === undefined) {
            return undefined;
        }

        const node = ParseTreeUtils.findNodeByOffset(this._parseResults.parseTree, offset);
        if (node === undefined) {
            return undefined;
        }

        const results: HoverResults = {
            parts: [],
            range: {
                start: convertOffsetToPosition(node.start, this._parseResults.tokenizerOutput.lines),
                end: convertOffsetToPosition(TextRange.getEnd(node), this._parseResults.tokenizerOutput.lines),
            },
        };

        if (node.nodeType === ParseNodeType.Name) {
            // First give extensions a crack at getting a declaration.
            let declarations: Declaration[] | undefined = Extensions.getProgramExtensions(node)
                .map(
                    (e) =>
                        e.declarationProviderExtension?.tryGetDeclarations(
                            this._evaluator,
                            node,
                            offset,
                            DeclarationUseCase.Definition,
                            this._token
                        ) || []
                )
                .flat();
            if (declarations.length === 0) {
                declarations = this._evaluator.getDeclarationsForNameNode(node);
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

                this._addResultsForDeclaration(results.parts, primaryDeclaration, node);

                // Add the lastKnownModule for this declaration. We'll use this
                // in telemetry for hover.
                results.lastKnownModule = primaryDeclaration.moduleName;
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

        return results.parts.length > 0 ? results : undefined;
    }

    private _addResultsForDeclaration(parts: HoverTextPart[], declaration: Declaration, node: NameNode): void {
        const resolvedDecl = this._evaluator.resolveAliasDeclaration(declaration, /* resolveLocalNames */ true);
        if (!resolvedDecl) {
            this._addResultsPart(parts, `(import) ` + node.value + this._getTypeText(node), /* python */ true);
            return;
        }

        switch (resolvedDecl.type) {
            case DeclarationType.Intrinsic: {
                this._addResultsPart(parts, node.value + this._getTypeText(node), /* python */ true);
                this._addDocumentationPart(parts, node, resolvedDecl);
                break;
            }

            case DeclarationType.Variable: {
                let label =
                    resolvedDecl.isConstant || this._evaluator.isFinalVariableDeclaration(resolvedDecl)
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
                let type = this._getType(typeNode);

                // We may have more type information in the alternativeTypeNode. Use that if it's better.
                if (
                    isUnknown(type) &&
                    resolvedDecl.alternativeTypeNode &&
                    isExpressionNode(resolvedDecl.alternativeTypeNode)
                ) {
                    const inferredType = this._getType(resolvedDecl.alternativeTypeNode);
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

                let typeText: string;
                const varType = this._getType(typeNode);
                // Handle the case where type is a function and was assigned to a variable.
                if (
                    varType.category === TypeCategory.Function ||
                    varType.category === TypeCategory.OverloadedFunction
                ) {
                    typeText = getToolTipForType(
                        type,
                        label,
                        node.value,
                        this._evaluator,
                        /* isProperty */ false,
                        this._functionSignatureDisplay
                    );
                } else {
                    typeText = typeVarName || node.value + this._getTypeText(typeNode, expandTypeAlias);
                    typeText = `(${label}) ` + typeText;
                }
                this._addResultsPart(parts, typeText, /* python */ true);
                this._addDocumentationPart(parts, node, resolvedDecl);
                break;
            }

            case DeclarationType.Parameter: {
                if (resolvedDecl.inferredName && resolvedDecl.inferredTypeNodes) {
                    this._addResultsPart(
                        parts,
                        '(parameter) ' + resolvedDecl.inferredName + this._getTypesText(resolvedDecl.inferredTypeNodes),
                        /* python */ true
                    );
                } else {
                    this._addResultsPart(
                        parts,
                        '(parameter) ' + node.value + this._getTypeText(node),
                        /* python */ true
                    );
                }
                if (resolvedDecl.docString) {
                    this._addResultsPart(parts, resolvedDecl.docString);
                }
                this._addDocumentationPart(parts, node, resolvedDecl);
                break;
            }

            case DeclarationType.TypeParameter: {
                this._addResultsPart(
                    parts,
                    '(type parameter) ' + node.value + this._getTypeText(node),
                    /* python */ true
                );
                this._addDocumentationPart(parts, node, resolvedDecl);
                break;
            }

            case DeclarationType.Class:
            case DeclarationType.SpecialBuiltInClass: {
                const nameNode = resolvedDecl.type === DeclarationType.Class ? resolvedDecl.node.name : node;
                if (this._addInitOrNewMethodInsteadIfCallNode(node, parts, resolvedDecl)) {
                    return;
                }

                this._addResultsPart(parts, '(class) ' + nameNode.value, /* python */ true);
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
                const resolvedType =
                    Extensions.getProgramExtensions(resolvedDecl.node)
                        .map((e) =>
                            e.typeProviderExtension?.tryGetFunctionNodeType(
                                resolvedDecl.node,
                                this._evaluator,
                                this._token
                            )
                        )
                        .find((t) => !!t) || this._getType(resolvedDecl.node.name);
                type = isAnyOrUnknown(type) ? resolvedType : type;
                const signatureString = getToolTipForType(
                    type,
                    label,
                    node.value,
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
                this._addResultsPart(parts, '(module) ' + node.value, /* python */ true);
                this._addDocumentationPart(parts, node, resolvedDecl);
                break;
            }

            case DeclarationType.TypeAlias: {
                const typeText = node.value + this._getTypeText(node, /* expandTypeAlias */ true);
                this._addResultsPart(parts, `(type alias) ${typeText}`, /* python */ true);
                this._addDocumentationPart(parts, node, resolvedDecl);
                break;
            }

            default:
                assertNever(resolvedDecl);
        }
    }

    private _tryAddPartsForTypedDictKey(node: StringNode, type: Type, parts: HoverTextPart[]) {
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
                    const text = '(key) ' + node.value + ': ' + this._evaluator.printType(entry.valueType);
                    this._addResultsPart(parts, text, /* python */ true);

                    const declarations = subtype.details.fields.get(node.value)?.getDeclarations();
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
        const classType = this._getType(node);
        if (!isInstantiableClass(classType)) {
            return false;
        }

        const instanceType = this._getType(callLeftNode.parent);
        if (!isClassInstance(instanceType)) {
            return false;
        }

        let methodType: Type | undefined;

        // Try to get the `__init__` method first because it typically has more type information than `__new__`.
        // Don't exclude `object.__init__` since in the plain case we want to show Foo().
        const initMember = lookUpClassMember(classType, '__init__', ClassMemberLookupFlags.SkipInstanceVariables);

        if (initMember) {
            const functionType = this._evaluator.getTypeOfMember(initMember);

            if (isFunction(functionType) || isOverloadedFunction(functionType)) {
                methodType = this._bindFunctionToClassOrObject(node, instanceType, functionType);
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
                const newMemberType = this._evaluator.getTypeOfMember(newMember);

                // Prefer `__new__` if it doesn't have default params (*args: Any, **kwargs: Any) or no params ().
                if (isFunction(newMemberType) || isOverloadedFunction(newMemberType)) {
                    // Set `treatConstructorAsClassMember` to true to exclude `cls` as a parameter.
                    methodType = this._bindFunctionToClassOrObject(
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
                getConstructorTooltip(node.value, methodType, this._evaluator, this._functionSignatureDisplay),
                /* python */ true
            );

            const addedDoc = this._addDocumentationPartForType(parts, methodType, declaration);

            if (!addedDoc) {
                this._addDocumentationPartForType(parts, classType, declaration);
            }
            return true;
        }
        return false;
    }

    private _getTypeText(node: ExpressionNode, expandTypeAlias = false): string {
        const type = this._getType(node);
        return ': ' + this._evaluator.printType(type, { expandTypeAlias });
    }

    private _getTypesText(nodes: ExpressionNode[], expandTypeAlias = false): string {
        const type = combineExpressionTypes(nodes, this._evaluator);
        return ': ' + this._evaluator.printType(type, { expandTypeAlias });
    }

    private _bindFunctionToClassOrObject(
        node: ExpressionNode,
        baseType: ClassType | undefined,
        memberType: FunctionType | OverloadedFunctionType,
        treatConstructorAsClassMember?: boolean
    ): FunctionType | OverloadedFunctionType | undefined {
        const methodType = this._evaluator.bindFunctionToClassOrObject(
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

        return this._limitOverloadBasedOnCall(methodType, node);
    }

    private _getType(node: ExpressionNode) {
        // It does common work necessary for hover for a type we got
        // from raw type evaluator.
        const type = this._evaluator.getType(node) ?? UnknownType.create();
        return this._limitOverloadBasedOnCall(type, node);
    }

    private _limitOverloadBasedOnCall<T extends Type>(
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

        const callTypeResult = this._evaluator.getTypeResult(callNode);
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

    private _addDocumentationPart(parts: HoverTextPart[], node: NameNode, resolvedDecl: Declaration | undefined) {
        const type = this._getType(node);
        this._addDocumentationPartForType(parts, type, resolvedDecl, node.value);
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
        if (docString) {
            this._addDocumentationResultsPart(parts, docString);
            return true;
        }

        return false;
    }

    private _addDocumentationResultsPart(parts: HoverTextPart[], docString?: string) {
        if (docString) {
            if (this._format === MarkupKind.Markdown) {
                const markDown = convertDocStringToMarkdown(docString);

                if (parts.length > 0 && markDown.length > 0) {
                    parts.push({ text: '---\n' });
                }

                this._addResultsPart(parts, markDown);
            } else if (this._format === MarkupKind.PlainText) {
                this._addResultsPart(parts, convertDocStringToPlainText(docString));
            } else {
                fail(`Unsupported markup type: ${this._format}`);
            }
        }
    }

    private _addResultsPart(parts: HoverTextPart[], text: string, python = false) {
        parts.push({
            python,
            text,
        });
    }

    private _convertHoverResults(hoverResults: HoverResults | undefined): Hover | undefined {
        if (!hoverResults) {
            return undefined;
        }

        let markupString = hoverResults.parts
            .map((part) => {
                if (part.python) {
                    if (this._format === MarkupKind.Markdown) {
                        return '```python\n' + part.text + '\n```\n';
                    } else if (this._format === MarkupKind.PlainText) {
                        return part.text + '\n\n';
                    } else {
                        fail(`Unsupported markup type: ${this._format}`);
                    }
                }
                return part.text;
            })
            .join('')
            .trimEnd();

        // If we have a lastKnownModule in the hover results, stick in a comment with
        // the hashed module name. This is used by the other side to send telemetry.
        if (hoverResults.lastKnownModule && this._format === MarkupKind.Markdown && this._supportTelemetry) {
            markupString += `\n<!--moduleHash:${hashString(hoverResults.lastKnownModule)}-->`;
        }

        return {
            contents: {
                kind: this._format,
                value: markupString,
            },
            range: hoverResults.range,
        };
    }
}

interface HoverTextPart {
    python?: boolean;
    text: string;
}

interface HoverResults {
    parts: HoverTextPart[];
    lastKnownModule?: string;
    range: Range;
}
