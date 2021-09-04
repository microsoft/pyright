/*
 * importStatementUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Utility routines for summarizing and manipulating
 * import statements in a python source file.
 */

import { CancellationToken } from 'vscode-languageserver';

import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { TextEditAction } from '../common/editAction';
import { convertOffsetToPosition, convertPositionToOffset } from '../common/positionUtils';
import { Position } from '../common/textRange';
import { TextRange } from '../common/textRange';
import {
    ImportAsNode,
    ImportFromAsNode,
    ImportFromNode,
    ImportNode,
    ModuleNameNode,
    ModuleNode,
    ParseNode,
    ParseNodeType,
} from '../parser/parseNodes';
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
    mapByFilePath: Map<string, ImportStatement>;
    implicitImports?: Map<string, ImportFromAsNode>;
}

export const enum ImportGroup {
    // The ordering here is important because this is the order
    // in which PEP8 specifies that imports should be ordered.
    BuiltIn = 0,
    ThirdParty = 1,
    Local = 2,
    LocalRelative = 3,
}

// Determines which import grouping should be used when sorting imports.
export function getImportGroup(statement: ImportStatement): ImportGroup {
    if (statement.importResult) {
        if (statement.importResult.importType === ImportType.BuiltIn) {
            return ImportGroup.BuiltIn;
        } else if (
            statement.importResult.importType === ImportType.ThirdParty ||
            statement.importResult.isLocalTypingsFile
        ) {
            return ImportGroup.ThirdParty;
        }

        if (statement.importResult.isRelative) {
            return ImportGroup.LocalRelative;
        }

        return ImportGroup.Local;
    } else {
        return ImportGroup.Local;
    }
}

// Compares sort order of two import statements.
export function compareImportStatements(a: ImportStatement, b: ImportStatement) {
    const aImportGroup = getImportGroup(a);
    const bImportGroup = getImportGroup(b);

    if (aImportGroup < bImportGroup) {
        return -1;
    } else if (aImportGroup > bImportGroup) {
        return 1;
    }

    return a.moduleName < b.moduleName ? -1 : 1;
}

// Looks for top-level 'import' and 'import from' statements and provides
// an ordered list and a map (by file path).
export function getTopLevelImports(parseTree: ModuleNode, includeImplicitImports = false): ImportStatements {
    const localImports: ImportStatements = {
        orderedImports: [],
        mapByFilePath: new Map<string, ImportStatement>(),
    };

    let followsNonImportStatement = false;
    let foundFirstImportStatement = false;

    parseTree.statements.forEach((statement) => {
        if (statement.nodeType === ParseNodeType.StatementList) {
            statement.statements.forEach((subStatement) => {
                if (subStatement.nodeType === ParseNodeType.Import) {
                    foundFirstImportStatement = true;
                    _processImportNode(subStatement, localImports, followsNonImportStatement);
                    followsNonImportStatement = false;
                } else if (subStatement.nodeType === ParseNodeType.ImportFrom) {
                    foundFirstImportStatement = true;
                    _processImportFromNode(
                        subStatement,
                        localImports,
                        followsNonImportStatement,
                        includeImplicitImports
                    );
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

// Return import symbol type to allow sorting similar to isort
// CONSTANT_VARIABLE, CamelCaseClass, variable_or_function
function _getImportSymbolNameType(symbolName: string): number {
    if (SymbolNameUtils.isConstantName(symbolName)) {
        return 0;
    }
    if (SymbolNameUtils.isTypeAliasName(symbolName)) {
        return 1;
    }
    return 2;
}

export function getTextEditsForAutoImportSymbolAddition(
    symbolName: string,
    importStatement: ImportStatement,
    parseResults: ParseResults,
    aliasName?: string
) {
    const textEditList: TextEditAction[] = [];

    // Scan through the import symbols to find the right insertion point,
    // assuming we want to keep the imports alphabetized.
    let priorImport: ImportFromAsNode | undefined;

    if (importStatement.node && importStatement.node.nodeType === ParseNodeType.ImportFrom) {
        // Make sure we're not attempting to auto-import a symbol that
        // already exists in the import list.
        if (!importStatement.node.imports.some((importAs) => importAs.name.value === symbolName)) {
            // Insert new symbol by import symbol type and then alphabetical order.
            // Match isort default behavior.
            const symbolNameType = _getImportSymbolNameType(symbolName);
            // isort will prefer '_' over alphanumerical chars
            // This can't be reproduced by a normal string compare in TypeScript, since '_' > 'A'.
            // Replace all '_' with '=' which guarantees '=' < 'A'.
            // Safe to do as '=' is an invalid char in Python names.
            const symbolNameCompare = symbolName.replace(/_/g, '=');
            for (const curImport of importStatement.node.imports) {
                const curImportNameType = _getImportSymbolNameType(curImport.name.value);
                if (
                    (curImportNameType === symbolNameType &&
                        curImport.name.value.replace(/_/g, '=') > symbolNameCompare) ||
                    curImportNameType > symbolNameType
                ) {
                    break;
                }

                priorImport = curImport;
            }

            // Are import symbols formatted one per line or multiple per line? We
            // will honor the existing formatting. We'll use a heuristic to determine
            // whether symbols are one per line or multiple per line.
            //   from x import a, b, c
            // or
            //   from x import (
            //      a
            //   )
            let useOnePerLineFormatting = false;
            let indentText = '';
            if (importStatement.node.imports.length > 0) {
                const importStatementPos = convertOffsetToPosition(
                    importStatement.node.start,
                    parseResults.tokenizerOutput.lines
                );
                const firstSymbolPos = convertOffsetToPosition(
                    importStatement.node.imports[0].start,
                    parseResults.tokenizerOutput.lines
                );
                const secondSymbolPos =
                    importStatement.node.imports.length > 1
                        ? convertOffsetToPosition(
                              importStatement.node.imports[1].start,
                              parseResults.tokenizerOutput.lines
                          )
                        : undefined;

                if (
                    firstSymbolPos.line > importStatementPos.line &&
                    (secondSymbolPos === undefined || secondSymbolPos.line > firstSymbolPos.line)
                ) {
                    const firstSymbolLineRange = parseResults.tokenizerOutput.lines.getItemAt(firstSymbolPos.line);

                    // Use the same combination of spaces or tabs to match
                    // existing formatting.
                    indentText = parseResults.text.substr(firstSymbolLineRange.start, firstSymbolPos.character);

                    // Is the indent text composed of whitespace only?
                    if (/^\s*$/.test(indentText)) {
                        useOnePerLineFormatting = true;
                    }
                }
            }

            const insertionOffset = priorImport
                ? TextRange.getEnd(priorImport)
                : importStatement.node.imports.length > 0
                ? importStatement.node.imports[0].start
                : importStatement.node.start + importStatement.node.length;
            const insertionPosition = convertOffsetToPosition(insertionOffset, parseResults.tokenizerOutput.lines);

            const insertText = aliasName ? `${symbolName} as ${aliasName}` : `${symbolName}`;
            let replacementText: string;

            if (useOnePerLineFormatting) {
                const eol = parseResults.tokenizerOutput.predominantEndOfLineSequence;
                replacementText = priorImport
                    ? `,${eol}${indentText}${insertText}`
                    : `${insertText},${eol}${indentText}`;
            } else {
                replacementText = priorImport ? `, ${insertText}` : `${insertText}, `;
            }

            textEditList.push({
                range: { start: insertionPosition, end: insertionPosition },
                replacementText,
            });
        }
    }

    return textEditList;
}

export function getTextEditsForAutoImportInsertion(
    symbolName: string | undefined,
    importStatements: ImportStatements,
    moduleName: string,
    importGroup: ImportGroup,
    parseResults: ParseResults,
    invocationPosition: Position,
    aliasName?: string
): TextEditAction[] {
    const textEditList: TextEditAction[] = [];

    // We need to emit a new 'from import' statement if symbolName is given. otherwise, use 'import' statement.
    const importText = symbolName ? symbolName : moduleName;
    const importTextWithAlias = aliasName ? `${importText} as ${aliasName}` : importText;
    let newImportStatement = symbolName
        ? `from ${moduleName} import ${importTextWithAlias}`
        : `import ${importTextWithAlias}`;

    let insertionPosition: Position;
    const invocation = convertPositionToOffset(invocationPosition, parseResults.tokenizerOutput.lines)!;
    if (importStatements.orderedImports.length > 0 && invocation >= importStatements.orderedImports[0].node.start) {
        let insertBefore = true;
        let insertionImport = importStatements.orderedImports[0];

        // Find a good spot to insert the new import statement. Follow
        // the PEP8 standard sorting order whereby built-in imports are
        // followed by third-party, which are followed by local.
        let prevImportGroup = ImportGroup.BuiltIn;
        for (const curImport of importStatements.orderedImports) {
            // If the import was resolved, use its import type. If it wasn't
            // resolved, assume that it's the same import type as the previous
            // one.
            const curImportGroup: ImportGroup = curImport.importResult ? getImportGroup(curImport) : prevImportGroup;

            if (importGroup < curImportGroup) {
                if (!insertBefore && prevImportGroup < importGroup) {
                    // Add an extra line to create a new group.
                    newImportStatement = parseResults.tokenizerOutput.predominantEndOfLineSequence + newImportStatement;
                }
                break;
            }

            if (importGroup === curImportGroup && curImport.moduleName > moduleName) {
                break;
            }

            // If we're about to hit the end of the import statements, don't go
            // any further.
            if (curImport.followsNonImportStatement) {
                if (importGroup > prevImportGroup) {
                    // Add an extra line to create a new group.
                    newImportStatement = parseResults.tokenizerOutput.predominantEndOfLineSequence + newImportStatement;
                }
                break;
            }

            // If this is the last import, see if we need to create a new group.
            if (curImport === importStatements.orderedImports[importStatements.orderedImports.length - 1]) {
                if (importGroup > curImportGroup) {
                    // Add an extra line to create a new group.
                    newImportStatement = parseResults.tokenizerOutput.predominantEndOfLineSequence + newImportStatement;
                }
            }

            // Are we starting a new group?
            if (!insertBefore && importGroup < prevImportGroup && importGroup === curImportGroup) {
                insertBefore = true;
            } else {
                insertBefore = false;
            }

            prevImportGroup = curImportGroup;
            insertionImport = curImport;
        }

        if (insertionImport) {
            if (insertBefore) {
                newImportStatement = newImportStatement + parseResults.tokenizerOutput.predominantEndOfLineSequence;
            } else {
                newImportStatement = parseResults.tokenizerOutput.predominantEndOfLineSequence + newImportStatement;
            }

            insertionPosition = convertOffsetToPosition(
                insertBefore ? insertionImport.node.start : TextRange.getEnd(insertionImport.node),
                parseResults.tokenizerOutput.lines
            );
        } else {
            insertionPosition = { line: 0, character: 0 };
        }
    } else {
        // Insert at or near the top of the file. See if there's a doc string and
        // copyright notice, etc. at the top. If so, move past those.
        insertionPosition = { line: 0, character: 0 };
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
                        if (SymbolNameUtils.isDunderName(simpleStatement.leftExpression.value)) {
                            // Assume that it's an assignment of __copyright__, __author__, etc.
                            stopHere = false;
                        }
                    }
                }
            }

            if (stopHere) {
                insertionPosition = convertOffsetToPosition(statement.start, parseResults.tokenizerOutput.lines);
                addNewLineBefore = false;
                break;
            } else {
                insertionPosition = convertOffsetToPosition(
                    statement.start + statement.length,
                    parseResults.tokenizerOutput.lines
                );
                addNewLineBefore = true;
            }
        }

        newImportStatement +=
            parseResults.tokenizerOutput.predominantEndOfLineSequence +
            parseResults.tokenizerOutput.predominantEndOfLineSequence;

        if (addNewLineBefore) {
            newImportStatement = parseResults.tokenizerOutput.predominantEndOfLineSequence + newImportStatement;
        } else {
            newImportStatement += parseResults.tokenizerOutput.predominantEndOfLineSequence;
        }
    }

    textEditList.push({
        range: { start: insertionPosition, end: insertionPosition },
        replacementText: newImportStatement,
    });

    return textEditList;
}

function _processImportNode(node: ImportNode, localImports: ImportStatements, followsNonImportStatement: boolean) {
    node.list.forEach((importAsNode) => {
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
            followsNonImportStatement,
        };

        localImports.orderedImports.push(localImport);

        // Add it to the map.
        if (resolvedPath) {
            // Don't overwrite existing import or import from statements
            // because we always want to prefer 'import from' over 'import'
            // in the map.
            if (!localImports.mapByFilePath.has(resolvedPath)) {
                localImports.mapByFilePath.set(resolvedPath, localImport);
            }
        }
    });
}

function _processImportFromNode(
    node: ImportFromNode,
    localImports: ImportStatements,
    followsNonImportStatement: boolean,
    includeImplicitImports: boolean
) {
    const importResult = AnalyzerNodeInfo.getImportInfo(node.module);
    let resolvedPath: string | undefined;

    if (importResult && importResult.isImportFound) {
        resolvedPath = importResult.resolvedPaths[importResult.resolvedPaths.length - 1];
    }

    if (includeImplicitImports && importResult) {
        localImports.implicitImports = localImports.implicitImports ?? new Map<string, ImportFromAsNode>();

        for (const implicitImport of importResult.implicitImports) {
            const importFromAs = node.imports.find((i) => i.name.value === implicitImport.name);
            if (importFromAs) {
                localImports.implicitImports.set(implicitImport.path, importFromAs);
            }
        }
    }

    const localImport: ImportStatement = {
        node,
        importResult,
        resolvedPath,
        moduleName: _formatModuleName(node.module),
        followsNonImportStatement,
    };

    localImports.orderedImports.push(localImport);

    // Add it to the map.
    if (resolvedPath) {
        const prevEntry = localImports.mapByFilePath.get(resolvedPath);
        // Overwrite existing import statements because we always want to prefer
        // 'import from' over 'import'. Also, overwrite existing 'import from' if
        // the module name is shorter.
        if (
            !prevEntry ||
            prevEntry.node.nodeType === ParseNodeType.Import ||
            prevEntry.moduleName.length > localImport.moduleName.length
        ) {
            localImports.mapByFilePath.set(resolvedPath, localImport);
        }
    }
}

function _formatModuleName(node: ModuleNameNode): string {
    let moduleName = '';
    for (let i = 0; i < node.leadingDots; i++) {
        moduleName = moduleName + '.';
    }

    moduleName += node.nameParts.map((part) => part.value).join('.');

    return moduleName;
}

export function getContainingImportStatement(node: ParseNode | undefined, token: CancellationToken) {
    while (node) {
        throwIfCancellationRequested(token);

        if (node.nodeType === ParseNodeType.Import || node.nodeType === ParseNodeType.ImportFrom) {
            break;
        }

        node = node.parent;
    }

    return node;
}

export function getAllImportNames(node: ImportNode | ImportFromNode) {
    if (node.nodeType === ParseNodeType.Import) {
        const importNode = node as ImportNode;
        return importNode.list;
    }

    const importFromNode = node as ImportFromNode;
    return importFromNode.imports;
}
