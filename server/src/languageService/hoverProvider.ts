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
import { AnalyzerNodeInfo } from '../analyzer/analyzerNodeInfo';
import { DeclarationCategory } from '../analyzer/declaration';
import { ImportType } from '../analyzer/importResult';
import { ParseTreeUtils } from '../analyzer/parseTreeUtils';
import { ClassType, FunctionType, ModuleType, OverloadedFunctionType,
    Type, UnknownType } from '../analyzer/types';
import { DiagnosticTextPosition, DiagnosticTextRange } from '../common/diagnostic';
import { convertOffsetToPosition, convertPositionToOffset } from '../common/positionUtils';
import { ModuleNameNode, NameNode, ParseNode } from '../parser/parseNodes';
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
                end: convertOffsetToPosition(node.end, parseResults.lines)
            }
        };

        if (node instanceof ModuleNameNode) {
            // If this is an imported module name, try to map the position
            // to the resolved import path.
            const importInfo = AnalyzerNodeInfo.getImportInfo(node);
            if (!importInfo) {
                return undefined;
            }

            let pathOffset = node.nameParts.findIndex(range => {
                return offset >= range.start && offset < range.end;
            });

            if (pathOffset < 0) {
                return undefined;
            }

            if (pathOffset >= importInfo.resolvedPaths.length) {
                pathOffset = importInfo.resolvedPaths.length - 1;
            }

            if (importInfo.resolvedPaths[pathOffset]) {
                const resolvedPath = importInfo.resolvedPaths[pathOffset];
                this._addResultsPart(results, '(module) "' + resolvedPath + '"', true);

                if (importInfo.importType === ImportType.ThirdParty && !importInfo.isStubFile) {
                    this._addResultsPart(results,
                        'No type stub found for this module. Imported symbol types are unknown.');
                }

                // If the module has been resolved and already analyzed,
                // we can add the docString for it as well.
                if (importMap[resolvedPath]) {
                    const moduleNode = importMap[resolvedPath].parseTree;
                    if (moduleNode) {
                        const moduleType = AnalyzerNodeInfo.getExpressionType(moduleNode) as ModuleType;
                        if (moduleType) {
                            this._addDocumentationPartForType(results, moduleType);
                        }
                    }
                }

                return results;
            }

            return undefined;
        }

        const declarations = AnalyzerNodeInfo.getDeclarations(node);

        if (declarations && declarations.length > 0) {
            const declaration = declarations[0];

            switch (declaration.category) {
                case DeclarationCategory.Variable: {
                    if (node instanceof NameNode) {
                        this._addResultsPart(results, '(variable) ' + node.nameToken.value +
                            this._getTypeText(node), true);
                        this._addDocumentationPart(results, node);
                        return results;
                    }
                    break;
                }

                case DeclarationCategory.Parameter: {
                    if (node instanceof NameNode) {
                        this._addResultsPart(results, '(parameter) ' + node.nameToken.value +
                            this._getTypeText(node), true);
                        this._addDocumentationPart(results, node);
                        return results;
                    }
                    break;
                }

                case DeclarationCategory.Class: {
                    if (node instanceof NameNode) {
                        this._addResultsPart(results, '(class) ' + this._getTypeText(node), true);
                        this._addDocumentationPart(results, node);
                        return results;
                    }
                    break;
                }

                case DeclarationCategory.Function: {
                    if (node instanceof NameNode) {
                        this._addResultsPart(results, '(function) ' + node.nameToken.value +
                            this._getTypeText(node), true);
                        this._addDocumentationPart(results, node);
                        return results;
                    }
                    break;
                }

                case DeclarationCategory.Method: {
                    if (node instanceof NameNode) {
                        this._addResultsPart(results, '(method) ' + node.nameToken.value +
                            this._getTypeText(node), true);
                        this._addDocumentationPart(results, node);
                        return results;
                    }
                    break;
                }

                case DeclarationCategory.Module: {
                    if (node instanceof NameNode) {
                        this._addResultsPart(results, '(module) ' + node.nameToken.value, true);
                        this._addDocumentationPart(results, node);
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
                this._addDocumentationPart(results, node);
                return results;
            }
        }

        return undefined;
    }

    private static _getTypeFromNode(node: ParseNode): Type | undefined {
        let type = AnalyzerNodeInfo.getExpressionType(node);

        // If there was no type information cached, see if we
        // can get it from the declaration.
        if (!type) {
            const declTypes = this._getTypesFromDeclarations(node);
            if (declTypes) {
                type = declTypes[0];
            }
        }

        return type;
    }

    private static _getTypesFromDeclarations(node: ParseNode): Type[] | undefined {
        const declarations = AnalyzerNodeInfo.getDeclarations(node);
        if (declarations && declarations.length > 0) {
            const types: Type[] = [];
            declarations.forEach(decl => {
                if (decl.declaredType) {
                    types.push(decl.declaredType);
                }
            });

            return types.length > 0 ? types : undefined;
        }

        return undefined;
    }

    private static _getTypeText(node: ParseNode): string {
        const type = this._getTypeFromNode(node) || UnknownType.create();
        return ': ' + type.asString();
    }

    private static _addDocumentationPart(results: HoverResults, node: ParseNode) {
        const type = this._getTypeFromNode(node);
        if (type) {
            this._addDocumentationPartForType(results, type);
        }
    }

    private static _addDocumentationPartForType(results: HoverResults, type: Type) {
        if (type instanceof ModuleType) {
            const docString = type.getDocString();
            if (docString) {
                this._addResultsPart(results, docString);
            }
        } else if (type instanceof ClassType) {
            const docString = type.getDocString();
            if (docString) {
                this._addResultsPart(results, docString);
            }
        } else if (type instanceof FunctionType) {
            const docString = type.getDocString();
            if (docString) {
                this._addResultsPart(results, docString);
            }
        } else if (type instanceof OverloadedFunctionType) {
            type.getOverloads().forEach(overload => {
                const docString = overload.type.getDocString();
                if (docString) {
                    this._addResultsPart(results, docString);
                }
            });
        }
    }

    private static _addResultsPart(results: HoverResults, text: string, python = false) {
        results.parts.push({
            python,
            text
        });
    }
}
