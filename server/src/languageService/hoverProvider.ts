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

import { ImportMap } from '../analyzer/analyzerFileInfo';
import * as AnalyzerNodeInfo from '../analyzer/analyzerNodeInfo';
import { Declaration, DeclarationType } from '../analyzer/declaration';
import * as DeclarationUtils from '../analyzer/declarationUtils';
import { ImportType } from '../analyzer/importResult';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { ClassType, FunctionType, printType, Type, TypeCategory, UnknownType } from '../analyzer/types';
import { DiagnosticTextPosition, DiagnosticTextRange } from '../common/diagnostic';
import { convertOffsetToPosition, convertPositionToOffset } from '../common/positionUtils';
import { TextRange } from '../common/textRange';
import { ModuleNameNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';

export interface HoverTextPart {
    python?: boolean;
    text: string;
}

export interface HoverResults {
    parts: HoverTextPart[];
    range: DiagnosticTextRange;
}

export class HoverProvider {
    static getHoverForPosition(parseResults: ParseResults, position: DiagnosticTextPosition,
            importMap: ImportMap): HoverResults | undefined {

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
                end: convertOffsetToPosition(TextRange.getEnd(node), parseResults.tokenizerOutput.lines)
            }
        };

        if (node.nodeType === ParseNodeType.Name) {
            const declarations = DeclarationUtils.getDeclarationsForNameNode(node);
            if (declarations && declarations.length > 0) {
                this._addResultsForDeclaration(results.parts, declarations[0], node);
            }

            // If we had no declaration, see if we can provide a minimal tooltip.
            if (results.parts.length === 0) {
                this._addResultsPart(results.parts, node.nameToken.value + this._getTypeText(node), true);
                this._addDocumentationPart(results.parts, node);
            }
        }

        return results.parts.length > 0 ? results : undefined;
    }

    private static _addResultsForDeclaration(parts: HoverTextPart[],
            declaration: Declaration, node: ParseNode): void {

        let resolvedDecl: Declaration | undefined = declaration;
        while (resolvedDecl && resolvedDecl.type === DeclarationType.Alias) {
            resolvedDecl = resolvedDecl.resolvedDeclarations ?
                resolvedDecl.resolvedDeclarations[0] : undefined;
        }

        if (!resolvedDecl) {
            return undefined;
        }

        switch (resolvedDecl.type) {
            case DeclarationType.Variable: {
                const label = resolvedDecl.isConstant ? 'constant' : 'variable';
                if (node.nodeType === ParseNodeType.Name) {
                    this._addResultsPart(parts, `(${ label }) ` + node.nameToken.value +
                        this._getTypeText(node), true);
                    this._addDocumentationPart(parts, node);
                    return;
                }
                break;
            }

            case DeclarationType.Parameter: {
                if (node.nodeType === ParseNodeType.Name) {
                    this._addResultsPart(parts, '(parameter) ' + node.nameToken.value +
                        this._getTypeText(node), true);
                    this._addDocumentationPart(parts, node);
                    return;
                }
                break;
            }

            case DeclarationType.Class: {
                if (node.nodeType === ParseNodeType.Name) {
                    this._addResultsPart(parts, '(class) ' + this._getTypeText(node), true);
                    this._addDocumentationPart(parts, node);
                    return;
                }
                break;
            }

            case DeclarationType.Function: {
                if (node.nodeType === ParseNodeType.Name) {
                    this._addResultsPart(parts, '(function) ' + node.nameToken.value +
                        this._getTypeText(node), true);
                    this._addDocumentationPart(parts, node);
                    return;
                }
                break;
            }

            case DeclarationType.Method: {
                const declaredType = DeclarationUtils.getTypeForDeclaration(resolvedDecl);
                const label = declaredType && declaredType.category === TypeCategory.Property ?
                    'property' : 'method';
                if (node.nodeType === ParseNodeType.Name) {
                    this._addResultsPart(parts, `(${ label }) ` + node.nameToken.value +
                        this._getTypeText(node), true);
                    this._addDocumentationPart(parts, node);
                    return;
                }
                break;
            }

            case DeclarationType.Module: {
                if (node.nodeType === ParseNodeType.Name) {
                    this._addResultsPart(parts, '(module) ' + node.nameToken.value, true);
                    this._addDocumentationPart(parts, node);
                    return;
                }
                break;
            }
        }
    }

    private static _getTypeFromNode(node: ParseNode): Type | undefined {
        return AnalyzerNodeInfo.getExpressionType(node);
    }

    private static _getTypeText(node: ParseNode): string {
        const type = this._getTypeFromNode(node) || UnknownType.create();
        return ': ' + printType(type);
    }

    private static _addDocumentationPart(parts: HoverTextPart[], node: ParseNode) {
        const type = this._getTypeFromNode(node);
        if (type) {
            this._addDocumentationPartForType(parts, type);
        }
    }

    private static _addDocumentationPartForType(parts: HoverTextPart[], type: Type) {
        if (type.category === TypeCategory.Module) {
            const docString = type.docString;
            if (docString) {
                this._addResultsPart(parts, docString);
            }
        } else if (type.category === TypeCategory.Class) {
            const docString = ClassType.getDocString(type);
            if (docString) {
                this._addResultsPart(parts, docString);
            }
        } else if (type.category === TypeCategory.Function) {
            const docString = FunctionType.getDocString(type);
            if (docString) {
                this._addResultsPart(parts, docString);
            }
        } else if (type.category === TypeCategory.OverloadedFunction) {
            type.overloads.forEach(overload => {
                const docString = FunctionType.getDocString(overload.type);
                if (docString) {
                    this._addResultsPart(parts, docString);
                }
            });
        }
    }

    private static _addResultsPart(parts: HoverTextPart[], text: string, python = false) {
        parts.push({
            python,
            text
        });
    }
}
