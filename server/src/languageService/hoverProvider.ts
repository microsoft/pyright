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
import { DeclarationCategory } from '../analyzer/declaration';
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

        const offset = convertPositionToOffset(position, parseResults.lines);
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
                start: convertOffsetToPosition(node.start, parseResults.lines),
                end: convertOffsetToPosition(TextRange.getEnd(node), parseResults.lines)
            }
        };

        if (node.nodeType === ParseNodeType.ModuleName) {
            this._addResultsForModuleNameNode(results.parts, node, offset, importMap);
        } else if (node.nodeType === ParseNodeType.Name) {
            const declarations = DeclarationUtils.getDeclarationsForNameNode(node);
            if (declarations && declarations.length > 0) {
                this._addResultsForDeclaration(results.parts, declarations[0].category,
                    node, declarations[0].declaredType);
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
            declCategory: DeclarationCategory, node: ParseNode,
            declaredType?: Type): void {

        switch (declCategory) {
            case DeclarationCategory.Variable: {
                if (node.nodeType === ParseNodeType.Name) {
                    this._addResultsPart(parts, '(variable) ' + node.nameToken.value +
                        this._getTypeText(node), true);
                    this._addDocumentationPart(parts, node);
                    return;
                }
                break;
            }

            case DeclarationCategory.Parameter: {
                if (node.nodeType === ParseNodeType.Name) {
                    this._addResultsPart(parts, '(parameter) ' + node.nameToken.value +
                        this._getTypeText(node), true);
                    this._addDocumentationPart(parts, node);
                    return;
                }
                break;
            }

            case DeclarationCategory.Class: {
                if (node.nodeType === ParseNodeType.Name) {
                    this._addResultsPart(parts, '(class) ' + this._getTypeText(node), true);
                    this._addDocumentationPart(parts, node);
                    return;
                }
                break;
            }

            case DeclarationCategory.Function: {
                if (node.nodeType === ParseNodeType.Name) {
                    this._addResultsPart(parts, '(function) ' + node.nameToken.value +
                        this._getTypeText(node), true);
                    this._addDocumentationPart(parts, node);
                    return;
                }
                break;
            }

            case DeclarationCategory.Method: {
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

            case DeclarationCategory.Module: {
                if (node.nodeType === ParseNodeType.Name) {
                    this._addResultsPart(parts, '(module) ' + node.nameToken.value, true);
                    this._addDocumentationPart(parts, node);
                    return;
                }
                break;
            }
        }
    }

    private static _addResultsForModuleNameNode(parts: HoverTextPart[], node: ModuleNameNode,
            offset: number, importMap: ImportMap) {

        // If this is an imported module name, try to map the position
        // to the resolved import path.
        const importInfo = AnalyzerNodeInfo.getImportInfo(node);
        if (!importInfo) {
            return;
        }

        let pathOffset = node.nameParts.findIndex(range => {
            return offset >= range.start && offset < TextRange.getEnd(range);
        });

        if (pathOffset < 0) {
            return;
        }

        if (pathOffset >= importInfo.resolvedPaths.length) {
            pathOffset = importInfo.resolvedPaths.length - 1;
        }

        if (importInfo.resolvedPaths[pathOffset]) {
            const resolvedPath = importInfo.resolvedPaths[pathOffset];
            this._addResultsPart(parts, '(module) "' + resolvedPath + '"', true);

            if (importInfo.importType === ImportType.ThirdParty && !importInfo.isStubFile) {
                this._addResultsPart(parts,
                    'No type stub found for this module. Imported symbol types are unknown.');
            }

            // If the module has been resolved and already analyzed,
            // we can add the docString for it as well.
            if (importMap[resolvedPath]) {
                const moduleType = importMap[resolvedPath];
                if (moduleType) {
                    this._addDocumentationPartForType(parts, moduleType);
                }
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
