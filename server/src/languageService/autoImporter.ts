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
import { SourceFileInfo } from '../analyzer/program';
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

export type ImportName = string;
export type FullImportName = string;
export type FilePath = string;

export type ImportsMap = Map<FullImportName, FilePath>;
export type ImportNameMap = Map<ImportName, ImportsMap>;

// Build a map of all modules within this program and the module-
// level scope that contains the symbol table for the module.
export function buildModuleSymbolsMap(files: SourceFileInfo[], token: CancellationToken): ModuleSymbolMap {
    const moduleSymbolMap = new Map<string, SymbolTable>();

    files.forEach((file) => {
        throwIfCancellationRequested(token);

        if (file.shadows.length > 0) {
            // There is corresponding stub file. Don't add
            // duplicated files in the map.
            return;
        }

        const symbolTable = file.sourceFile.getModuleSymbolTable();
        if (symbolTable) {
            moduleSymbolMap.set(file.sourceFile.getFilePath(), symbolTable);
        }
    });

    return moduleSymbolMap;
}

export interface AutoImportResult {
    isImportFrom: boolean;
    name: string;
    symbol?: Symbol;
    source: string;
    edits: TextEditAction[];
    alias?: string;
}

interface ImportParts {
    namePart?: string;
    importName: string;
    importSource: string;
    filePath: string;
    moduleAndType: ModuleNameAndType;
}

export class AutoImporter {
    constructor(
        private _configOptions: ConfigOptions,
        private _filePath: string,
        private _importResolver: ImportResolver,
        private _parseResults: ParseResults,
        private _moduleSymbolMap: ModuleSymbolMap,
        private _packageMap?: ImportNameMap
    ) {}

    getAutoImportCandidates(
        word: string,
        similarityLimit: number,
        excludes: string[],
        aliasName: string | undefined,
        token: CancellationToken
    ) {
        const results: AutoImportResult[] = [];
        const importStatements = getTopLevelImports(this._parseResults.parseTree);

        this._addImportsFromModuleMap(word, similarityLimit, excludes, aliasName, importStatements, results, token);
        this._addImportsFromPackages(word, similarityLimit, excludes, aliasName, importStatements, results, token);

        return results;
    }

    private _addImportsFromPackages(
        word: string,
        similarityLimit: number,
        excludes: string[],
        aliasName: string | undefined,
        importStatements: ImportStatements,
        results: AutoImportResult[],
        token: CancellationToken
    ) {
        if (!this._packageMap) {
            return;
        }

        this._packageMap.forEach((imports, name) => {
            throwIfCancellationRequested(token);

            // Don't offer imports from files that are named with private
            // naming semantics like "_ast.py".
            if (SymbolNameUtils.isPrivateOrProtectedName(name)) {
                return;
            }

            const isSimilar = this._isSimilar(word, name, similarityLimit);
            if (!isSimilar) {
                return;
            }

            imports.forEach((filePath, fullImport) => {
                throwIfCancellationRequested(token);
                const importParts = this._getImportParts(filePath);
                if (!importParts) {
                    return;
                }
                this._addAutoImports(importParts, excludes, importStatements, aliasName, results);
            });
        });
    }

    private _addImportsFromModuleMap(
        word: string,
        similarityLimit: number,
        excludes: string[],
        aliasName: string | undefined,
        importStatements: ImportStatements,
        results: AutoImportResult[],
        token: CancellationToken
    ) {
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
                    importGroup,
                    aliasName
                );

                results.push({
                    name,
                    symbol,
                    source: importSource,
                    edits: autoImportTextEdits,
                    isImportFrom: true,
                    alias: aliasName,
                });
            });

            // See if this file should be offered as an implicit import.
            const fileDir = getDirectoryPath(filePath);
            const initPathPy = combinePaths(fileDir, '__init__.py');
            const initPathPyi = initPathPy + 'i';
            const isStubFile = filePath.endsWith('.pyi');
            const hasInit = this._moduleSymbolMap.has(initPathPy) || this._moduleSymbolMap.has(initPathPyi);

            // If the current file is in a directory that also contains an "__init__.py[i]"
            // file, we can use that directory name as an implicit import target.
            // Or if the file is a stub file, we can use it as import target.
            if (!isStubFile && !hasInit) {
                return;
            }

            const importParts = this._getImportParts(filePath);
            if (!importParts) {
                return;
            }

            const isSimilar = this._isSimilar(word, importParts.importName, similarityLimit);
            if (!isSimilar) {
                return;
            }

            this._addAutoImports(importParts, excludes, importStatements, aliasName, results);
        });
    }

    private _addAutoImports(
        importParts: ImportParts,
        excludes: string[],
        importStatements: ImportStatements,
        aliasName: string | undefined,
        results: AutoImportResult[]
    ) {
        const alreadyIncluded = this._containsName(importParts.importName, importParts.importSource, excludes, results);
        if (alreadyIncluded) {
            return;
        }

        const importGroup = this._getImportGroupFromModuleNameAndType(importParts.moduleAndType);
        const autoImportTextEdits = this._getTextEditsForAutoImportByFilePath(
            importParts.namePart,
            importStatements,
            importParts.filePath,
            importParts.importSource,
            importGroup,
            aliasName
        );

        results.push({
            name: importParts.importName,
            alias: aliasName,
            symbol: undefined,
            source: importParts.importSource,
            edits: autoImportTextEdits,
            isImportFrom: !!importParts.namePart,
        });
    }

    private _getImportParts(filePath: string) {
        const name = stripFileExtension(getFileName(filePath));

        // See if we can import module as "import xxx"
        if (name === '__init__') {
            return createImportParts(this._getModuleNameAndTypeFromFilePath(getDirectoryPath(filePath)));
        }

        return createImportParts(this._getModuleNameAndTypeFromFilePath(filePath));

        function createImportParts(module: ModuleNameAndType) {
            const importSource = module.moduleName;
            if (!importSource) {
                return;
            }

            const index = importSource.lastIndexOf('.');
            const importNamePart = index > 0 ? importSource.substring(index + 1) : undefined;
            return {
                namePart: importNamePart,
                importName: index > 0 ? importNamePart! : importSource,
                importSource: index > 0 ? importSource.substring(0, index) : importSource,
                filePath,
                moduleAndType: module,
            };
        }
    }

    private _isSimilar(word: string, name: string, similarityLimit: number) {
        if (similarityLimit === 1) {
            return word === name;
        }

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
        symbolName: string | undefined,
        importStatements: ImportStatements,
        filePath: string,
        moduleName: string,
        importGroup: ImportGroup,
        aliasName: string | undefined
    ): TextEditAction[] {
        if (symbolName) {
            // Does an 'import from' statement already exist? If so, we'll reuse it.
            const importStatement = importStatements.mapByFilePath.get(filePath);
            if (importStatement && importStatement.node.nodeType === ParseNodeType.ImportFrom) {
                return getTextEditsForAutoImportSymbolAddition(
                    symbolName,
                    importStatement,
                    this._parseResults,
                    aliasName
                );
            }
        }

        return getTextEditsForAutoImportInsertion(
            symbolName,
            importStatements,
            moduleName,
            importGroup,
            this._parseResults,
            aliasName
        );
    }
}
