/*
* importStatementUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Utility routines for summarizing and manipulating
* import statements in a python source file.
*/

import { DiagnosticTextPosition } from '../common/diagnostic';
import { TextEditAction } from '../common/editAction';
import { convertOffsetToPosition } from '../common/positionUtils';
import { TextRange } from '../common/textRange';
import { ImportAsNode, ImportFromAsNode, ImportFromNode, ImportNode,
    ModuleNameNode, ModuleNode, ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { ImportResult, ImportType } from './importResult';
import * as SymbolNameUtils from './symbolNameUtils';

export interface ImportStatement {
    node: ImportNode | ImportFromNode;
    subnode?: ImportAsNode;
    importResult: ImportResult | undefined;
    resolvedPath: string | undefined;
    moduleName: string;
    followsNonImportStatement: boolean;
}

export interface ImportStatements {
    orderedImports: ImportStatement[];
    mapByFilePath: { [filePath: string ]: ImportStatement };
}

// Looks for top-level 'import' and 'import from' statements and provides
// an ordered list and a map (by file path).
export function getTopLevelImports(parseTree: ModuleNode): ImportStatements {
    const localImports: ImportStatements = {
        orderedImports: [],
        mapByFilePath: {}
    };

    let followsNonImportStatement = false;
    let foundFirstImportStatement = false;

    parseTree.statements.forEach(statement => {
        if (statement.nodeType === ParseNodeType.StatementList) {
            statement.statements.forEach(subStatement => {
                if (subStatement.nodeType === ParseNodeType.Import) {
                    foundFirstImportStatement = true;
                    _processImportNode(subStatement, localImports, followsNonImportStatement);
                    followsNonImportStatement = false;
                } else if (subStatement.nodeType === ParseNodeType.ImportFrom) {
                    foundFirstImportStatement = true;
                    _processImportFromNode(subStatement, localImports, followsNonImportStatement);
                    followsNonImportStatement = false;
                } else {
                    followsNonImportStatement = foundFirstImportStatement;
                }
            });
        } else {
            followsNonImportStatement = foundFirstImportStatement;
        }
    });

    return localImports;
}

export function getTextEditsForAutoImportSymbolAddition(symbolName: string,
        importStatement: ImportStatement, parseResults: ParseResults) {

    const textEditList: TextEditAction[] = [];

    // Scan through the import symbols to find the right insertion point,
    // assuming we want to keep the imports alphabetized.
    let priorImport: ImportFromAsNode | undefined;

    if (importStatement.node && importStatement.node.nodeType === ParseNodeType.ImportFrom) {
        for (const curImport of importStatement.node.imports) {
            if (priorImport && curImport.name.nameToken.value > symbolName) {
                break;
            }

            priorImport = curImport;
        }

        if (priorImport) {
            const insertionOffset = TextRange.getEnd(priorImport);
            const insertionPosition = convertOffsetToPosition(insertionOffset, parseResults.lines);

            textEditList.push({
                range: { start: insertionPosition, end: insertionPosition },
                replacementText: ', ' + symbolName
            });
        }
    }

    return textEditList;
}

export function getTextEditsForAutoImportInsertion(symbolName: string, importStatements: ImportStatements,
        moduleName: string, importType: ImportType, parseResults: ParseResults): TextEditAction[] {

    const textEditList: TextEditAction[] = [];

    // We need to emit a new 'from import' statement.
    let newImportStatement = `from ${ moduleName } import ${ symbolName }`;
    let insertionPosition: DiagnosticTextPosition;
    if (importStatements.orderedImports.length > 0) {
        let insertBefore = true;
        let insertionImport = importStatements.orderedImports[0];

        // Find a good spot to insert the new import statement. Follow
        // the PEP8 standard sorting order whereby built-in imports are
        // followed by third-party, which are followed by local.
        let prevImportType = ImportType.BuiltIn;
        for (const curImport of importStatements.orderedImports) {
            // If the import was resolved, use its import type. If it wasn't
            // resolved, assume that it's the same import type as the previous
            // one.
            const curImportType: ImportType = curImport.importResult ?
                curImport.importResult.importType : prevImportType;

            if (importType < curImportType) {
                if (!insertBefore && prevImportType < importType) {
                    // Add an extra line to create a new group.
                    newImportStatement = parseResults.predominantLineEndSequence + newImportStatement;
                }
                break;
            }

            if (importType === curImportType && curImport.moduleName > moduleName) {
                break;
            }

            // If we're about to hit the end of the import statements, don't go
            // any further.
            if (curImport.followsNonImportStatement) {
                if (importType > prevImportType) {
                    // Add an extra line to create a new group.
                    newImportStatement = parseResults.predominantLineEndSequence + newImportStatement;
                }
                break;
            }

            // If this is the last import, see if we need to create a new group.
            if (curImport === importStatements.orderedImports[importStatements.orderedImports.length - 1]) {

                if (importType > curImportType) {
                    // Add an extra line to create a new group.
                    newImportStatement = parseResults.predominantLineEndSequence + newImportStatement;
                }
            }

            // Are we starting a new group?
            if (!insertBefore && importType < prevImportType && importType === curImportType) {
                insertBefore = true;
            } else {
                insertBefore = false;
            }

            prevImportType = curImportType;
            insertionImport = curImport;
        }

        if (insertionImport) {
            if (insertBefore) {
                newImportStatement = newImportStatement + parseResults.predominantLineEndSequence;
            } else {
                newImportStatement = parseResults.predominantLineEndSequence + newImportStatement;
            }

            insertionPosition = convertOffsetToPosition(
                insertBefore ? insertionImport.node.start : TextRange.getEnd(insertionImport.node),
                parseResults.lines);
        } else {
            insertionPosition = { line: 0, column: 0 };
        }
    } else {
        // Insert at or near the top of the file. See if there's a doc string and
        // copyright notice, etc. at the top. If so, move past those.
        insertionPosition = { line: 0, column: 0 };
        let addNewLineBefore = false;

        for (const statement of parseResults.parseTree.statements) {
            let stopHere = true;
            if (statement.nodeType === ParseNodeType.StatementList && statement.statements.length === 1) {
                const simpleStatement = statement.statements[0];

                if (simpleStatement.nodeType === ParseNodeType.StringList) {
                    // Assume that it's a file header doc string.
                    stopHere = false;
                } else if (simpleStatement.nodeType === ParseNodeType.Assignment) {
                    if (simpleStatement.leftExpression.nodeType === ParseNodeType.Name) {
                        if (SymbolNameUtils.isDunderName(simpleStatement.leftExpression.nameToken.value)) {
                            // Assume that it's an assignment of __copyright__, __author__, etc.
                            stopHere = false;
                        }
                    }
                }
            }

            if (stopHere) {
                insertionPosition = convertOffsetToPosition(statement.start,
                    parseResults.lines);
                addNewLineBefore = false;
                break;
            } else {
                insertionPosition = convertOffsetToPosition(
                    statement.start + statement.length,
                    parseResults.lines);
                addNewLineBefore = true;
            }
        }

        newImportStatement += parseResults.predominantLineEndSequence +
            parseResults.predominantLineEndSequence;

        if (addNewLineBefore) {
            newImportStatement = parseResults.predominantLineEndSequence + newImportStatement;
        } else {
            newImportStatement += parseResults.predominantLineEndSequence;
        }
    }

    textEditList.push({
        range: { start: insertionPosition, end: insertionPosition },
        replacementText: newImportStatement
    });

    return textEditList;
}

function _processImportNode(node: ImportNode, localImports: ImportStatements,
        followsNonImportStatement: boolean) {

    node.list.forEach(importAsNode => {
        const importResult = AnalyzerNodeInfo.getImportInfo(importAsNode.module);
        let resolvedPath: string | undefined;

        if (importResult && importResult.isImportFound) {
            resolvedPath = importResult.resolvedPaths[importResult.resolvedPaths.length - 1];
        }

        const localImport: ImportStatement = {
            node,
            subnode: importAsNode,
            importResult,
            resolvedPath,
            moduleName: _formatModuleName(importAsNode.module),
            followsNonImportStatement
        };

        localImports.orderedImports.push(localImport);

        // Add it to the map.
        if (resolvedPath) {
            // Don't overwrite existing import or import from statements
            // because we always want to prefer 'import from' over 'import'
            // in the map.
            if (!localImports.mapByFilePath[resolvedPath]) {
                localImports.mapByFilePath[resolvedPath] = localImport;
            }
        }
    });
}

function _processImportFromNode(node: ImportFromNode, localImports: ImportStatements,
        followsNonImportStatement: boolean) {

    const importResult = AnalyzerNodeInfo.getImportInfo(node.module);
    let resolvedPath: string | undefined;

    if (importResult && importResult.isImportFound) {
        resolvedPath = importResult.resolvedPaths[importResult.resolvedPaths.length - 1];
    }

    const localImport: ImportStatement = {
        node,
        importResult,
        resolvedPath,
        moduleName: _formatModuleName(node.module),
        followsNonImportStatement
    };

    localImports.orderedImports.push(localImport);

    // Add it to the map.
    if (resolvedPath) {
        const prevEntry = localImports.mapByFilePath[resolvedPath];
        // Overwrite existing import statements because we always want to prefer
        // 'import from' over 'import'. Also, overwrite existing 'import from' if
        // the module name is shorter.
        if (!prevEntry || prevEntry.node.nodeType === ParseNodeType.Import ||
                prevEntry.moduleName.length > localImport.moduleName.length) {

            localImports.mapByFilePath[resolvedPath] = localImport;
        }
    }
}

function _formatModuleName(node: ModuleNameNode): string {
    let moduleName = '';
    for (let i = 0; i < node.leadingDots; i++) {
        moduleName = moduleName + '.';
    }

    moduleName += node.nameParts.map(part => part.nameToken.value).join('.');

    return moduleName;
}
