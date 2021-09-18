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
    getTypeAliasInfo,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    isModule,
    isOverloadedFunction,
    isTypeVar,
    Type,
    UnknownType,
} from '../analyzer/types';
import { ClassMemberLookupFlags, isProperty, lookUpClassMember } from '../analyzer/typeUtils';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { fail } from '../common/debug';
import { convertOffsetToPosition, convertPositionToOffset } from '../common/positionUtils';
import { Position, Range } from '../common/textRange';
import { TextRange } from '../common/textRange';
import { NameNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { getDocumentationPartsForTypeAndDecl, getOverloadedFunctionTooltip } from './tooltipUtils';

export interface HoverTextPart {
    python?: boolean;
    text: string;
}

export interface HoverResults {
    parts: HoverTextPart[];
    range: Range;
}

export class HoverProvider {
    static getHoverForPosition(
        sourceMapper: SourceMapper,
        parseResults: ParseResults,
        position: Position,
        format: MarkupKind,
        evaluator: TypeEvaluator,
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
            const declarations = evaluator.getDeclarationsForNameNode(node);
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
                }

                this._addResultsForDeclaration(
                    format,
                    sourceMapper,
                    results.parts,
                    primaryDeclaration,
                    node,
                    evaluator
                );
            } else if (!node.parent || node.parent.nodeType !== ParseNodeType.ModuleName) {
                // If we had no declaration, see if we can provide a minimal tooltip. We'll skip
                // this if it's part of a module name, since a module name part with no declaration
                // is a directory (a namespace package), and we don't want to provide any hover
                // information in that case.
                if (results.parts.length === 0) {
                    const type = evaluator.getType(node) || UnknownType.create();

                    let typeText = '';
                    if (isModule(type)) {
                        // Handle modules specially because submodules aren't associated with
                        // declarations, but we want them to be presented in the same way as
                        // the top-level module, which does have a declaration.
                        typeText = '(module) ' + node.value;
                    } else {
                        typeText = node.value + ': ' + evaluator.printType(type, /* expandTypeAlias */ false);
                    }

                    this._addResultsPart(results.parts, typeText, true);
                    this._addDocumentationPart(format, sourceMapper, results.parts, node, evaluator, undefined);
                }
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
        evaluator: TypeEvaluator
    ): void {
        const resolvedDecl = evaluator.resolveAliasDeclaration(declaration, /* resolveLocalNames */ true);
        if (!resolvedDecl) {
            this._addResultsPart(parts, `(import) ` + node.value + this._getTypeText(node, evaluator), true);
            return;
        }

        switch (resolvedDecl.type) {
            case DeclarationType.Intrinsic: {
                this._addResultsPart(parts, node.value + this._getTypeText(node, evaluator), true);
                this._addDocumentationPart(format, sourceMapper, parts, node, evaluator, resolvedDecl);
                break;
            }

            case DeclarationType.Variable: {
                let label = resolvedDecl.isConstant || resolvedDecl.isFinal ? 'constant' : 'variable';

                // If the named node is an aliased import symbol, we can't call
                // getType on the original name because it's not in the symbol
                // table. Instead, use the node from the resolved alias.
                let typeNode = node;
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
                const type = evaluator.getType(typeNode);
                let expandTypeAlias = false;
                let typeVarName: string | undefined;

                if (type?.typeAliasInfo) {
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
                this._addResultsPart(parts, `(${label}) ${typeText}`, true);
                this._addDocumentationPart(format, sourceMapper, parts, node, evaluator, resolvedDecl);
                break;
            }

            case DeclarationType.Parameter: {
                this._addResultsPart(parts, '(parameter) ' + node.value + this._getTypeText(node, evaluator), true);
                this._addDocumentationPart(format, sourceMapper, parts, node, evaluator, resolvedDecl);
                break;
            }

            case DeclarationType.Class:
            case DeclarationType.SpecialBuiltInClass: {
                if (this._addInitMethodInsteadIfCallNode(format, node, evaluator, parts, sourceMapper, resolvedDecl)) {
                    return;
                }

                this._addResultsPart(parts, '(class) ' + node.value, true);
                this._addDocumentationPart(format, sourceMapper, parts, node, evaluator, resolvedDecl);
                break;
            }

            case DeclarationType.Function: {
                let label = 'function';
                if (resolvedDecl.isMethod) {
                    const declaredType = evaluator.getTypeForDeclaration(resolvedDecl);
                    label = declaredType && isProperty(declaredType) ? 'property' : 'method';
                }

                const type = evaluator.getType(node);
                if (type && isOverloadedFunction(type)) {
                    this._addResultsPart(parts, `(${label})\n${getOverloadedFunctionTooltip(type, evaluator)}`, true);
                } else {
                    this._addResultsPart(parts, `(${label}) ` + node.value + this._getTypeText(node, evaluator), true);
                }

                this._addDocumentationPart(format, sourceMapper, parts, node, evaluator, resolvedDecl);
                break;
            }

            case DeclarationType.Alias: {
                this._addResultsPart(parts, '(module) ' + node.value, true);
                this._addDocumentationPart(format, sourceMapper, parts, node, evaluator, resolvedDecl);
                break;
            }
        }
    }

    private static _addInitMethodInsteadIfCallNode(
        format: MarkupKind,
        node: NameNode,
        evaluator: TypeEvaluator,
        parts: HoverTextPart[],
        sourceMapper: SourceMapper,
        declaration: Declaration
    ) {
        // If the class is used as part of a call (i.e. it is being
        // instantiated), include the constructor arguments within the
        // hover text.
        let callLeftNode: ParseNode | undefined = node;

        // Allow the left to be a member access chain (e.g. a.b.c) if the
        // node in question is the last item in the chain.
        if (
            callLeftNode.parent &&
            callLeftNode.parent.nodeType === ParseNodeType.MemberAccess &&
            node === callLeftNode.parent.memberName
        ) {
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
        const classType = evaluator.getType(node);
        if (!classType || !isInstantiableClass(classType)) {
            return false;
        }

        const initMethodMember = lookUpClassMember(classType, '__init__', ClassMemberLookupFlags.SkipInstanceVariables);

        if (!initMethodMember) {
            return false;
        }

        const instanceType = evaluator.getType(callLeftNode.parent);
        const functionType = evaluator.getTypeOfMember(initMethodMember);

        if (!instanceType || !functionType || !isClassInstance(instanceType) || !isFunction(functionType)) {
            return false;
        }

        const initMethodType = evaluator.bindFunctionToClassOrObject(instanceType, functionType);

        if (!initMethodType || !isFunction(initMethodType)) {
            return false;
        }

        const functionParts = evaluator.printFunctionParts(initMethodType);
        const classText = `${node.value}(${functionParts[0].join(', ')})`;

        this._addResultsPart(parts, '(class) ' + classText, true);
        const addedDoc = this._addDocumentationPartForType(
            format,
            sourceMapper,
            parts,
            initMethodType,
            declaration,
            evaluator
        );
        if (!addedDoc) {
            this._addDocumentationPartForType(format, sourceMapper, parts, classType, declaration, evaluator);
        }
        return true;
    }

    private static _getTypeText(node: NameNode, evaluator: TypeEvaluator, expandTypeAlias = false): string {
        const type = evaluator.getType(node) || UnknownType.create();
        return ': ' + evaluator.printType(type, expandTypeAlias);
    }

    private static _addDocumentationPart(
        format: MarkupKind,
        sourceMapper: SourceMapper,
        parts: HoverTextPart[],
        node: NameNode,
        evaluator: TypeEvaluator,
        resolvedDecl: Declaration | undefined
    ) {
        const type = evaluator.getType(node);
        if (type) {
            this._addDocumentationPartForType(format, sourceMapper, parts, type, resolvedDecl, evaluator);
        }
    }

    private static _addDocumentationPartForType(
        format: MarkupKind,
        sourceMapper: SourceMapper,
        parts: HoverTextPart[],
        type: Type,
        resolvedDecl: Declaration | undefined,
        evaluator: TypeEvaluator
    ): boolean {
        const docStrings = getDocumentationPartsForTypeAndDecl(sourceMapper, type, resolvedDecl, evaluator);
        let addedDoc = false;
        for (const docString of docStrings) {
            if (docString) {
                addedDoc = true;
                this._addDocumentationResultsPart(format, parts, docString);
            }
        }

        return addedDoc;
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

export function convertHoverResults(format: MarkupKind, hoverResults: HoverResults | undefined): Hover | undefined {
    if (!hoverResults) {
        return undefined;
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
