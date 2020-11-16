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
import { ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { IndexAliasData, IndexResults } from './documentSymbolProvider';

export interface AutoImportSymbol {
    readonly importAlias?: IndexAliasData;
    readonly symbol?: Symbol;
    readonly kind?: CompletionItemKind;
}

export interface ModuleSymbolTable {
    forEach(callbackfn: (symbol: AutoImportSymbol, name: string) => void): void;
}

export type ModuleSymbolMap = Map<string, ModuleSymbolTable>;

// Build a map of all modules within this program and the module-
// level scope that contains the symbol table for the module.
export function buildModuleSymbolsMap(files: SourceFileInfo[], token: CancellationToken): ModuleSymbolMap {
    const moduleSymbolMap = new Map<string, ModuleSymbolTable>();

    files.forEach((file) => {
        throwIfCancellationRequested(token);

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
                forEach(callbackfn: (value: AutoImportSymbol, key: string) => void): void {
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
                                ? CompletionItemKind.Variable
                                : undefined;
                        callbackfn({ symbol, kind: variableKind }, name);
                    });
                },
            });
            return;
        }

        const indexResults = file.sourceFile.getCachedIndexResults();
        if (indexResults && !indexResults.privateOrProtected) {
            moduleSymbolMap.set(filePath, createModuleSymbolTableFromIndexResult(indexResults));
            return;
        }
    });

    return moduleSymbolMap;
}

export interface AbbreviationInfo {
    importFrom?: string;
    importName: string;
}

export function getAutoImportCandidatesForAbbr(
    autoImporter: AutoImporter,
    abbr: string | undefined,
    abbrInfo: AbbreviationInfo,
    token: CancellationToken
) {
    const exactMatch = 1;
    return autoImporter
        .getAutoImportCandidates(abbrInfo.importName, exactMatch, abbr, token)
        .filter((r) => r.source === abbrInfo.importFrom && r.name === abbrInfo.importName);
}

export interface AutoImportResult {
    name: string;
    symbol?: Symbol;
    source?: string;
    edits: TextEditAction[];
    alias?: string;
    kind?: CompletionItemKind;
}

interface ImportParts {
    importName: string;
    symbolName?: string;
    importFrom?: string;
    filePath: string;
    dotCount: number;
    moduleNameAndType: ModuleNameAndType;
}

interface ImportAliasData {
    importParts: ImportParts;
    importGroup: ImportGroup;
    symbol?: Symbol;
    kind?: CompletionItemKind;
}

export class AutoImporter {
    private _importStatements: ImportStatements;

    constructor(
        private _execEnvironment: ExecutionEnvironment,
        private _importResolver: ImportResolver,
        private _parseResults: ParseResults,
        private _invocationPosition: Position,
        private _excludes: string[],
        private _moduleSymbolMap: ModuleSymbolMap,
        private _libraryMap?: Map<string, IndexResults>
    ) {
        this._importStatements = getTopLevelImports(this._parseResults.parseTree);
    }

    getAutoImportCandidates(
        word: string,
        similarityLimit: number,
        aliasName: string | undefined,
        token: CancellationToken
    ) {
        const results: AutoImportResult[] = [];
        const importAliasMap = new Map<string, Map<string, ImportAliasData>>();

        this._addImportsFromModuleMap(word, similarityLimit, aliasName, importAliasMap, results, token);
        this._addImportsFromLibraryMap(word, similarityLimit, aliasName, importAliasMap, results, token);
        this._addImportsFromImportAliasMap(importAliasMap, aliasName, results, token);
        return results;
    }

    private _addImportsFromLibraryMap(
        word: string,
        similarityLimit: number,
        aliasName: string | undefined,
        aliasMap: Map<string, Map<string, ImportAliasData>>,
        results: AutoImportResult[],
        token: CancellationToken
    ) {
        this._libraryMap?.forEach((indexResults, filePath) => {
            if (indexResults.privateOrProtected) {
                return;
            }

            if (this._moduleSymbolMap.has(filePath)) {
                // Module map is already taking care of this file. this can happen if the module is used by
                // user code.
                return;
            }

            // See if this file should be offered as an implicit import.
            const isStubFileOrHasInit = this._isStubFileOrHasInit(this._libraryMap!, filePath);
            this._processModuleSymbolTable(
                createModuleSymbolTableFromIndexResult(indexResults),
                filePath,
                word,
                similarityLimit,
                isStubFileOrHasInit,
                aliasName,
                aliasMap,
                results,
                token
            );
        });
    }

    private _addImportsFromModuleMap(
        word: string,
        similarityLimit: number,
        aliasName: string | undefined,
        aliasMap: Map<string, Map<string, ImportAliasData>>,
        results: AutoImportResult[],
        token: CancellationToken
    ) {
        this._moduleSymbolMap.forEach((topLevelSymbols, filePath) => {
            // See if this file should be offered as an implicit import.
            const isStubFileOrHasInit = this._isStubFileOrHasInit(this._moduleSymbolMap!, filePath);
            this._processModuleSymbolTable(
                topLevelSymbols,
                filePath,
                word,
                similarityLimit,
                isStubFileOrHasInit,
                aliasName,
                aliasMap,
                results,
                token
            );
        });
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
        aliasName: string | undefined,
        importAliasMap: Map<string, Map<string, ImportAliasData>>,
        results: AutoImportResult[],
        token: CancellationToken
    ) {
        throwIfCancellationRequested(token);

        const [importSource, importGroup, moduleNameAndType] = this._getImportPartsForSymbols(filePath);
        if (!importSource) {
            return;
        }

        const dotCount = StringUtils.getCharacterCount(importSource, '.');
        topLevelSymbols.forEach((autoImportSymbol, name) => {
            throwIfCancellationRequested(token);

            if (
                !isStubOrHasInit.isStub &&
                autoImportSymbol.kind === CompletionItemKind.Variable &&
                !SymbolNameUtils.isPublicConstantOrTypeAlias(name)
            ) {
                // If it is not a stub file and symbol is Variable, we only include it if
                // name is public constant or type alias.
                return;
            }

            // For very short matching strings, we will require an exact match. Otherwise
            // we will tend to return a list that's too long. Once we get beyond two
            // characters, we can do a fuzzy match.
            const isSimilar = this._isSimilar(word, name, similarityLimit);
            if (!isSimilar) {
                return;
            }

            const alreadyIncluded = this._containsName(name, undefined, results);
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
                        kind: convertSymbolKindToCompletionItemKind(autoImportSymbol.importAlias.kind),
                    },
                    importAliasMap
                );
                return;
            }

            const autoImportTextEdits = this._getTextEditsForAutoImportByFilePath(
                name,
                filePath,
                importSource,
                importGroup,
                aliasName
            );

            results.push({
                name,
                symbol: autoImportSymbol.symbol,
                source: importSource,
                edits: autoImportTextEdits,
                alias: aliasName,
                kind: autoImportSymbol.kind,
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
            { modulePath: filePath, originalName: importParts.importName, kind: SymbolKind.Module },
            { importParts, importGroup },
            importAliasMap
        );
    }

    private _addImportsFromImportAliasMap(
        importAliasMap: Map<string, Map<string, ImportAliasData>>,
        aliasName: string | undefined,
        results: AutoImportResult[],
        token: CancellationToken
    ) {
        throwIfCancellationRequested(token);

        importAliasMap.forEach((mapPerSymbolName, filePath) => {
            mapPerSymbolName.forEach((importAliasData, symbolName) => {
                throwIfCancellationRequested(token);

                const autoImportTextEdits = this._getTextEditsForAutoImportByFilePath(
                    importAliasData.importParts.symbolName,
                    importAliasData.importParts.filePath,
                    importAliasData.importParts.importFrom ?? importAliasData.importParts.importName,
                    importAliasData.importGroup,
                    aliasName
                );

                results.push({
                    name: importAliasData.importParts.importName,
                    alias: aliasName,
                    symbol: importAliasData.symbol,
                    kind: importAliasData.kind,
                    source: importAliasData.importParts.importFrom,
                    edits: autoImportTextEdits,
                });
            });
        });
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
                this._getImportGroupFromModuleNameAndType(moduleNameAndType),
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

        return word.length > 2
            ? StringUtils.computeCompletionSimilarity(word, name) > similarityLimit
            : word.length > 0 && name.startsWith(word);
    }

    private _containsName(name: string, source: string | undefined, results: AutoImportResult[]) {
        if (this._excludes.find((e) => e === name)) {
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
        return this._importResolver.getModuleNameForImport(filePath, this._execEnvironment);
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
        filePath: string,
        moduleName: string,
        importGroup: ImportGroup,
        aliasName: string | undefined
    ): TextEditAction[] {
        if (symbolName) {
            // Does an 'import from' statement already exist? If so, we'll reuse it.
            const importStatement = this._importStatements.mapByFilePath.get(filePath);
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
            this._importStatements,
            moduleName,
            importGroup,
            this._parseResults,
            this._invocationPosition,
            aliasName
        );
    }
}

function createModuleSymbolTableFromIndexResult(indexResults: IndexResults): ModuleSymbolTable {
    return {
        forEach(callbackfn: (value: AutoImportSymbol, key: string) => void): void {
            indexResults.symbols.forEach((data) => {
                if (!data.externallyVisible) {
                    return;
                }

                callbackfn(
                    {
                        importAlias: data.alias,
                        kind: convertSymbolKindToCompletionItemKind(data.kind),
                    },
                    data.name
                );
            });
        },
    };
}

function convertSymbolKindToCompletionItemKind(kind: SymbolKind) {
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
            return CompletionItemKind.Text;

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
