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

import { DiagnosticTextPosition, DiagnosticTextRange } from '../common/diagnostic';
import { convertOffsetToPosition, convertPositionToOffset } from '../common/positionUtils';
import { ModuleNameNode, NameNode, ParseNode } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { AnalyzerNodeInfo } from './analyzerNodeInfo';
import { ImportType } from './importResult';
import { ParseTreeUtils } from './parseTreeUtils';
import { SymbolCategory } from './symbol';
import { UnknownType } from './types';

export interface HoverTextPart {
    python?: boolean;
    text: string;
}

export interface HoverResults {
    parts: HoverTextPart[];
    range: DiagnosticTextRange;
}

export class HoverProvider {
    static getHoverForPosition(parseResults: ParseResults,
            position: DiagnosticTextPosition): HoverResults | undefined {

        let offset = convertPositionToOffset(position, parseResults.lines);
        if (offset === undefined) {
            return undefined;
        }

        let node = ParseTreeUtils.findNodeByOffset(parseResults.parseTree, offset);
        if (node === undefined) {
            return undefined;
        }

        const results: HoverResults = {
            parts: [],
            range: {
                start: convertOffsetToPosition(node.start, parseResults.lines),
                end: convertOffsetToPosition(node.end, parseResults.lines)
            }
        };

        if (node instanceof ModuleNameNode) {
            // If this is an imported module name, try to map the position
            // to the resolved import path.
            let importInfo = AnalyzerNodeInfo.getImportInfo(node);
            if (!importInfo) {
                return undefined;
            }

            let pathOffset = node.nameParts.findIndex(range => {
                return offset! >= range.start && offset! < range.end;
            });

            if (pathOffset < 0) {
                return undefined;
            }

            if (pathOffset >= importInfo.resolvedPaths.length) {
                pathOffset = importInfo.resolvedPaths.length - 1;
            }

            if (importInfo.resolvedPaths[pathOffset]) {
                this._addResultsPart(results, '(module) "' + importInfo.resolvedPaths[pathOffset] + '"', true);

                if (importInfo.importType === ImportType.ThirdParty && !importInfo.isStubFile) {
                    this._addResultsPart(results,
                        'No type stub found for this module. Imported symbol types are unknown.');
                }

                return results;
            }

            return undefined;
        }

        const declarations = AnalyzerNodeInfo.getDeclarations(node);

        if (declarations && declarations.length > 0) {
            const declaration = declarations[0];

            switch (declaration.category) {
                case SymbolCategory.Variable: {
                    if (node instanceof NameNode) {
                        this._addResultsPart(results, '(variable) ' + node.nameToken.value +
                            this._getTypeText(node), true);
                        return results;
                    }
                    break;
                }

                case SymbolCategory.Parameter: {
                    if (node instanceof NameNode) {
                        this._addResultsPart(results, '(parameter) ' + node.nameToken.value +
                            this._getTypeText(node), true);
                        return results;
                    }
                    break;
                }

                case SymbolCategory.Class: {
                    if (node instanceof NameNode) {
                        this._addResultsPart(results, '(class) ' + this._getTypeText(node), true);
                        return results;
                    }
                    break;
                }

                case SymbolCategory.Function: {
                    if (node instanceof NameNode) {
                        this._addResultsPart(results, '(function) ' + node.nameToken.value +
                            this._getTypeText(node), true);
                        return results;
                    }
                    break;
                }

                case SymbolCategory.Method: {
                    if (node instanceof NameNode) {
                        this._addResultsPart(results, '(method) ' + node.nameToken.value +
                            this._getTypeText(node), true);
                        return results;
                    }
                    break;
                }

                case SymbolCategory.Module: {
                    if (node instanceof NameNode) {
                        this._addResultsPart(results, '(module) ' + node.nameToken.value, true);
                        return results;
                    }
                    break;
                }
            }
        }

        // If we had no declaration, see if we can provide a minimal tooltip.
        if (node instanceof NameNode) {
            if (node instanceof NameNode) {
                this._addResultsPart(results, node.nameToken.value + this._getTypeText(node), true);
                return results;
            }
        }

        return undefined;
    }

    private static _getTypeText(node: ParseNode): string {
        let type = AnalyzerNodeInfo.getExpressionType(node);

        // If there was no type information cached, see if we
        // can get it from the declaration.
        if (!type) {
            const declarations = AnalyzerNodeInfo.getDeclarations(node);
            if (declarations && declarations.length > 0) {
                const declaration = declarations[0];
                if (declaration.declaredType) {
                    type = declaration.declaredType;
                }
            }
        }

        // If we still couldn't find a type, use Unknown.
        if (!type) {
            type = UnknownType.create();
        }

        return ': ' + type.asString();
    }

    private static _addResultsPart(results: HoverResults, text: string, python = false) {
        results.parts.push({
            python,
            text
        });
    }

    private static _formatCode(codeString: string): string {
        return '```\n' + codeString + '\n```\n';
    }
}
