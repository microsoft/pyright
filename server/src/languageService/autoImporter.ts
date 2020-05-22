/*
 * autoImporter.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 */

import { CancellationToken } from 'vscode-languageserver';

import { ImportResolver, ModuleNameAndType } from '../analyzer/importResolver';
import { ImportType } from '../analyzer/importResult';
import {
    getImportGroup,
    getTextEditsForAutoImportInsertion,
    getTextEditsForAutoImportSymbolAddition,
    getTopLevelImports,
    ImportGroup,
    ImportStatements,
} from '../analyzer/importStatementUtils';
import { SourceFile } from '../analyzer/sourceFile';
import { SymbolTable } from '../analyzer/symbol';
import { Symbol } from '../analyzer/symbol';
import * as SymbolNameUtils from '../analyzer/symbolNameUtils';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { ConfigOptions } from '../common/configOptions';
import { TextEditAction } from '../common/editAction';
import { combinePaths, getDirectoryPath, getFileName, stripFileExtension } from '../common/pathUtils';
import * as StringUtils from '../common/stringUtils';
import { ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';

export type ModuleSymbolMap = Map<string, SymbolTable>;

// Build a map of all modules within this program and the module-
// level scope that contains the symbol table for the module.
export function buildModuleSymbolsMap(files: SourceFile[], token: CancellationToken): ModuleSymbolMap {
    const moduleSymbolMap = new Map<string, SymbolTable>();

    files.forEach((file) => {
        throwIfCancellationRequested(token);
        const symbolTable = file.getModuleSymbolTable();
        if (symbolTable) {
            moduleSymbolMap.set(file.getFilePath(), symbolTable);
        }
    });

    return moduleSymbolMap;
}

export interface AutoImportResult {
    name: string;
    symbol?: Symbol;
    source: string;
    edits: TextEditAction[];
}

export class AutoImporter {
    constructor(
        private _configOptions: ConfigOptions,
        private _filePath: string,
        private _importResolver: ImportResolver,
        private _parseResults: ParseResults,
        private _moduleSymbolMap: ModuleSymbolMap
    ) {}

    getAutoImportCandidates(word: string, similarityLimit: number, excludes: string[], token: CancellationToken) {
        const results: AutoImportResult[] = [];

        const importStatements = getTopLevelImports(this._parseResults.parseTree);
        this._moduleSymbolMap.forEach((symbolTable, filePath) => {
            throwIfCancellationRequested(token);

            const fileName = stripFileExtension(getFileName(filePath));

            // Don't offer imports from files that are named with private
            // naming semantics like "_ast.py".
            if (SymbolNameUtils.isPrivateOrProtectedName(fileName)) {
                return;
            }

            symbolTable.forEach((symbol, name) => {
                throwIfCancellationRequested(token);

                // For very short matching strings, we will require an exact match. Otherwise
                // we will tend to return a list that's too long. Once we get beyond two
                // characters, we can do a fuzzy match.
                const isSimilar = this._isSimilar(word, name, similarityLimit);
                if (!isSimilar || symbol.isExternallyHidden()) {
                    return;
                }

                const alreadyIncluded = this._containsName(name, undefined, excludes, results);
                if (alreadyIncluded) {
                    return;
                }

                const declarations = symbol.getDeclarations();
                if (!declarations || declarations.length === 0) {
                    return;
                }

                // Don't include imported symbols, only those that
                // are declared within this file.
                if (declarations[0].path !== filePath) {
                    return;
                }

                let importSource: string;
                let importGroup = ImportGroup.Local;
                let moduleNameAndType: ModuleNameAndType | undefined;

                const localImport = importStatements.mapByFilePath.get(filePath);
                if (localImport) {
                    importSource = localImport.moduleName;
                    importGroup = getImportGroup(localImport);
                } else {
                    moduleNameAndType = this._getModuleNameAndTypeFromFilePath(filePath);
                    importSource = moduleNameAndType.moduleName;
                    if (!importSource) {
                        return;
                    }

                    importGroup = this._getImportGroupFromModuleNameAndType(moduleNameAndType);
                }

                const autoImportTextEdits = this._getTextEditsForAutoImportByFilePath(
                    name,
                    importStatements,
                    filePath,
                    importSource,
                    importGroup
                );

                results.push({ name, symbol, source: importSource, edits: autoImportTextEdits });
            });

            // See if this file should be offered as an implicit import.
            const fileDir = getDirectoryPath(filePath);
            const initPathPy = combinePaths(fileDir, '__init__.py');
            const initPathPyi = initPathPy + 'i';

            // If the current file is in a directory that also contains an "__init__.py[i]"
            // file, we can use that directory name as an implicit import target.
            if (!this._moduleSymbolMap.has(initPathPy) && !this._moduleSymbolMap.has(initPathPyi)) {
                return;
            }

            const name = stripFileExtension(getFileName(filePath));
            const moduleNameAndType = this._getModuleNameAndTypeFromFilePath(getDirectoryPath(filePath));
            const importSource = moduleNameAndType.moduleName;
            if (!importSource) {
                return;
            }

            const isSimilar = this._isSimilar(word, name, similarityLimit);
            if (!isSimilar) {
                return;
            }

            const alreadyIncluded = this._containsName(name, importSource, excludes, results);
            if (alreadyIncluded) {
                return;
            }

            const importGroup = this._getImportGroupFromModuleNameAndType(moduleNameAndType);
            const autoImportTextEdits = this._getTextEditsForAutoImportByFilePath(
                name,
                importStatements,
                filePath,
                importSource,
                importGroup
            );

            results.push({ name, symbol: undefined, source: importSource, edits: autoImportTextEdits });
        });

        return results;
    }

    private _isSimilar(word: string, name: string, similarityLimit: number) {
        return word.length > 2
            ? StringUtils.computeCompletionSimilarity(word, name) > similarityLimit
            : word.length > 0 && name.startsWith(word);
    }

    private _containsName(name: string, source: string | undefined, excludes: string[], results: AutoImportResult[]) {
        if (excludes.find((e) => e === name)) {
            return true;
        }

        if (results.find((r) => r.name === name && r.source === source)) {
            return true;
        }

        return false;
    }

    // Given the file path of a module that we want to import,
    // convert to a module name that can be used in an
    // 'import from' statement.
    private _getModuleNameAndTypeFromFilePath(filePath: string): ModuleNameAndType {
        const execEnvironment = this._configOptions.findExecEnvironment(this._filePath);
        return this._importResolver.getModuleNameForImport(filePath, execEnvironment);
    }

    private _getImportGroupFromModuleNameAndType(moduleNameAndType: ModuleNameAndType): ImportGroup {
        let importGroup = ImportGroup.Local;
        if (moduleNameAndType.isLocalTypingsFile || moduleNameAndType.importType === ImportType.ThirdParty) {
            importGroup = ImportGroup.ThirdParty;
        } else if (moduleNameAndType.importType === ImportType.BuiltIn) {
            importGroup = ImportGroup.BuiltIn;
        }

        return importGroup;
    }

    private _getTextEditsForAutoImportByFilePath(
        symbolName: string,
        importStatements: ImportStatements,
        filePath: string,
        moduleName: string,
        importGroup: ImportGroup
    ): TextEditAction[] {
        // Does an 'import from' statement already exist? If so, we'll reuse it.
        const importStatement = importStatements.mapByFilePath.get(filePath);
        if (importStatement && importStatement.node.nodeType === ParseNodeType.ImportFrom) {
            return getTextEditsForAutoImportSymbolAddition(symbolName, importStatement, this._parseResults);
        }

        return getTextEditsForAutoImportInsertion(
            symbolName,
            importStatements,
            moduleName,
            importGroup,
            this._parseResults
        );
    }
}
