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
import { addIfUnique, createMapFromItems } from '../common/collectionUtils';
import { TextEditAction } from '../common/editAction';
import { FileSystem } from '../common/fileSystem';
import {
    getDirectoryPath,
    getFileName,
    getRelativePathComponentsFromDirectory,
    isFile,
    stripFileExtension,
} from '../common/pathUtils';
import { convertOffsetToPosition, convertPositionToOffset } from '../common/positionUtils';
import { compareStringsCaseSensitive } from '../common/stringUtils';
import { Position, Range, TextRange } from '../common/textRange';
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
import { ModuleNameAndType } from './importResolver';
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

export interface ImportNameInfo {
    name?: string;
    alias?: string;
}

export interface ImportNameWithModuleInfo extends ImportNameInfo {
    module: ModuleNameAndType;
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
    importNameInfo: ImportNameInfo | ImportNameInfo[],
    importStatement: ImportStatement,
    parseResults: ParseResults
): TextEditAction[] {
    const additionEdits: AdditionEdit[] = [];
    if (
        !importStatement.node ||
        importStatement.node.nodeType !== ParseNodeType.ImportFrom ||
        importStatement.node.isWildcardImport
    ) {
        return additionEdits;
    }

    // Make sure we're not attempting to auto-import a symbol that
    // already exists in the import list.
    const importFrom = importStatement.node;
    importNameInfo = (Array.isArray(importNameInfo) ? importNameInfo : [importNameInfo]).filter(
        (info) =>
            !!info.name &&
            !importFrom.imports.some((importAs) => importAs.name.value === info.name && importAs.alias === info.alias)
    );

    if (importNameInfo.length === 0) {
        return additionEdits;
    }

    for (const nameInfo of importNameInfo) {
        additionEdits.push(
            _getTextEditsForAutoImportSymbolAddition(nameInfo.name!, nameInfo.alias, importStatement.node, parseResults)
        );
    }

    // Merge edits with the same insertion point.
    const editsMap = createMapFromItems(additionEdits, (e) => Range.print(e.range));
    const textEditList: TextEditAction[] = [];
    for (const editGroup of editsMap.values()) {
        if (editGroup.length === 1) {
            textEditList.push(editGroup[0]);
        } else {
            textEditList.push({
                range: editGroup[0].range,
                replacementText: editGroup
                    .sort((a, b) => _compareImportNames(a.importName, b.importName))
                    .map((e) => e.replacementText)
                    .join(''),
            });
        }
    }

    return textEditList;
}

function _compareImportNames(name1: string, name2: string) {
    // Compare import name by import symbol type and then alphabetical order.
    // Match isort default behavior.
    const name1Type = _getImportSymbolNameType(name1);
    const name2Type = _getImportSymbolNameType(name2);
    const compare = name1Type - name2Type;
    if (compare !== 0) {
        return compare;
    }

    // isort will prefer '_' over alphanumerical chars
    // This can't be reproduced by a normal string compare in TypeScript, since '_' > 'A'.
    // Replace all '_' with '=' which guarantees '=' < 'A'.
    // Safe to do as '=' is an invalid char in Python names.
    const name1toCompare = name1.replace(/_/g, '=');
    const name2toCompare = name2.replace(/_/g, '=');
    return compareStringsCaseSensitive(name1toCompare, name2toCompare);
}

interface AdditionEdit extends TextEditAction {
    importName: string;
}

function _getTextEditsForAutoImportSymbolAddition(
    importName: string,
    alias: string | undefined,
    node: ImportFromNode,
    parseResults: ParseResults
): AdditionEdit {
    // Scan through the import symbols to find the right insertion point,
    // assuming we want to keep the imports alphabetized.
    let priorImport: ImportFromAsNode | undefined;
    for (const curImport of node.imports) {
        if (_compareImportNames(curImport.name.value, importName) > 0) {
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
    if (node.imports.length > 0) {
        const importStatementPos = convertOffsetToPosition(node.start, parseResults.tokenizerOutput.lines);
        const firstSymbolPos = convertOffsetToPosition(node.imports[0].start, parseResults.tokenizerOutput.lines);
        const secondSymbolPos =
            node.imports.length > 1
                ? convertOffsetToPosition(node.imports[1].start, parseResults.tokenizerOutput.lines)
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
        : node.imports.length > 0
        ? node.imports[0].start
        : node.start + node.length;
    const insertionPosition = convertOffsetToPosition(insertionOffset, parseResults.tokenizerOutput.lines);

    const insertText = alias ? `${importName} as ${alias}` : `${importName}`;
    let replacementText: string;

    if (useOnePerLineFormatting) {
        const eol = parseResults.tokenizerOutput.predominantEndOfLineSequence;
        replacementText = priorImport ? `,${eol}${indentText}${insertText}` : `${insertText},${eol}${indentText}`;
    } else {
        replacementText = priorImport ? `, ${insertText}` : `${insertText}, `;
    }

    return {
        range: { start: insertionPosition, end: insertionPosition },
        importName,
        replacementText,
    };
}

interface InsertionEdit {
    range: Range;
    preChange: string;
    importStatement: string;
    postChange: string;
    importGroup: ImportGroup;
}

export function getTextEditsForAutoImportInsertions(
    importNameInfo: ImportNameWithModuleInfo[] | ImportNameWithModuleInfo,
    importStatements: ImportStatements,
    parseResults: ParseResults,
    invocationPosition: Position
): TextEditAction[] {
    const insertionEdits: InsertionEdit[] = [];

    importNameInfo = Array.isArray(importNameInfo) ? importNameInfo : [importNameInfo];
    if (importNameInfo.length === 0) {
        return [];
    }

    const map = createMapFromItems(importNameInfo, (i) => i.module.moduleName);
    for (const importInfo of map.values()) {
        insertionEdits.push(
            ..._getInsertionEditsForAutoImportInsertion(
                importInfo,
                importStatements,
                importInfo[0].module.moduleName,
                getImportGroupFromModuleNameAndType(importInfo[0].module),
                parseResults,
                invocationPosition
            )
        );
    }

    return _convertInsertionEditsToTextEdits(parseResults, insertionEdits);
}

export function getTextEditsForAutoImportInsertion(
    importNameInfo: ImportNameInfo[] | ImportNameInfo,
    importStatements: ImportStatements,
    moduleName: string,
    importGroup: ImportGroup,
    parseResults: ParseResults,
    invocationPosition: Position
): TextEditAction[] {
    const insertionEdits = _getInsertionEditsForAutoImportInsertion(
        importNameInfo,
        importStatements,
        moduleName,
        importGroup,
        parseResults,
        invocationPosition
    );

    return _convertInsertionEditsToTextEdits(parseResults, insertionEdits);
}

function _convertInsertionEditsToTextEdits(parseResults: ParseResults, insertionEdits: InsertionEdit[]) {
    if (insertionEdits.length < 2) {
        return insertionEdits.map((e) => getTextEdit(e));
    }

    // Merge edits with the same insertion point.
    const editsMap = [...createMapFromItems(insertionEdits, (e) => `${e.importGroup} ${Range.print(e.range)}`)]
        .sort((a, b) => compareStringsCaseSensitive(a[0], b[0]))
        .map((v) => v[1]);

    const textEditList: TextEditAction[] = [];
    for (const editGroup of editsMap) {
        if (editGroup.length === 1) {
            textEditList.push(getTextEdit(editGroup[0]));
        } else {
            textEditList.push({
                range: editGroup[0].range,
                replacementText:
                    editGroup[0].preChange +
                    editGroup
                        .map((e) => e.importStatement)
                        .sort((a, b) => compareImports(a, b))
                        .join(parseResults.tokenizerOutput.predominantEndOfLineSequence) +
                    editGroup[0].postChange,
            });
        }
    }

    return textEditList;

    function getTextEdit(edit: InsertionEdit): TextEditAction {
        return { range: edit.range, replacementText: edit.preChange + edit.importStatement + edit.postChange };
    }

    function compareImports(a: string, b: string) {
        const isImport1 = a.startsWith('import');
        const isImport2 = b.startsWith('import');

        if (isImport1 === isImport2) {
            return a < b ? -1 : 1;
        }

        return isImport1 ? -1 : 1;
    }
}

function _getInsertionEditsForAutoImportInsertion(
    importNameInfo: ImportNameInfo[] | ImportNameInfo,
    importStatements: ImportStatements,
    moduleName: string,
    importGroup: ImportGroup,
    parseResults: ParseResults,
    invocationPosition: Position
): InsertionEdit[] {
    const insertionEdits: InsertionEdit[] = [];

    importNameInfo = Array.isArray(importNameInfo) ? importNameInfo : [importNameInfo];
    if (importNameInfo.length === 0) {
        // This will let "import [moduleName]" to be generated.
        importNameInfo.push({});
    }

    // We need to emit a new 'from import' statement if symbolName is given. otherwise, use 'import' statement.
    const map = createMapFromItems(importNameInfo, (i) => (i.name ? 'from' : 'import'));

    // Add import statements first.
    const imports = map.get('import');
    if (imports) {
        appendToEdits(imports, (names) => `import ${names.join(', ')}`);
    }

    // Add from import statements next.
    const fromImports = map.get('from');
    if (fromImports) {
        appendToEdits(fromImports, (names) => `from ${moduleName} import ${names.join(', ')}`);
    }

    return insertionEdits;

    function getImportAsText(nameInfo: ImportNameInfo, moduleName: string) {
        const importText = nameInfo.name ? nameInfo.name : moduleName;
        return {
            sortText: importText,
            text: nameInfo.alias ? `${importText} as ${nameInfo.alias}` : importText,
        };
    }

    function appendToEdits(importNameInfo: ImportNameInfo[], importStatementGetter: (n: string[]) => string) {
        const importNames = importNameInfo
            .map((i) => getImportAsText(i, moduleName))
            .sort((a, b) => _compareImportNames(a.sortText, b.sortText))
            .reduce((set, v) => addIfUnique(set, v.text), [] as string[]);

        insertionEdits.push(
            _getInsertionEditForAutoImportInsertion(
                importStatementGetter(importNames),
                importStatements,
                moduleName,
                importGroup,
                parseResults,
                invocationPosition
            )
        );
    }
}

function _getInsertionEditForAutoImportInsertion(
    importStatement: string,
    importStatements: ImportStatements,
    moduleName: string,
    importGroup: ImportGroup,
    parseResults: ParseResults,
    invocationPosition: Position
): InsertionEdit {
    let preChange = '';
    let postChange = '';

    let insertionPosition: Position;
    const invocation = convertPositionToOffset(invocationPosition, parseResults.tokenizerOutput.lines)!;
    if (importStatements.orderedImports.length > 0 && invocation > importStatements.orderedImports[0].node.start) {
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
                    preChange = parseResults.tokenizerOutput.predominantEndOfLineSequence + preChange;
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
                    preChange = parseResults.tokenizerOutput.predominantEndOfLineSequence + preChange;
                }
                break;
            }

            // If this is the last import, see if we need to create a new group.
            if (curImport === importStatements.orderedImports[importStatements.orderedImports.length - 1]) {
                if (importGroup > curImportGroup) {
                    // Add an extra line to create a new group.
                    preChange = parseResults.tokenizerOutput.predominantEndOfLineSequence + preChange;
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
                postChange = postChange + parseResults.tokenizerOutput.predominantEndOfLineSequence;
            } else {
                preChange = parseResults.tokenizerOutput.predominantEndOfLineSequence + preChange;
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

        postChange =
            postChange +
            parseResults.tokenizerOutput.predominantEndOfLineSequence +
            parseResults.tokenizerOutput.predominantEndOfLineSequence;
        if (addNewLineBefore) {
            preChange = parseResults.tokenizerOutput.predominantEndOfLineSequence + preChange;
        } else {
            postChange = postChange + parseResults.tokenizerOutput.predominantEndOfLineSequence;
        }
    }

    const range = { start: insertionPosition, end: insertionPosition };
    return { range, preChange, importStatement, postChange, importGroup };
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

export function getImportGroupFromModuleNameAndType(moduleNameAndType: ModuleNameAndType): ImportGroup {
    let importGroup = ImportGroup.Local;
    if (moduleNameAndType.isLocalTypingsFile || moduleNameAndType.importType === ImportType.ThirdParty) {
        importGroup = ImportGroup.ThirdParty;
    } else if (moduleNameAndType.importType === ImportType.BuiltIn) {
        importGroup = ImportGroup.BuiltIn;
    }

    return importGroup;
}

export function getTextRangeForImportNameDeletion(
    nameNodes: ImportAsNode[] | ImportFromAsNode[],
    nameNodeIndex: number
): TextRange {
    let editSpan: TextRange;
    if (nameNodes.length === 1 && nameNodeIndex === 0) {
        // get span of "import [|A|]"
        editSpan = nameNodes[0];
    } else if (nameNodeIndex === nameNodes.length - 1) {
        // get span of "import A[|, B|]"
        const start = TextRange.getEnd(nameNodes[nameNodeIndex - 1]);
        const length = TextRange.getEnd(nameNodes[nameNodeIndex]) - start;
        editSpan = { start, length };
    } else {
        // get span of "import [|A, |]B"
        const start = nameNodes[nameNodeIndex].start;
        const length = nameNodes[nameNodeIndex + 1].start - start;
        editSpan = { start, length };
    }

    return editSpan;
}

export function getRelativeModuleName(
    fs: FileSystem,
    sourcePath: string,
    targetPath: string,
    ignoreFolderStructure = false,
    sourceIsFile?: boolean
) {
    let srcPath = sourcePath;
    sourceIsFile = sourceIsFile !== undefined ? sourceIsFile : isFile(fs, sourcePath);
    if (sourceIsFile) {
        srcPath = getDirectoryPath(sourcePath);
    }

    let symbolName: string | undefined;
    let destPath = targetPath;
    if (sourceIsFile) {
        destPath = getDirectoryPath(targetPath);

        const fileName = stripFileExtension(getFileName(targetPath));
        if (fileName !== '__init__') {
            // ex) src: a.py, dest: b.py -> ".b" will be returned.
            symbolName = fileName;
        } else if (ignoreFolderStructure) {
            // ex) src: nested1/nested2/__init__.py, dest: nested1/__init__.py -> "...nested1" will be returned
            //     like how it would return for sibling folder.
            //
            // if folder structure is not ignored, ".." will be returned
            symbolName = getFileName(destPath);
            destPath = getDirectoryPath(destPath);
        }
    }

    const relativePaths = getRelativePathComponentsFromDirectory(srcPath, destPath, (f) => fs.realCasePath(f));

    // This assumes both file paths are under the same importing root.
    // So this doesn't handle paths pointing to 2 different import roots.
    // ex) user file A to library file B
    let currentPaths = '.';
    for (let i = 1; i < relativePaths.length; i++) {
        const relativePath = relativePaths[i];
        if (relativePath === '..') {
            currentPaths += '.';
        } else {
            currentPaths += relativePath;
        }

        if (relativePath !== '..' && i !== relativePaths.length - 1) {
            currentPaths += '.';
        }
    }

    if (symbolName) {
        currentPaths =
            currentPaths[currentPaths.length - 1] === '.' ? currentPaths + symbolName : currentPaths + '.' + symbolName;
    }

    return currentPaths;
}

export function getDirectoryLeadingDotsPointsTo(fromDirectory: string, leadingDots: number) {
    let currentDirectory = fromDirectory;
    for (let i = 1; i < leadingDots; i++) {
        if (currentDirectory === '') {
            return undefined;
        }

        currentDirectory = getDirectoryPath(currentDirectory);
    }

    return currentDirectory;
}
