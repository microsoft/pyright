/*
 * autoImporter.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Logic for performing auto-import completions.
 */

import { CancellationToken, CompletionItem, CompletionItemKind, SymbolKind } from 'vscode-languageserver';

import { DeclarationType } from '../analyzer/declaration';
import { ImportResolver, ModuleNameAndType } from '../analyzer/importResolver';
import { ImportType } from '../analyzer/importResult';
import {
    ImportGroup,
    ImportNameInfo,
    ImportStatements,
    ModuleNameInfo,
    getImportGroup,
    getImportGroupFromModuleNameAndType,
    getTextEditsForAutoImportInsertion,
    getTextEditsForAutoImportSymbolAddition,
    getTopLevelImports,
} from '../analyzer/importStatementUtils';
import { isUserCode } from '../analyzer/sourceFileInfoUtils';
import { Symbol } from '../analyzer/symbol';
import * as SymbolNameUtils from '../analyzer/symbolNameUtils';
import { isVisibleExternally } from '../analyzer/symbolUtils';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { appendArray } from '../common/collectionUtils';
import { ExecutionEnvironment } from '../common/configOptions';
import { TextEditAction } from '../common/editAction';
import { ProgramView, SourceFileInfo } from '../common/extensibility';
import { stripFileExtension } from '../common/pathUtils';
import * as StringUtils from '../common/stringUtils';
import { Position } from '../common/textRange';
import { Uri } from '../common/uri/uri';
import { ParseNodeType } from '../parser/parseNodes';
import { ParseFileResults } from '../parser/parser';
import { CompletionItemData, CompletionMap } from './completionProvider';
import { IndexAliasData } from './symbolIndexer';
import { fromLSPAny } from '../common/lspUtils';

export interface AutoImportSymbol {
    readonly name: string;
    readonly library: boolean;

    readonly kind?: SymbolKind;
    readonly itemKind?: CompletionItemKind;
    readonly importAlias?: IndexAliasData;

    readonly symbol?: Symbol;
    readonly inDunderAll?: boolean;
    readonly hasRedundantAlias?: boolean;
}

export interface ModuleSymbolTable {
    readonly uri: Uri;
    getSymbols(): Generator<AutoImportSymbol>;
}

export type ModuleSymbolMap = Map<string, ModuleSymbolTable>;

export interface AutoImportResult {
    readonly name: string;
    readonly declUri: Uri;
    readonly originalName: string;
    readonly originalDeclUri: Uri;
    readonly insertionText: string;
    readonly symbol?: Symbol;
    readonly source?: string;
    readonly edits?: TextEditAction[];
    readonly alias?: string;
    readonly kind?: CompletionItemKind;
}

export interface AutoImportOptions {
    readonly patternMatcher?: (pattern: string, name: string) => boolean;
    readonly lazyEdit?: boolean;
}

export interface ImportParts {
    // The name of the module or symbol including alias from the `import` or `from ... import` statement
    readonly importName: string;

    // The actual name of the symbol (not alias)
    readonly symbolName?: string;

    // The name of the module from `from ... import` statement
    readonly importFrom?: string;

    // Uri of the module
    readonly fileUri: Uri;

    // The number of dots in the module name, indicating its depth in the module hierarchy
    readonly dotCount: number;

    // `ModuleNameAndType` of the module.
    readonly moduleNameAndType: ModuleNameAndType;
}

export interface ImportAliasData {
    readonly importParts: ImportParts;
    readonly importGroup: ImportGroup;
    readonly symbol?: Symbol;
    readonly kind?: SymbolKind;
    readonly itemKind?: CompletionItemKind;
    readonly inDunderAll?: boolean;
    readonly hasRedundantAlias?: boolean;

    // Uri pointing to the original module that contains the actual symbol that the alias resolves to.
    readonly fileUri: Uri;
}

export type AutoImportResultMap = Map<string, AutoImportResult[]>;

// Build a map of all modules within this program and the module-
// level scope that contains the symbol table for the module.
export function buildModuleSymbolsMap(files: readonly SourceFileInfo[]): ModuleSymbolMap {
    const moduleSymbolMap = new Map<string, ModuleSymbolTable>();

    files.forEach((file) => {
        if (file.shadows.length > 0) {
            // There is corresponding stub file. Don't add
            // duplicated files in the map.
            return;
        }

        const uri = file.sourceFile.getUri();
        const symbolTable = file.sourceFile.getModuleSymbolTable();
        if (!symbolTable) {
            return;
        }

        const fileName = stripFileExtension(uri.fileName);

        // Don't offer imports from files that are named with private
        // naming semantics like "_ast.py" unless they're in the current userfile list.
        if (SymbolNameUtils.isPrivateOrProtectedName(fileName) && !isUserCode(file)) {
            return;
        }

        moduleSymbolMap.set(uri.key, {
            uri,
            *getSymbols() {
                for (const [name, symbol] of symbolTable) {
                    if (!isVisibleExternally(symbol)) {
                        continue;
                    }

                    const declarations = symbol.getDeclarations();
                    if (!declarations || declarations.length === 0) {
                        continue;
                    }

                    const declaration = declarations[0];
                    if (!declaration) {
                        continue;
                    }

                    if (declaration.type === DeclarationType.Alias && isUserCode(file)) {
                        // We don't include import alias in auto import
                        // for workspace files.
                        continue;
                    }

                    const variableKind =
                        declaration.type === DeclarationType.Variable && !declaration.isConstant && !declaration.isFinal
                            ? SymbolKind.Variable
                            : undefined;

                    yield {
                        name,
                        symbol,
                        kind: variableKind,
                        library: !isUserCode(file),
                        inDunderAll: symbol.isInDunderAll(),
                    };
                }
            },
        });
        return;
    });

    return moduleSymbolMap;
}

export class AutoImporter {
    private readonly _importStatements: ImportStatements;

    constructor(
        protected readonly program: ProgramView,
        protected readonly execEnvironment: ExecutionEnvironment,
        protected readonly parseResults: ParseFileResults,
        private readonly _invocationPosition: Position,
        private readonly _excludes: CompletionMap,
        protected readonly moduleSymbolMap: ModuleSymbolMap,
        protected readonly options: AutoImportOptions
    ) {
        this._importStatements = getTopLevelImports(
            this.parseResults.parserOutput.parseTree,
            /* includeImplicitImports */ true
        );
    }

    getAutoImportCandidates(
        word: string,
        similarityLimit: number,
        abbrFromUsers: string | undefined,
        token: CancellationToken
    ) {
        const results: AutoImportResult[] = [];
        const map = this.getCandidates(word, similarityLimit, abbrFromUsers, token);

        map.forEach((v) => appendArray(results, v));
        return results;
    }

    protected get importResolver(): ImportResolver {
        return this.program.importResolver;
    }

    protected getCompletionItemData(item: CompletionItem): CompletionItemData | undefined {
        return fromLSPAny<CompletionItemData>(item.data);
    }

    protected getCandidates(
        word: string,
        similarityLimit: number,
        abbrFromUsers: string | undefined,
        token: CancellationToken
    ) {
        const resultMap = new Map<string, AutoImportResult[]>();
        const importAliasMap = new Map<string, Map<string, ImportAliasData>>();

        this.addImportsFromModuleMap(word, similarityLimit, abbrFromUsers, importAliasMap, resultMap, token);
        this.addImportsFromImportAliasMap(importAliasMap, abbrFromUsers, resultMap, token);

        return resultMap;
    }

    protected addImportsFromModuleMap(
        word: string,
        similarityLimit: number,
        abbrFromUsers: string | undefined,
        aliasMap: Map<string, Map<string, ImportAliasData>>,
        results: AutoImportResultMap,
        token: CancellationToken
    ) {
        this.moduleSymbolMap.forEach((topLevelSymbols, key) => {
            // See if this file should be offered as an implicit import.
            const uriProperties = this.getUriProperties(this.moduleSymbolMap!, topLevelSymbols.uri);
            this.processModuleSymbolTable(
                topLevelSymbols,
                topLevelSymbols.uri,
                word,
                similarityLimit,
                uriProperties,
                abbrFromUsers,
                aliasMap,
                results,
                token
            );
        });
    }

    protected addImportsFromImportAliasMap(
        importAliasMap: Map<string, Map<string, ImportAliasData>>,
        abbrFromUsers: string | undefined,
        results: AutoImportResultMap,
        token: CancellationToken
    ) {
        throwIfCancellationRequested(token);

        importAliasMap.forEach((mapPerSymbolName) => {
            mapPerSymbolName.forEach((importAliasData, originalName) => {
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
                    if (this._importStatements.mapByFilePath.has(importAliasData.importParts.fileUri.key)) {
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
                            imported.node.d.imports.some(
                                (i) => i.d.name.d.value === importAliasData.importParts.symbolName
                            )
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
                    { name: importAliasData.importParts.symbolName, alias: abbrFromUsers },
                    {
                        name: importAliasData.importParts.importFrom ?? importAliasData.importParts.importName,
                    },
                    importAliasData.importParts.importName,
                    importAliasData.importGroup,
                    importAliasData.importParts.fileUri
                );

                this._addResult(results, {
                    name: importAliasData.importParts.importName,
                    alias: abbrFromUsers,
                    symbol: importAliasData.symbol,
                    kind: importAliasData.itemKind ?? convertSymbolKindToCompletionItemKind(importAliasData.kind),
                    source: importAliasData.importParts.importFrom,
                    insertionText: autoImportTextEdits.insertionText,
                    edits: autoImportTextEdits.edits,
                    declUri: importAliasData.importParts.fileUri,
                    originalName,
                    originalDeclUri: importAliasData.fileUri,
                });
            });
        });
    }

    protected processModuleSymbolTable(
        topLevelSymbols: ModuleSymbolTable,
        moduleUri: Uri,
        word: string,
        similarityLimit: number,
        fileProperties: { isStub: boolean; hasInit: boolean; isUserCode: boolean },
        abbrFromUsers: string | undefined,
        importAliasMap: Map<string, Map<string, ImportAliasData>>,
        results: AutoImportResultMap,
        token: CancellationToken
    ) {
        throwIfCancellationRequested(token);

        const [importSource, importGroup, moduleNameAndType] = this._getImportPartsForSymbols(moduleUri);
        if (!importSource) {
            return;
        }

        const dotCount = StringUtils.getCharacterCount(importSource, '.');
        for (const autoSymbol of topLevelSymbols.getSymbols()) {
            if (!this.shouldIncludeVariable(autoSymbol, fileProperties.isStub)) {
                continue;
            }

            // For very short matching strings, we will require an exact match. Otherwise
            // we will tend to return a list that's too long. Once we get beyond two
            // characters, we can do a fuzzy match.
            const name = autoSymbol.name;
            const isSimilar = this._isSimilar(word, name, similarityLimit);
            if (!isSimilar) {
                continue;
            }

            const alreadyIncluded = this._containsName(name, importSource, results);
            if (alreadyIncluded) {
                continue;
            }

            // We will collect all aliases and then process it later
            if (autoSymbol.importAlias) {
                this._addToImportAliasMap(
                    autoSymbol.importAlias,
                    {
                        importParts: {
                            symbolName: name,
                            importName: name,
                            importFrom: importSource,
                            fileUri: moduleUri,
                            dotCount,
                            moduleNameAndType,
                        },
                        importGroup,
                        symbol: autoSymbol.symbol,
                        kind: autoSymbol.importAlias.kind,
                        itemKind: autoSymbol.importAlias.itemKind,
                        inDunderAll: autoSymbol.inDunderAll,
                        hasRedundantAlias: autoSymbol.hasRedundantAlias,
                        fileUri: autoSymbol.importAlias.moduleUri,
                    },
                    importAliasMap
                );
                continue;
            }

            const nameForImportFrom = this.getNameForImportFrom(/* library */ !fileProperties.isUserCode, moduleUri);
            const autoImportTextEdits = this._getTextEditsForAutoImportByFilePath(
                { name, alias: abbrFromUsers },
                { name: importSource, nameForImportFrom },
                name,
                importGroup,
                moduleUri
            );

            this._addResult(results, {
                name,
                alias: abbrFromUsers,
                symbol: autoSymbol.symbol,
                source: importSource,
                kind: autoSymbol.itemKind ?? convertSymbolKindToCompletionItemKind(autoSymbol.kind),
                insertionText: autoImportTextEdits.insertionText,
                edits: autoImportTextEdits.edits,
                declUri: moduleUri,
                originalName: name,
                originalDeclUri: moduleUri,
            });
        }

        // If the current file is in a directory that also contains an "__init__.py[i]"
        // file, we can use that directory name as an implicit import target.
        // Or if the file is a stub file, we can use it as import target.
        // Skip this check for user code.
        if (!fileProperties.isStub && !fileProperties.hasInit && !fileProperties.isUserCode) {
            return;
        }

        const importParts = this._getImportParts(moduleUri);
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
                moduleUri,
                originalName: importParts.importName,
                kind: SymbolKind.Module,
                itemKind: CompletionItemKind.Module,
            },
            {
                importParts,
                importGroup,
                kind: SymbolKind.Module,
                itemKind: CompletionItemKind.Module,
                fileUri: moduleUri,
            },
            importAliasMap
        );
    }

    protected getNameForImportFrom(library: boolean, moduleUri: Uri): string | undefined {
        return undefined;
    }

    protected getUriProperties<T>(map: Map<string, T>, uri: Uri) {
        const fileDir = uri.getDirectory();
        const initPathPy = fileDir.initPyUri;
        const initPathPyi = fileDir.initPyiUri;
        const isStub = uri.hasExtension('.pyi');
        const hasInit = map.has(initPathPy.key) || map.has(initPathPyi.key);
        const sourceFileInfo = this.program.getSourceFileInfo(uri);
        return { isStub, hasInit, isUserCode: isUserCode(sourceFileInfo) };
    }

    protected compareImportAliasData(left: ImportAliasData, right: ImportAliasData) {
        // Choose a better alias for the same declaration based on where the alias is defined.
        // For example, we would prefer alias defined in builtin over defined in user files.
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

    protected shouldIncludeVariable(autoSymbol: AutoImportSymbol, isStub: boolean) {
        // If it is not a stub file and symbol is Variable, we only include it if
        // name is public constant or type alias
        if (isStub || autoSymbol.kind !== SymbolKind.Variable) {
            return true;
        }

        return SymbolNameUtils.isPublicConstantOrTypeAlias(autoSymbol.name);
    }

    private _addToImportAliasMap(
        alias: IndexAliasData,
        data: ImportAliasData,
        importAliasMap: Map<string, Map<string, ImportAliasData>>
    ) {
        // Since we don't resolve alias declaration using type evaluator, there is still a chance
        // where we show multiple aliases for same symbols. but this should still reduce number of
        // such cases.
        if (!importAliasMap.has(alias.moduleUri.key)) {
            const map = new Map<string, ImportAliasData>();
            map.set(alias.originalName, data);
            importAliasMap.set(alias.moduleUri.key, map);
            return;
        }

        const map = importAliasMap.get(alias.moduleUri.key)!;
        if (!map.has(alias.originalName)) {
            map.set(alias.originalName, data);
            return;
        }

        const existingData = map.get(alias.originalName)!;
        const comparison = this.compareImportAliasData(existingData, data);
        if (comparison <= 0) {
            // Existing data is better than new one.
            return;
        }

        // Keep the new data.
        map.set(alias.originalName, data);
    }

    private _getImportPartsForSymbols(uri: Uri): [string | undefined, ImportGroup, ModuleNameAndType] {
        const localImport = this._importStatements.mapByFilePath.get(uri.key);
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
            const moduleNameAndType = this._getModuleNameAndTypeFromFilePath(uri);
            return [
                moduleNameAndType.moduleName,
                getImportGroupFromModuleNameAndType(moduleNameAndType),
                moduleNameAndType,
            ];
        }
    }

    private _getImportParts(uri: Uri) {
        const name = stripFileExtension(uri.fileName);

        // See if we can import module as "import xxx"
        if (name === '__init__') {
            return createImportParts(this._getModuleNameAndTypeFromFilePath(uri.getDirectory()));
        }

        return createImportParts(this._getModuleNameAndTypeFromFilePath(uri));

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
                fileUri: uri,
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

        if (!this.options.patternMatcher) {
            const index = word[0] !== '_' && name[0] === '_' && name.length > 1 ? 1 : 0;
            if (word[0].toLocaleLowerCase() !== name[index].toLocaleLowerCase()) {
                return false;
            }

            return StringUtils.isPatternInSymbol(word, name);
        }

        return this.options.patternMatcher(word, name);
    }

    private _shouldExclude(name: string) {
        return this._excludes.has(name, (i) =>
            CompletionMap.labelOnlyIgnoringAutoImports(i, this.getCompletionItemData.bind(this))
        );
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
    private _getModuleNameAndTypeFromFilePath(uri: Uri): ModuleNameAndType {
        return this.importResolver.getModuleNameForImport(uri, this.execEnvironment);
    }

    private _getTextEditsForAutoImportByFilePath(
        importNameInfo: ImportNameInfo,
        moduleNameInfo: ModuleNameInfo,
        insertionText: string,
        importGroup: ImportGroup,
        fileUri: Uri
    ): { insertionText: string; edits?: TextEditAction[] | undefined } {
        // If there is no symbolName, there can't be existing import statement.
        const importStatement = this._importStatements.mapByFilePath.get(fileUri.key);
        if (importStatement) {
            // Found import for given module. See whether we can use the module as it is.
            if (importStatement.node.nodeType === ParseNodeType.Import) {
                // For now, we don't check whether alias or moduleName got overwritten at
                // given position
                const importAlias = importStatement.subnode?.d.alias?.d.value;
                if (importNameInfo.name) {
                    // ex) import module
                    //     method | <= auto-import
                    return {
                        insertionText: `${importAlias ?? importStatement.moduleName}.${importNameInfo.name}`,
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
                importNameInfo.name &&
                importStatement.node.nodeType === ParseNodeType.ImportFrom &&
                !importStatement.node.d.isWildcardImport
            ) {
                // If so, see whether what we want already exist.
                const importNode = importStatement.node.d.imports.find((i) => i.d.name.d.value === importNameInfo.name);
                if (importNode) {
                    // For now, we don't check whether alias or moduleName got overwritten at
                    // given position
                    const importAlias = importNode.d.alias?.d.value;
                    return {
                        insertionText: `${importAlias ?? importNameInfo.name}`,
                        edits: [],
                    };
                }

                // If not, add what we want at the existing 'import from' statement as long as
                // what is imported is not module itself.
                // ex) don't add "path" to existing "from os.path import dirname" statement.
                if (moduleNameInfo.name === importStatement.moduleName) {
                    return {
                        insertionText: importNameInfo.alias ?? insertionText,
                        edits: this.options.lazyEdit
                            ? undefined
                            : getTextEditsForAutoImportSymbolAddition(
                                  importNameInfo,
                                  importStatement,
                                  this.parseResults
                              ),
                    };
                }
            }
        } else if (importNameInfo.name) {
            // If it is the module itself that got imported, make sure we don't import it again.
            // ex) from module import submodule
            const imported = this._importStatements.orderedImports.find((i) => i.moduleName === moduleNameInfo.name);
            if (imported && imported.node.nodeType === ParseNodeType.ImportFrom && !imported.node.d.isWildcardImport) {
                const importFrom = imported.node.d.imports.find((i) => i.d.name.d.value === importNameInfo.name);
                if (importFrom) {
                    // For now, we don't check whether alias or moduleName got overwritten at
                    // given position. only move to alias, but not the other way around
                    const importAlias = importFrom.d.alias?.d.value;
                    if (importAlias) {
                        return {
                            insertionText: `${importAlias}`,
                            edits: [],
                        };
                    }
                } else {
                    // If not, add what we want at the existing import from statement.
                    return {
                        insertionText: importNameInfo.alias ?? insertionText,
                        edits: this.options.lazyEdit
                            ? undefined
                            : getTextEditsForAutoImportSymbolAddition(importNameInfo, imported, this.parseResults),
                    };
                }
            }

            // Check whether it is one of implicit imports
            const importFrom = this._importStatements.implicitImports?.get(fileUri.key);
            if (importFrom) {
                // For now, we don't check whether alias or moduleName got overwritten at
                // given position
                const importAlias = importFrom.d.alias?.d.value;
                return {
                    insertionText: `${importAlias ?? importFrom.d.name.d.value}.${importNameInfo.name}`,
                    edits: [],
                };
            }
        }

        return {
            insertionText: importNameInfo.alias ?? insertionText,
            edits: this.options.lazyEdit
                ? undefined
                : getTextEditsForAutoImportInsertion(
                      importNameInfo,
                      moduleNameInfo,
                      this._importStatements,
                      importGroup,
                      this.parseResults,
                      this._invocationPosition
                  ),
        };
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
