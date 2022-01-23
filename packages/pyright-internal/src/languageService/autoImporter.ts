/*
 * autoImporter.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 */

import { CancellationToken, CompletionItemKind, SymbolKind } from 'vscode-languageserver';

import { DeclarationType } from '../analyzer/declaration';
import { ImportResolver, ModuleNameAndType } from '../analyzer/importResolver';
import { ImportType } from '../analyzer/importResult';
import {
    getImportGroup,
    getImportGroupFromModuleNameAndType,
    getTextEditsForAutoImportInsertion,
    getTextEditsForAutoImportSymbolAddition,
    getTopLevelImports,
    ImportGroup,
    ImportStatements,
} from '../analyzer/importStatementUtils';
import { SourceFileInfo } from '../analyzer/program';
import { Symbol } from '../analyzer/symbol';
import * as SymbolNameUtils from '../analyzer/symbolNameUtils';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { ExecutionEnvironment } from '../common/configOptions';
import { TextEditAction } from '../common/editAction';
import { combinePaths, getDirectoryPath, getFileName, stripFileExtension } from '../common/pathUtils';
import * as StringUtils from '../common/stringUtils';
import { Position } from '../common/textRange';
import { Duration } from '../common/timing';
import { ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { CompletionMap } from './completionProvider';
import { IndexAliasData, IndexResults } from './documentSymbolProvider';

export interface AutoImportSymbol {
    readonly importAlias?: IndexAliasData | undefined;
    readonly symbol?: Symbol | undefined;
    readonly kind?: SymbolKind | undefined;
    readonly itemKind?: CompletionItemKind | undefined;
}

export interface ModuleSymbolTable {
    forEach(callbackfn: (symbol: AutoImportSymbol, name: string, library: boolean) => void): void;
}

export type ModuleSymbolMap = Map<string, ModuleSymbolTable>;

export interface AbbreviationInfo {
    importFrom?: string | undefined;
    importName: string;
}

export interface AutoImportResult {
    name: string;
    symbol?: Symbol | undefined;
    source?: string | undefined;
    insertionText: string;
    edits?: TextEditAction[] | undefined;
    alias?: string | undefined;
    kind?: CompletionItemKind | undefined;
}

export interface AutoImportOptions {
    libraryMap?: Map<string, IndexResults> | undefined;
    patternMatcher?: ((pattern: string, name: string) => boolean) | undefined;
    allowVariableInAll?: boolean | undefined;
    lazyEdit?: boolean | undefined;
}

interface ImportParts {
    importName: string;
    symbolName?: string | undefined;
    importFrom?: string | undefined;
    filePath: string;
    dotCount: number;
    moduleNameAndType: ModuleNameAndType;
}

interface ImportAliasData {
    importParts: ImportParts;
    importGroup: ImportGroup;
    symbol?: Symbol | undefined;
    kind?: SymbolKind | undefined;
    itemKind?: CompletionItemKind | undefined;
}

type AutoImportResultMap = Map<string, AutoImportResult[]>;

// Build a map of all modules within this program and the module-
// level scope that contains the symbol table for the module.
export function buildModuleSymbolsMap(
    files: SourceFileInfo[],
    includeIndexUserSymbols: boolean,
    token: CancellationToken
): ModuleSymbolMap {
    const moduleSymbolMap = new Map<string, ModuleSymbolTable>();

    throwIfCancellationRequested(token);

    files.forEach((file) => {
        if (file.shadows.length > 0) {
            // There is corresponding stub file. Don't add
            // duplicated files in the map.
            return;
        }

        const filePath = file.sourceFile.getFilePath();
        const symbolTable = file.sourceFile.getModuleSymbolTable();
        if (symbolTable) {
            const fileName = stripFileExtension(getFileName(filePath));

            // Don't offer imports from files that are named with private
            // naming semantics like "_ast.py".
            if (SymbolNameUtils.isPrivateOrProtectedName(fileName)) {
                return;
            }

            moduleSymbolMap.set(filePath, {
                forEach(callbackfn: (value: AutoImportSymbol, key: string, library: boolean) => void): void {
                    symbolTable.forEach((symbol, name) => {
                        if (symbol.isExternallyHidden()) {
                            return;
                        }

                        const declarations = symbol.getDeclarations();
                        if (!declarations || declarations.length === 0) {
                            return;
                        }

                        const declaration = declarations[0];
                        if (!declaration) {
                            return;
                        }

                        if (declaration.type === DeclarationType.Alias) {
                            // We don't include import alias in auto import
                            // for workspace files.
                            return;
                        }

                        const variableKind =
                            declaration.type === DeclarationType.Variable &&
                            !declaration.isConstant &&
                            !declaration.isFinal
                                ? SymbolKind.Variable
                                : undefined;
                        callbackfn({ symbol, kind: variableKind }, name, /* library */ false);
                    });
                },
            });
            return;
        }

        // Iterate through closed user files using indices if asked.
        const indexResults = file.sourceFile.getCachedIndexResults();
        if (indexResults && includeIndexUserSymbols && !indexResults.privateOrProtected) {
            moduleSymbolMap.set(filePath, createModuleSymbolTableFromIndexResult(indexResults, /* library */ false));
            return;
        }
    });

    return moduleSymbolMap;
}

export class AutoImporter {
    private _importStatements: ImportStatements;

    // Track some auto import internal perf numbers.
    private _stopWatch = new Duration();
    private _perfInfo = {
        indexUsed: false,
        totalInMs: 0,

        moduleTimeInMS: 0,
        indexTimeInMS: 0,
        importAliasTimeInMS: 0,

        symbolCount: 0,
        indexCount: 0,
        importAliasCount: 0,
    };

    constructor(
        private _execEnvironment: ExecutionEnvironment,
        private _importResolver: ImportResolver,
        private _parseResults: ParseResults,
        private _invocationPosition: Position,
        private readonly _excludes: CompletionMap,
        private _moduleSymbolMap: ModuleSymbolMap,
        private _options: AutoImportOptions
    ) {
        this._importStatements = getTopLevelImports(this._parseResults.parseTree, true);

        this._perfInfo.indexUsed = !!this._options.libraryMap;
    }

    getAutoImportCandidatesForAbbr(abbr: string | undefined, abbrInfo: AbbreviationInfo, token: CancellationToken) {
        const map = this._getCandidates(abbrInfo.importName, /* similarityLimit */ 1, abbr, token);
        const result = map.get(abbrInfo.importName);
        if (!result) {
            return [];
        }

        return result.filter((r) => r.source === abbrInfo.importFrom);
    }

    getAutoImportCandidates(
        word: string,
        similarityLimit: number,
        abbrFromUsers: string | undefined,
        token: CancellationToken
    ) {
        const results: AutoImportResult[] = [];
        const map = this._getCandidates(word, similarityLimit, abbrFromUsers, token);

        map.forEach((v) => results.push(...v));
        return results;
    }

    getPerfInfo() {
        this._perfInfo.totalInMs = this._stopWatch.getDurationInMilliseconds();
        return this._perfInfo;
    }

    private _getCandidates(
        word: string,
        similarityLimit: number,
        abbrFromUsers: string | undefined,
        token: CancellationToken
    ) {
        const resultMap = new Map<string, AutoImportResult[]>();
        const importAliasMap = new Map<string, Map<string, ImportAliasData>>();

        this._addImportsFromModuleMap(word, similarityLimit, abbrFromUsers, importAliasMap, resultMap, token);
        this._addImportsFromLibraryMap(word, similarityLimit, abbrFromUsers, importAliasMap, resultMap, token);
        this._addImportsFromImportAliasMap(importAliasMap, abbrFromUsers, resultMap, token);

        return resultMap;
    }

    private _addImportsFromLibraryMap(
        word: string,
        similarityLimit: number,
        abbrFromUsers: string | undefined,
        aliasMap: Map<string, Map<string, ImportAliasData>>,
        results: AutoImportResultMap,
        token: CancellationToken
    ) {
        const startTime = this._stopWatch.getDurationInMilliseconds();

        this._options.libraryMap?.forEach((indexResults, filePath) => {
            if (indexResults.privateOrProtected) {
                return;
            }

            if (this._moduleSymbolMap.has(filePath)) {
                // Module map is already taking care of this file. this can happen if the module is used by
                // user code.
                return;
            }

            // See if this file should be offered as an implicit import.
            const isStubFileOrHasInit = this._isStubFileOrHasInit(this._options.libraryMap!, filePath);
            this._processModuleSymbolTable(
                createModuleSymbolTableFromIndexResult(indexResults, /* library */ true),
                filePath,
                word,
                similarityLimit,
                isStubFileOrHasInit,
                abbrFromUsers,
                aliasMap,
                results,
                token
            );
        });

        this._perfInfo.indexTimeInMS = this._stopWatch.getDurationInMilliseconds() - startTime;
    }

    private _addImportsFromModuleMap(
        word: string,
        similarityLimit: number,
        abbrFromUsers: string | undefined,
        aliasMap: Map<string, Map<string, ImportAliasData>>,
        results: AutoImportResultMap,
        token: CancellationToken
    ) {
        const startTime = this._stopWatch.getDurationInMilliseconds();

        this._moduleSymbolMap.forEach((topLevelSymbols, filePath) => {
            // See if this file should be offered as an implicit import.
            const isStubFileOrHasInit = this._isStubFileOrHasInit(this._moduleSymbolMap!, filePath);
            this._processModuleSymbolTable(
                topLevelSymbols,
                filePath,
                word,
                similarityLimit,
                isStubFileOrHasInit,
                abbrFromUsers,
                aliasMap,
                results,
                token
            );
        });

        this._perfInfo.moduleTimeInMS = this._stopWatch.getDurationInMilliseconds() - startTime;
    }

    private _isStubFileOrHasInit<T>(map: Map<string, T>, filePath: string) {
        const fileDir = getDirectoryPath(filePath);
        const initPathPy = combinePaths(fileDir, '__init__.py');
        const initPathPyi = initPathPy + 'i';
        const isStub = filePath.endsWith('.pyi');
        const hasInit = map.has(initPathPy) || map.has(initPathPyi);
        return { isStub, hasInit };
    }

    private _processModuleSymbolTable(
        topLevelSymbols: ModuleSymbolTable,
        filePath: string,
        word: string,
        similarityLimit: number,
        isStubOrHasInit: { isStub: boolean; hasInit: boolean },
        abbrFromUsers: string | undefined,
        importAliasMap: Map<string, Map<string, ImportAliasData>>,
        results: AutoImportResultMap,
        token: CancellationToken
    ) {
        throwIfCancellationRequested(token);

        const [importSource, importGroup, moduleNameAndType] = this._getImportPartsForSymbols(filePath);
        if (!importSource) {
            return;
        }

        const dotCount = StringUtils.getCharacterCount(importSource, '.');
        topLevelSymbols.forEach((autoImportSymbol, name, library) => {
            this._perfIndexCount(autoImportSymbol, library);

            if (!this._shouldIncludeVariable(autoImportSymbol, name, isStubOrHasInit.isStub, library)) {
                return;
            }

            // For very short matching strings, we will require an exact match. Otherwise
            // we will tend to return a list that's too long. Once we get beyond two
            // characters, we can do a fuzzy match.
            const isSimilar = this._isSimilar(word, name, similarityLimit);
            if (!isSimilar) {
                return;
            }

            const alreadyIncluded = this._containsName(name, importSource, results);
            if (alreadyIncluded) {
                return;
            }

            // We will collect all aliases and then process it later
            if (autoImportSymbol.importAlias) {
                this._addToImportAliasMap(
                    autoImportSymbol.importAlias,
                    {
                        importParts: {
                            symbolName: name,
                            importName: name,
                            importFrom: importSource,
                            filePath,
                            dotCount,
                            moduleNameAndType,
                        },
                        importGroup,
                        symbol: autoImportSymbol.symbol,
                        kind: autoImportSymbol.importAlias.kind,
                        itemKind: autoImportSymbol.importAlias.itemKind,
                    },
                    importAliasMap
                );
                return;
            }

            const autoImportTextEdits = this._getTextEditsForAutoImportByFilePath(
                importSource,
                name,
                abbrFromUsers,
                name,
                importGroup,
                filePath
            );

            this._addResult(results, {
                name,
                alias: abbrFromUsers,
                symbol: autoImportSymbol.symbol,
                source: importSource,
                kind: autoImportSymbol.itemKind ?? convertSymbolKindToCompletionItemKind(autoImportSymbol.kind),
                insertionText: autoImportTextEdits.insertionText,
                edits: autoImportTextEdits.edits,
            });
        });

        // If the current file is in a directory that also contains an "__init__.py[i]"
        // file, we can use that directory name as an implicit import target.
        // Or if the file is a stub file, we can use it as import target.
        if (!isStubOrHasInit.isStub && !isStubOrHasInit.hasInit) {
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

        const alreadyIncluded = this._containsName(importParts.importName, importParts.importFrom, results);
        if (alreadyIncluded) {
            return;
        }

        this._addToImportAliasMap(
            {
                modulePath: filePath,
                originalName: importParts.importName,
                kind: SymbolKind.Module,
                itemKind: CompletionItemKind.Module,
            },
            { importParts, importGroup, kind: SymbolKind.Module, itemKind: CompletionItemKind.Module },
            importAliasMap
        );
    }

    private _shouldIncludeVariable(
        autoImportSymbol: AutoImportSymbol,
        name: string,
        isStub: boolean,
        library: boolean
    ) {
        // If it is not a stub file and symbol is Variable, we only include it if
        // name is public constant or type alias unless it is in __all__ for user files.
        if (isStub || autoImportSymbol.kind !== SymbolKind.Variable) {
            return true;
        }

        if (this._options.allowVariableInAll && !library && autoImportSymbol.symbol?.isInDunderAll()) {
            return true;
        }

        return SymbolNameUtils.isPublicConstantOrTypeAlias(name);
    }

    private _addImportsFromImportAliasMap(
        importAliasMap: Map<string, Map<string, ImportAliasData>>,
        abbrFromUsers: string | undefined,
        results: AutoImportResultMap,
        token: CancellationToken
    ) {
        throwIfCancellationRequested(token);

        const startTime = this._stopWatch.getDurationInMilliseconds();

        importAliasMap.forEach((mapPerSymbolName) => {
            this._perfInfo.importAliasCount += mapPerSymbolName.size;

            mapPerSymbolName.forEach((importAliasData) => {
                if (abbrFromUsers) {
                    // When alias name is used, our regular exclude mechanism would not work. we need to check
                    // whether import, the alias is referring to, already exists.
                    // ex) import numpy
                    //     np| <= auto-import here.
                    // or
                    //     from scipy import io as spio
                    //     io| <= auto-import here

                    // If import statement for the module already exist, then bail out.
                    // ex) import module[.submodule] or from module[.submodule] import symbol
                    if (this._importStatements.mapByFilePath.has(importAliasData.importParts.filePath)) {
                        return;
                    }

                    // If it is the module itself that got imported, make sure we don't import it again.
                    // ex) from module import submodule as ss
                    //     submodule <= auto-import here
                    if (importAliasData.importParts.importFrom) {
                        const imported = this._importStatements.orderedImports.find(
                            (i) => i.moduleName === importAliasData.importParts.importFrom
                        );
                        if (
                            imported &&
                            imported.node.nodeType === ParseNodeType.ImportFrom &&
                            imported.node.imports.some((i) => i.name.value === importAliasData.importParts.symbolName)
                        ) {
                            return;
                        }
                    }
                }

                const alreadyIncluded = this._containsName(
                    importAliasData.importParts.importName,
                    importAliasData.importParts.importFrom,
                    results
                );
                if (alreadyIncluded) {
                    return;
                }

                const autoImportTextEdits = this._getTextEditsForAutoImportByFilePath(
                    importAliasData.importParts.importFrom ?? importAliasData.importParts.importName,
                    importAliasData.importParts.symbolName,
                    abbrFromUsers,
                    importAliasData.importParts.importName,
                    importAliasData.importGroup,
                    importAliasData.importParts.filePath
                );

                this._addResult(results, {
                    name: importAliasData.importParts.importName,
                    alias: abbrFromUsers,
                    symbol: importAliasData.symbol,
                    kind: importAliasData.itemKind ?? convertSymbolKindToCompletionItemKind(importAliasData.kind),
                    source: importAliasData.importParts.importFrom,
                    insertionText: autoImportTextEdits.insertionText,
                    edits: autoImportTextEdits.edits,
                });
            });
        });

        this._perfInfo.importAliasTimeInMS = this._stopWatch.getDurationInMilliseconds() - startTime;
    }

    private _addToImportAliasMap(
        alias: IndexAliasData,
        data: ImportAliasData,
        importAliasMap: Map<string, Map<string, ImportAliasData>>
    ) {
        // Since we don't resolve alias declaration using type evaluator, there is still a chance
        // where we show multiple aliases for same symbols. but this should still reduce number of
        // such cases.
        if (!importAliasMap.has(alias.modulePath)) {
            const map = new Map<string, ImportAliasData>();
            map.set(alias.originalName, data);
            importAliasMap.set(alias.modulePath, map);
            return;
        }

        const map = importAliasMap.get(alias.modulePath)!;
        if (!map.has(alias.originalName)) {
            map.set(alias.originalName, data);
            return;
        }

        const existingData = map.get(alias.originalName)!;
        const comparison = this._compareImportAliasData(existingData, data);
        if (comparison <= 0) {
            // Existing data is better than new one.
            return;
        }

        // Keep the new data.
        map.set(alias.originalName, data);
    }

    private _compareImportAliasData(left: ImportAliasData, right: ImportAliasData) {
        const groupComparison = left.importGroup - right.importGroup;
        if (groupComparison !== 0) {
            return groupComparison;
        }

        const dotComparison = left.importParts.dotCount - right.importParts.dotCount;
        if (dotComparison !== 0) {
            return dotComparison;
        }

        if (left.symbol && !right.symbol) {
            return -1;
        }

        if (!left.symbol && right.symbol) {
            return 1;
        }

        return StringUtils.getStringComparer()(left.importParts.importName, right.importParts.importName);
    }

    private _getImportPartsForSymbols(filePath: string): [string | undefined, ImportGroup, ModuleNameAndType] {
        const localImport = this._importStatements.mapByFilePath.get(filePath);
        if (localImport) {
            return [
                localImport.moduleName,
                getImportGroup(localImport),
                {
                    importType: ImportType.Local,
                    isLocalTypingsFile: false,
                    moduleName: localImport.moduleName,
                },
            ];
        } else {
            const moduleNameAndType = this._getModuleNameAndTypeFromFilePath(filePath);
            return [
                moduleNameAndType.moduleName,
                getImportGroupFromModuleNameAndType(moduleNameAndType),
                moduleNameAndType,
            ];
        }
    }

    private _getImportParts(filePath: string) {
        const name = stripFileExtension(getFileName(filePath));

        // See if we can import module as "import xxx"
        if (name === '__init__') {
            return createImportParts(this._getModuleNameAndTypeFromFilePath(getDirectoryPath(filePath)));
        }

        return createImportParts(this._getModuleNameAndTypeFromFilePath(filePath));

        function createImportParts(module: ModuleNameAndType): ImportParts | undefined {
            const moduleName = module.moduleName;
            if (!moduleName) {
                return undefined;
            }

            const index = moduleName.lastIndexOf('.');
            const importNamePart = index > 0 ? moduleName.substring(index + 1) : undefined;
            const importFrom = index > 0 ? moduleName.substring(0, index) : undefined;
            return {
                symbolName: importNamePart,
                importName: importNamePart ?? moduleName,
                importFrom,
                filePath,
                dotCount: StringUtils.getCharacterCount(moduleName, '.'),
                moduleNameAndType: module,
            };
        }
    }

    private _isSimilar(word: string, name: string, similarityLimit: number) {
        if (similarityLimit === 1) {
            return word === name;
        }

        if (word.length <= 0 || name.length <= 0) {
            return false;
        }

        if (!this._options.patternMatcher) {
            const index = word[0] !== '_' && name[0] === '_' && name.length > 1 ? 1 : 0;
            if (word[0].toLocaleLowerCase() !== name[index].toLocaleLowerCase()) {
                return false;
            }

            return StringUtils.isPatternInSymbol(word, name);
        }

        return this._options.patternMatcher(word, name);
    }

    private _shouldExclude(name: string) {
        return this._excludes.has(name, CompletionMap.labelOnlyIgnoringAutoImports);
    }
    private _containsName(name: string, source: string | undefined, results: AutoImportResultMap) {
        if (this._shouldExclude(name)) {
            return true;
        }

        const match = results.get(name);
        if (match?.some((r) => r.source === source)) {
            return true;
        }

        return false;
    }

    // Given the file path of a module that we want to import,
    // convert to a module name that can be used in an
    // 'import from' statement.
    private _getModuleNameAndTypeFromFilePath(filePath: string): ModuleNameAndType {
        return this._importResolver.getModuleNameForImport(filePath, this._execEnvironment);
    }

    private _getTextEditsForAutoImportByFilePath(
        moduleName: string,
        importName: string | undefined,
        abbrFromUsers: string | undefined,
        insertionText: string,
        importGroup: ImportGroup,
        filePath: string
    ): { insertionText: string; edits?: TextEditAction[] | undefined } {
        // If there is no symbolName, there can't be existing import statement.
        const importStatement = this._importStatements.mapByFilePath.get(filePath);
        if (importStatement) {
            // Found import for given module. See whether we can use the module as it is.
            if (importStatement.node.nodeType === ParseNodeType.Import) {
                // For now, we don't check whether alias or moduleName got overwritten at
                // given position
                const importAlias = importStatement.subnode?.alias?.value;
                if (importName) {
                    // ex) import module
                    //     method | <= auto-import
                    return {
                        insertionText: `${importAlias ?? importStatement.moduleName}.${importName}`,
                        edits: [],
                    };
                } else if (importAlias) {
                    // ex) import module as m
                    //     m | <= auto-import
                    return {
                        insertionText: `${importAlias}`,
                        edits: [],
                    };
                }
            }

            // Does an 'import from' statement already exist?
            if (
                importName &&
                importStatement.node.nodeType === ParseNodeType.ImportFrom &&
                !importStatement.node.isWildcardImport
            ) {
                // If so, see whether what we want already exist.
                const importNode = importStatement.node.imports.find((i) => i.name.value === importName);
                if (importNode) {
                    // For now, we don't check whether alias or moduleName got overwritten at
                    // given position
                    const importAlias = importNode.alias?.value;
                    return {
                        insertionText: `${importAlias ?? importName}`,
                        edits: [],
                    };
                }

                // If not, add what we want at the existing 'import from' statement as long as
                // what is imported is not module itself.
                // ex) don't add "path" to existing "from os.path import dirname" statement.
                if (moduleName === importStatement.moduleName) {
                    return {
                        insertionText: abbrFromUsers ?? insertionText,
                        edits: this._options.lazyEdit
                            ? undefined
                            : getTextEditsForAutoImportSymbolAddition(
                                  { name: importName, alias: abbrFromUsers },
                                  importStatement,
                                  this._parseResults
                              ),
                    };
                }
            }
        } else if (importName) {
            // If it is the module itself that got imported, make sure we don't import it again.
            // ex) from module import submodule
            const imported = this._importStatements.orderedImports.find((i) => i.moduleName === moduleName);
            if (imported && imported.node.nodeType === ParseNodeType.ImportFrom && !imported.node.isWildcardImport) {
                const importFrom = imported.node.imports.find((i) => i.name.value === importName);
                if (importFrom) {
                    // For now, we don't check whether alias or moduleName got overwritten at
                    // given position. only move to alias, but not the other way around
                    const importAlias = importFrom.alias?.value;
                    if (importAlias) {
                        return {
                            insertionText: `${importAlias}`,
                            edits: [],
                        };
                    }
                } else {
                    // If not, add what we want at the existing import from statement.
                    return {
                        insertionText: abbrFromUsers ?? insertionText,
                        edits: this._options.lazyEdit
                            ? undefined
                            : getTextEditsForAutoImportSymbolAddition(
                                  { name: importName, alias: abbrFromUsers },
                                  imported,
                                  this._parseResults
                              ),
                    };
                }
            }

            // Check whether it is one of implicit imports
            const importFrom = this._importStatements.implicitImports?.get(filePath);
            if (importFrom) {
                // For now, we don't check whether alias or moduleName got overwritten at
                // given position
                const importAlias = importFrom.alias?.value;
                return {
                    insertionText: `${importAlias ?? importFrom.name.value}.${importName}`,
                    edits: [],
                };
            }
        }

        return {
            insertionText: abbrFromUsers ?? insertionText,
            edits: this._options.lazyEdit
                ? undefined
                : getTextEditsForAutoImportInsertion(
                      { name: importName, alias: abbrFromUsers },
                      this._importStatements,
                      moduleName,
                      importGroup,
                      this._parseResults,
                      this._invocationPosition
                  ),
        };
    }

    private _perfIndexCount(autoImportSymbol: AutoImportSymbol, library: boolean) {
        if (autoImportSymbol.symbol) {
            this._perfInfo.symbolCount++;
        } else if (library) {
            this._perfInfo.indexCount++;
        }
    }

    private _addResult(results: AutoImportResultMap, result: AutoImportResult) {
        let entries = results.get(result.name);
        if (!entries) {
            entries = [];
            results.set(result.name, entries);
        }

        entries.push(result);
    }
}

function createModuleSymbolTableFromIndexResult(indexResults: IndexResults, library: boolean): ModuleSymbolTable {
    return {
        forEach(callbackfn: (value: AutoImportSymbol, key: string, library: boolean) => void): void {
            indexResults.symbols.forEach((data) => {
                if (!data.externallyVisible) {
                    return;
                }

                callbackfn(
                    {
                        importAlias: data.alias,
                        kind: data.kind,
                        itemKind: data.itemKind,
                    },
                    data.name,
                    library
                );
            });
        },
    };
}

export function convertSymbolKindToCompletionItemKind(kind: SymbolKind | undefined) {
    switch (kind) {
        case SymbolKind.File:
            return CompletionItemKind.File;

        case SymbolKind.Module:
        case SymbolKind.Namespace:
            return CompletionItemKind.Module;

        case SymbolKind.Package:
            return CompletionItemKind.Folder;

        case SymbolKind.Class:
            return CompletionItemKind.Class;

        case SymbolKind.Method:
            return CompletionItemKind.Method;

        case SymbolKind.Property:
            return CompletionItemKind.Property;

        case SymbolKind.Field:
            return CompletionItemKind.Field;

        case SymbolKind.Constructor:
            return CompletionItemKind.Constructor;

        case SymbolKind.Enum:
            return CompletionItemKind.Enum;

        case SymbolKind.Interface:
            return CompletionItemKind.Interface;

        case SymbolKind.Function:
            return CompletionItemKind.Function;

        case SymbolKind.Variable:
        case SymbolKind.Array:
            return CompletionItemKind.Variable;

        case SymbolKind.String:
            return CompletionItemKind.Constant;

        case SymbolKind.Number:
        case SymbolKind.Boolean:
            return CompletionItemKind.Value;

        case SymbolKind.Constant:
        case SymbolKind.Null:
            return CompletionItemKind.Constant;

        case SymbolKind.Object:
        case SymbolKind.Key:
            return CompletionItemKind.Value;

        case SymbolKind.EnumMember:
            return CompletionItemKind.EnumMember;

        case SymbolKind.Struct:
            return CompletionItemKind.Struct;

        case SymbolKind.Event:
            return CompletionItemKind.Event;

        case SymbolKind.Operator:
            return CompletionItemKind.Operator;

        case SymbolKind.TypeParameter:
            return CompletionItemKind.TypeParameter;

        default:
            return undefined;
    }
}
