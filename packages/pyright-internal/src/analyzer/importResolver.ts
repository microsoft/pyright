/*
 * importResolver.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides the logic for resolving imports according to the
 * runtime rules of Python.
 */

import type { Dirent } from 'fs';

import { flatten, getMapValues, getOrAdd } from '../common/collectionUtils';
import { ConfigOptions, ExecutionEnvironment } from '../common/configOptions';
import { FileSystem } from '../common/fileSystem';
import { Host } from '../common/host';
import { stubsSuffix } from '../common/pathConsts';
import {
    changeAnyExtension,
    combinePathComponents,
    combinePaths,
    containsPath,
    ensureTrailingDirectorySeparator,
    getDirectoryPath,
    getFileExtension,
    getFileName,
    getFileSystemEntriesFromDirEntries,
    getPathComponents,
    getRelativePathComponentsFromDirectory,
    isDirectory,
    isDiskPathRoot,
    isFile,
    normalizePath,
    normalizePathCase,
    resolvePaths,
    stripFileExtension,
    stripTrailingDirectorySeparator,
    tryRealpath,
    tryStat,
} from '../common/pathUtils';
import { PythonVersion, versionFromString } from '../common/pythonVersion';
import { equateStringsCaseInsensitive } from '../common/stringUtils';
import * as StringUtils from '../common/stringUtils';
import { isIdentifierChar, isIdentifierStartChar } from '../parser/characters';
import { PyrightFileSystem } from '../pyrightFileSystem';
import { ImplicitImport, ImportResult, ImportType } from './importResult';
import { getDirectoryLeadingDotsPointsTo } from './importStatementUtils';
import { ImportPath, ParentDirectoryCache } from './parentDirectoryCache';
import * as PythonPathUtils from './pythonPathUtils';
import { getPyTypedInfo, PyTypedInfo } from './pyTypedUtils';
import { isDunderName } from './symbolNameUtils';

export interface ImportedModuleDescriptor {
    leadingDots: number;
    nameParts: string[];
    hasTrailingDot?: boolean | undefined;
    importedSymbols: string[] | undefined;
}

export interface ModuleNameAndType {
    moduleName: string;
    importType: ImportType;
    isLocalTypingsFile: boolean;
}

export function createImportedModuleDescriptor(moduleName: string): ImportedModuleDescriptor {
    return {
        leadingDots: 0,
        nameParts: moduleName.split('.'),
        importedSymbols: [],
    };
}

type CachedImportResults = Map<string, ImportResult>;
interface SupportedVersionRange {
    min: PythonVersion;
    max?: PythonVersion | undefined;
}

const supportedNativeLibExtensions = ['.pyd', '.so', '.dylib'];
export const supportedFileExtensions = ['.py', '.pyi', ...supportedNativeLibExtensions];

// Should we allow partial resolution for third-party packages? Some use tricks
// to populate their package namespaces, so we might be able to partially resolve
// a multi - part import(e.g. "a.b.c") but not fully resolve it. If this is set to
// false, we will have some false positives. If it is set to true, we won't report
// errors when these partial-resolutions fail.
const allowPartialResolutionForThirdPartyPackages = false;

export class ImportResolver {
    private _cachedPythonSearchPaths: string[] | undefined;
    private _cachedImportResults = new Map<string | undefined, CachedImportResults>();
    private _cachedModuleNameResults = new Map<string, Map<string, ModuleNameAndType>>();
    private _cachedTypeshedRoot: string | undefined;
    private _cachedTypeshedStdLibPath: string | undefined;
    private _cachedTypeshedStdLibModuleVersions: Map<string, SupportedVersionRange> | undefined;
    private _cachedTypeshedThirdPartyPath: string | undefined;
    private _cachedTypeshedThirdPartyPackagePaths: Map<string, string[]> | undefined;
    private _cachedTypeshedThirdPartyPackageRoots: string[] | undefined;
    private _cachedEntriesForPath = new Map<string, Dirent[]>();

    protected cachedParentImportResults: ParentDirectoryCache;

    constructor(
        public readonly fileSystem: FileSystem,
        protected _configOptions: ConfigOptions,
        public readonly host: Host
    ) {
        this.cachedParentImportResults = new ParentDirectoryCache(() => this.getPythonSearchPaths([]));
    }

    invalidateCache() {
        this._cachedImportResults = new Map<string | undefined, CachedImportResults>();
        this._cachedModuleNameResults = new Map<string, Map<string, ModuleNameAndType>>();
        this.cachedParentImportResults.reset();

        this._invalidateFileSystemCache();

        if (this.fileSystem instanceof PyrightFileSystem) {
            this.fileSystem.clearPartialStubs();
        }
    }

    // Resolves the import and returns the path if it exists, otherwise
    // returns undefined.
    resolveImport(
        sourceFilePath: string,
        execEnv: ExecutionEnvironment,
        moduleDescriptor: ImportedModuleDescriptor
    ): ImportResult {
        // wrap internal call to _resolveImport() to prevent calling any
        // child class version of resolveImport()
        return this._resolveImport(sourceFilePath, execEnv, moduleDescriptor);
    }

    // Resolves the import and returns the path if it exists, otherwise
    // returns undefined.
    protected _resolveImport(
        sourceFilePath: string,
        execEnv: ExecutionEnvironment,
        moduleDescriptor: ImportedModuleDescriptor
    ): ImportResult {
        const importName = this.formatImportName(moduleDescriptor);
        const importFailureInfo: string[] = [];
        const importResult = this._resolveImportStrict(
            importName,
            sourceFilePath,
            execEnv,
            moduleDescriptor,
            importFailureInfo
        );

        if (importResult.isImportFound || moduleDescriptor.leadingDots > 0) {
            return importResult;
        }

        // If the import is absolute and no other method works, try resolving the
        // absolute in the importing file's directory, then the parent directory,
        // and so on, until the import root is reached.
        sourceFilePath = normalizePathCase(this.fileSystem, normalizePath(sourceFilePath));
        const origin = ensureTrailingDirectorySeparator(getDirectoryPath(sourceFilePath));

        const result = this.cachedParentImportResults.getImportResult(origin, importName, importResult);
        if (result) {
            // Already ran the parent directory resolution for this import name on this location.
            return this.filterImplicitImports(result, moduleDescriptor.importedSymbols);
        }

        // Check whether the given file is in the parent directory import resolution cache.
        const root = this.getParentImportResolutionRoot(sourceFilePath, execEnv.root);
        if (!this.cachedParentImportResults.checkValidPath(this.fileSystem, sourceFilePath, root)) {
            return importResult;
        }

        const importPath: ImportPath = { importPath: undefined };

        // Going up the given folder one by one until we can resolve the import.
        let current = origin;
        while (this._shouldWalkUp(current, root, execEnv)) {
            const result = this.resolveAbsoluteImport(
                current,
                execEnv,
                moduleDescriptor,
                importName,
                [],
                /* allowPartial */ undefined,
                /* allowNativeLib */ undefined,
                /* useStubPackage */ false,
                /* allowPyi */ true
            );

            this.cachedParentImportResults.checked(current, importName, importPath);

            if (result.isImportFound) {
                // This will make cache to point to actual path that contains the module we found
                importPath.importPath = current;

                this.cachedParentImportResults.add({
                    importResult: result,
                    path: current,
                    importName,
                });

                return this.filterImplicitImports(result, moduleDescriptor.importedSymbols);
            }

            let success;
            [success, current] = this._tryWalkUp(current);
            if (!success) {
                break;
            }
        }

        this.cachedParentImportResults.checked(current, importName, importPath);
        return importResult;
    }

    private _resolveImportStrict(
        importName: string,
        sourceFilePath: string,
        execEnv: ExecutionEnvironment,
        moduleDescriptor: ImportedModuleDescriptor,
        importFailureInfo: string[]
    ) {
        const notFoundResult: ImportResult = {
            importName,
            isRelative: false,
            isImportFound: false,
            isPartlyResolved: false,
            isNamespacePackage: false,
            isStubPackage: false,
            importFailureInfo,
            resolvedPaths: [],
            importType: ImportType.Local,
            isStubFile: false,
            isNativeLib: false,
            implicitImports: [],
            filteredImplicitImports: [],
            nonStubImportResult: undefined,
        };

        this.ensurePartialStubPackages(execEnv);

        // Is it a relative import?
        if (moduleDescriptor.leadingDots > 0) {
            const relativeImport = this._resolveRelativeImport(
                sourceFilePath,
                execEnv,
                moduleDescriptor,
                importName,
                importFailureInfo
            );

            if (relativeImport) {
                relativeImport.isRelative = true;
                return relativeImport;
            }
        } else {
            // Is it already cached?
            const cachedResults = this._lookUpResultsInCache(execEnv, importName, moduleDescriptor.importedSymbols);
            if (cachedResults) {
                // In most cases, we can simply return a cached entry. However, there are cases
                // where the cached entry refers to a previously-resolved namespace package
                // that does not resolve the symbols specified in the module descriptor.
                // In this case, we will ignore the cached value and run the full import
                // resolution again to try to find a package that resolves the import.
                const isUnresolvedNamespace =
                    cachedResults.isImportFound &&
                    cachedResults.isNamespacePackage &&
                    !this._isNamespacePackageResolved(moduleDescriptor, cachedResults.implicitImports);

                if (!isUnresolvedNamespace) {
                    return cachedResults;
                }
            }

            const bestImport = this._resolveBestAbsoluteImport(sourceFilePath, execEnv, moduleDescriptor, true);
            if (bestImport) {
                if (bestImport.isStubFile) {
                    bestImport.nonStubImportResult =
                        this._resolveBestAbsoluteImport(sourceFilePath, execEnv, moduleDescriptor, false) ||
                        notFoundResult;
                }
                return this.addResultsToCache(execEnv, importName, bestImport, moduleDescriptor.importedSymbols);
            }
        }

        return this.addResultsToCache(execEnv, importName, notFoundResult, undefined);
    }

    getCompletionSuggestions(
        sourceFilePath: string,
        execEnv: ExecutionEnvironment,
        moduleDescriptor: ImportedModuleDescriptor
    ) {
        const suggestions = this._getCompletionSuggestionsStrict(sourceFilePath, execEnv, moduleDescriptor);

        // We only do parent import resolution for absolute path.
        if (moduleDescriptor.leadingDots > 0) {
            return suggestions;
        }

        const root = this.getParentImportResolutionRoot(sourceFilePath, execEnv.root);
        const origin = ensureTrailingDirectorySeparator(
            getDirectoryPath(normalizePathCase(this.fileSystem, normalizePath(sourceFilePath)))
        );

        let current = origin;
        while (this._shouldWalkUp(current, root, execEnv)) {
            this._getCompletionSuggestionsAbsolute(
                sourceFilePath,
                execEnv,
                current,
                moduleDescriptor,
                suggestions,
                /*strictOnly*/ false
            );

            let success;
            [success, current] = this._tryWalkUp(current);
            if (!success) {
                break;
            }
        }

        return suggestions;
    }

    private _getCompletionSuggestionsStrict(
        sourceFilePath: string,
        execEnv: ExecutionEnvironment,
        moduleDescriptor: ImportedModuleDescriptor
    ): Set<string> {
        const importFailureInfo: string[] = [];
        const suggestions = new Set<string>();

        // Is it a relative import?
        if (moduleDescriptor.leadingDots > 0) {
            this._getCompletionSuggestionsRelative(sourceFilePath, execEnv, moduleDescriptor, suggestions);
        } else {
            // First check for a typeshed file.
            if (moduleDescriptor.nameParts.length > 0) {
                this._getCompletionSuggestionsTypeshedPath(
                    sourceFilePath,
                    execEnv,
                    moduleDescriptor,
                    true,
                    suggestions
                );
            }

            // Look for it in the root directory of the execution environment.
            if (execEnv.root) {
                this._getCompletionSuggestionsAbsolute(
                    sourceFilePath,
                    execEnv,
                    execEnv.root,
                    moduleDescriptor,
                    suggestions
                );
            }

            for (const extraPath of execEnv.extraPaths) {
                this._getCompletionSuggestionsAbsolute(
                    sourceFilePath,
                    execEnv,
                    extraPath,
                    moduleDescriptor,
                    suggestions
                );
            }

            // Check for a typings file.
            if (this._configOptions.stubPath) {
                this._getCompletionSuggestionsAbsolute(
                    sourceFilePath,
                    execEnv,
                    this._configOptions.stubPath,
                    moduleDescriptor,
                    suggestions
                );
            }

            // Check for a typeshed file.
            this._getCompletionSuggestionsTypeshedPath(sourceFilePath, execEnv, moduleDescriptor, false, suggestions);

            // Look for the import in the list of third-party packages.
            const pythonSearchPaths = this.getPythonSearchPaths(importFailureInfo);
            for (const searchPath of pythonSearchPaths) {
                this._getCompletionSuggestionsAbsolute(
                    sourceFilePath,
                    execEnv,
                    searchPath,
                    moduleDescriptor,
                    suggestions
                );
            }
        }

        return suggestions;
    }

    // Returns the implementation file(s) for the given stub file.
    getSourceFilesFromStub(stubFilePath: string, execEnv: ExecutionEnvironment, _mapCompiled: boolean): string[] {
        const sourceFilePaths: string[] = [];

        // When ImportResolver resolves an import to a stub file, a second resolve is done
        // ignoring stub files, which gives us an approximation of where the implementation
        // for that stub is located.
        this._cachedImportResults.forEach((map) => {
            map.forEach((result) => {
                if (result.isStubFile && result.isImportFound && result.nonStubImportResult) {
                    if (result.resolvedPaths[result.resolvedPaths.length - 1] === stubFilePath) {
                        if (result.nonStubImportResult.isImportFound) {
                            const nonEmptyPath =
                                result.nonStubImportResult.resolvedPaths[
                                    result.nonStubImportResult.resolvedPaths.length - 1
                                ];

                            if (nonEmptyPath.endsWith('.py') || nonEmptyPath.endsWith('.pyi')) {
                                // We allow pyi in case there are multiple pyi for a compiled module such as
                                // numpy.random.mtrand
                                sourceFilePaths.push(nonEmptyPath);
                            }
                        }
                    }
                }
            });
        });

        // We haven't seen an import of that stub, attempt to find the source
        // in some other ways.
        if (sourceFilePaths.length === 0) {
            // Simple case where the stub and source files are next to each other.
            const sourceFilePath = changeAnyExtension(stubFilePath, '.py');
            if (this.dirExistsCached(sourceFilePath)) {
                sourceFilePaths.push(sourceFilePath);
            }
        }

        if (sourceFilePaths.length === 0) {
            // The stub and the source file may have the same name, but be located
            // in different folder hierarchies.
            // Example:
            // <stubPath>\package\module.pyi
            // <site-packages>\package\module.py
            // We get the relative path(s) of the stub to its import root(s),
            // in theory there can be more than one, then look for source
            // files in all the import roots using the same relative path(s).
            const importRootPaths = this.getImportRoots(execEnv);

            const relativeStubPaths: string[] = [];
            for (const importRootPath of importRootPaths) {
                if (containsPath(importRootPath, stubFilePath, true)) {
                    const parts = getRelativePathComponentsFromDirectory(importRootPath, stubFilePath, true);

                    // Note that relative paths have an empty parts[0]
                    if (parts.length > 1) {
                        // Handle the case where the symbol was resolved to a stubs package
                        // rather than the real package. We'll strip off the "-stubs" suffix
                        // in this case.
                        if (parts[1].endsWith(stubsSuffix)) {
                            parts[1] = parts[1].substr(0, parts[1].length - stubsSuffix.length);
                        }

                        const relativeStubPath = combinePathComponents(parts);
                        if (relativeStubPath) {
                            relativeStubPaths.push(relativeStubPath);
                        }
                    }
                }
            }

            for (const relativeStubPath of relativeStubPaths) {
                for (const importRootPath of importRootPaths) {
                    const absoluteStubPath = resolvePaths(importRootPath, relativeStubPath);
                    let absoluteSourcePath = changeAnyExtension(absoluteStubPath, '.py');
                    if (this.fileExistsCached(absoluteSourcePath)) {
                        sourceFilePaths.push(absoluteSourcePath);
                    } else {
                        const filePathWithoutExtension = stripFileExtension(absoluteSourcePath);

                        if (filePathWithoutExtension.endsWith('__init__')) {
                            // Did not match: <root>/package/__init__.py
                            // Try equivalent: <root>/package.py
                            absoluteSourcePath =
                                filePathWithoutExtension.substr(0, filePathWithoutExtension.length - 9) + '.py';
                            if (this.fileExistsCached(absoluteSourcePath)) {
                                sourceFilePaths.push(absoluteSourcePath);
                            }
                        } else {
                            // Did not match: <root>/package.py
                            // Try equivalent: <root>/package/__init__.py
                            absoluteSourcePath = combinePaths(filePathWithoutExtension, '__init__.py');
                            if (this.fileExistsCached(absoluteSourcePath)) {
                                sourceFilePaths.push(absoluteSourcePath);
                            }
                        }
                    }
                }
            }
        }

        return sourceFilePaths;
    }

    // Returns the module name (of the form X.Y.Z) that needs to be imported
    // from the current context to access the module with the specified file path.
    // In a sense, it's performing the inverse of resolveImport.
    getModuleNameForImport(filePath: string, execEnv: ExecutionEnvironment) {
        // Cache results of the reverse of resolveImport as we cache resolveImport.
        const cache = getOrAdd(this._cachedModuleNameResults, execEnv.root, () => new Map<string, ModuleNameAndType>());
        return getOrAdd(cache, filePath, () => this._getModuleNameForImport(filePath, execEnv));
    }

    private _getModuleNameForImport(filePath: string, execEnv: ExecutionEnvironment): ModuleNameAndType {
        let moduleName: string | undefined;
        let importType = ImportType.BuiltIn;
        let isLocalTypingsFile = false;

        const importFailureInfo: string[] = [];

        // Is this a stdlib typeshed path?
        const stdLibTypeshedPath = this._getStdlibTypeshedPath(execEnv, importFailureInfo);
        if (stdLibTypeshedPath) {
            moduleName = this.getModuleNameFromPath(stdLibTypeshedPath, filePath);
            if (moduleName) {
                const moduleDescriptor: ImportedModuleDescriptor = {
                    leadingDots: 0,
                    nameParts: moduleName.split('.'),
                    importedSymbols: undefined,
                };

                if (this._isStdlibTypeshedStubValidForVersion(moduleDescriptor, execEnv, [])) {
                    return { moduleName, importType, isLocalTypingsFile };
                }
            }
        }

        // Look for it in the root directory of the execution environment.
        if (execEnv.root) {
            moduleName = this.getModuleNameFromPath(execEnv.root, filePath);
            importType = ImportType.Local;
        }

        for (const extraPath of execEnv.extraPaths) {
            const candidateModuleName = this.getModuleNameFromPath(extraPath, filePath);

            // Does this candidate look better than the previous best module name?
            // We'll always try to use the shortest version.
            if (!moduleName || (candidateModuleName && candidateModuleName.length < moduleName.length)) {
                moduleName = candidateModuleName;
                importType = ImportType.Local;
            }
        }

        // Check for a typings file.
        if (this._configOptions.stubPath) {
            const candidateModuleName = this.getModuleNameFromPath(this._configOptions.stubPath, filePath);

            // Does this candidate look better than the previous best module name?
            // We'll always try to use the shortest version.
            if (!moduleName || (candidateModuleName && candidateModuleName.length < moduleName.length)) {
                moduleName = candidateModuleName;

                // Treat the typings path as a local import so errors are reported for it.
                importType = ImportType.Local;
                isLocalTypingsFile = true;
            }
        }

        // Check for a typeshed file.
        const thirdPartyTypeshedPath = this._getThirdPartyTypeshedPath(execEnv, importFailureInfo);
        if (thirdPartyTypeshedPath) {
            const candidateModuleName = this.getModuleNameFromPath(
                thirdPartyTypeshedPath,
                filePath,
                /* stripTopContainerDir */ true
            );

            // Does this candidate look better than the previous best module name?
            // We'll always try to use the shortest version.
            if (!moduleName || (candidateModuleName && candidateModuleName.length < moduleName.length)) {
                moduleName = candidateModuleName;
                importType = ImportType.ThirdParty;
            }
        }

        const thirdPartyTypeshedPathEx = this.getTypeshedPathEx(execEnv, importFailureInfo);
        if (thirdPartyTypeshedPathEx) {
            const candidateModuleName = this.getModuleNameFromPath(thirdPartyTypeshedPathEx, filePath);

            // Does this candidate look better than the previous best module name?
            // We'll always try to use the shortest version.
            if (!moduleName || (candidateModuleName && candidateModuleName.length < moduleName.length)) {
                moduleName = candidateModuleName;
                importType = ImportType.ThirdParty;
            }
        }

        // Look for the import in the list of third-party packages.
        const pythonSearchPaths = this.getPythonSearchPaths(importFailureInfo);
        for (const searchPath of pythonSearchPaths) {
            const candidateModuleName = this.getModuleNameFromPath(searchPath, filePath);

            // Does this candidate look better than the previous best module name?
            // We'll always try to use the shortest version.
            if (!moduleName || (candidateModuleName && candidateModuleName.length < moduleName.length)) {
                moduleName = candidateModuleName;
                importType = ImportType.ThirdParty;
            }
        }

        if (moduleName) {
            return { moduleName, importType, isLocalTypingsFile };
        }

        // We didn't find any module name.
        return { moduleName: '', importType: ImportType.Local, isLocalTypingsFile };
    }

    getTypeshedStdLibPath(execEnv: ExecutionEnvironment) {
        const unused: string[] = [];
        return this._getStdlibTypeshedPath(execEnv, unused);
    }

    getImportRoots(execEnv: ExecutionEnvironment, forLogging = false) {
        const importFailureInfo: string[] = [];
        const roots = [];

        const stdTypeshed = this._getStdlibTypeshedPath(execEnv, importFailureInfo);
        if (stdTypeshed) {
            roots.push(stdTypeshed);
        }

        // The "default" workspace has a root-less execution environment; ignore it.
        if (execEnv.root) {
            roots.push(execEnv.root);
        }

        roots.push(...execEnv.extraPaths);

        if (this._configOptions.stubPath) {
            roots.push(this._configOptions.stubPath);
        }

        if (forLogging) {
            // There's one path for each third party package, which blows up logging.
            // Just get the root directly and show it with `...` to indicate that this
            // is where the third party folder is in the roots.
            const thirdPartyRoot = this._getThirdPartyTypeshedPath(execEnv, importFailureInfo);
            if (thirdPartyRoot) {
                roots.push(combinePaths(thirdPartyRoot, '...'));
            }
        } else {
            const thirdPartyPaths = this._getThirdPartyTypeshedPackageRoots(execEnv, importFailureInfo);
            roots.push(...thirdPartyPaths);
        }

        const typeshedPathEx = this.getTypeshedPathEx(execEnv, importFailureInfo);
        if (typeshedPathEx) {
            roots.push(typeshedPathEx);
        }

        const pythonSearchPaths = this.getPythonSearchPaths(importFailureInfo);
        if (pythonSearchPaths.length > 0) {
            roots.push(...pythonSearchPaths);
        }

        return roots;
    }

    protected readdirEntriesCached(path: string): Dirent[] {
        const cachedValue = this._cachedEntriesForPath.get(path);
        if (cachedValue) {
            return cachedValue;
        }

        let newCacheValue: Dirent[];
        try {
            newCacheValue = this.fileSystem.readdirEntriesSync(path);
        } catch {
            newCacheValue = [];
        }

        // Populate cache for next time.
        this._cachedEntriesForPath.set(path, newCacheValue);
        return newCacheValue;
    }

    protected fileExistsCached(path: string): boolean {
        const splitPath = this._splitPath(path);

        if (!splitPath[0] || !splitPath[1]) {
            if (!this.fileSystem.existsSync(path)) {
                return false;
            }
            return tryStat(this.fileSystem, path)?.isFile() ?? false;
        }

        const entries = this.readdirEntriesCached(splitPath[0]);
        const entry = entries.find((entry) => entry.name === splitPath[1]);
        if (entry?.isFile()) {
            return true;
        }

        if (entry?.isSymbolicLink()) {
            const realPath = tryRealpath(this.fileSystem, path);
            if (realPath && this.fileSystem.existsSync(realPath) && isFile(this.fileSystem, realPath)) {
                return true;
            }
        }

        return false;
    }

    protected dirExistsCached(path: string): boolean {
        const splitPath = this._splitPath(path);

        if (!splitPath[0] || !splitPath[1]) {
            if (!this.fileSystem.existsSync(path)) {
                return false;
            }
            return tryStat(this.fileSystem, path)?.isDirectory() ?? false;
        }

        const entries = this.readdirEntriesCached(splitPath[0]);
        const entry = entries.find((entry) => entry.name === splitPath[1]);
        if (entry?.isDirectory()) {
            return true;
        }

        if (entry?.isSymbolicLink()) {
            const realPath = tryRealpath(this.fileSystem, path);
            if (realPath && this.fileSystem.existsSync(realPath) && isDirectory(this.fileSystem, realPath)) {
                return true;
            }
        }

        return false;
    }

    ensurePartialStubPackages(execEnv: ExecutionEnvironment) {
        if (!(this.fileSystem instanceof PyrightFileSystem)) {
            return false;
        }

        if (this.fileSystem.isPartialStubPackagesScanned(execEnv)) {
            return false;
        }

        const fs = this.fileSystem;
        const ignored: string[] = [];
        const paths: string[] = [];

        // Add paths to search stub packages.
        addPaths(this._configOptions.stubPath);
        addPaths(execEnv.root);
        execEnv.extraPaths.forEach((p) => addPaths(p));
        addPaths(this.getTypeshedPathEx(execEnv, ignored));
        this.getPythonSearchPaths(ignored).forEach((p) => addPaths(p));

        this.fileSystem.processPartialStubPackages(paths, this.getImportRoots(execEnv));
        this._invalidateFileSystemCache();
        return true;

        function addPaths(path?: string) {
            if (!path || fs.isPathScanned(path)) {
                return;
            }

            paths.push(path);
        }
    }

    protected addResultsToCache(
        execEnv: ExecutionEnvironment,
        importName: string,
        importResult: ImportResult,
        importedSymbols: string[] | undefined
    ) {
        getOrAdd(this._cachedImportResults, execEnv.root, () => new Map<string, ImportResult>()).set(
            importName,
            importResult
        );

        return this.filterImplicitImports(importResult, importedSymbols);
    }

    // Follows import resolution algorithm defined in PEP-420:
    // https://www.python.org/dev/peps/pep-0420/
    protected resolveAbsoluteImport(
        rootPath: string,
        execEnv: ExecutionEnvironment,
        moduleDescriptor: ImportedModuleDescriptor,
        importName: string,
        importFailureInfo: string[],
        allowPartial = false,
        allowNativeLib = false,
        useStubPackage = false,
        allowPyi = true,
        lookForPyTyped = false
    ): ImportResult {
        if (allowPyi && useStubPackage) {
            // Look for packaged stubs first. PEP 561 indicates that package authors can ship
            // their stubs separately from their package implementation by appending the string
            // '-stubs' to its top - level directory name. We'll look there first.
            const importResult = this._resolveAbsoluteImport(
                rootPath,
                execEnv,
                moduleDescriptor,
                importName,
                importFailureInfo,
                allowPartial,
                /* allowNativeLib */ false,
                /* useStubPackage */ true,
                /* allowPyi */ true,
                /* lookForPyTyped */ true
            );

            // We found fully typed stub packages.
            if (importResult.packageDirectory) {
                // If this is a namespace package that wasn't resolved, assume that
                // it's a partial stub package and continue looking for a real package.
                if (!importResult.isNamespacePackage || importResult.isImportFound) {
                    return importResult;
                }
            }
        }

        return this._resolveAbsoluteImport(
            rootPath,
            execEnv,
            moduleDescriptor,
            importName,
            importFailureInfo,
            allowPartial,
            allowNativeLib,
            /* useStubPackage */ false,
            allowPyi,
            lookForPyTyped
        );
    }

    private _invalidateFileSystemCache() {
        this._cachedEntriesForPath.clear();
    }

    // Splits a path into the name of the containing directory and
    // a file or dir within that containing directory.
    private _splitPath(path: string): [string, string] {
        const pathComponents = getPathComponents(path);
        if (pathComponents.length <= 1) {
            return [path, ''];
        }

        const containingPath = combinePathComponents(pathComponents.slice(0, -1));
        const fileOrDirName = pathComponents[pathComponents.length - 1];

        return [containingPath, fileOrDirName];
    }

    private _resolveAbsoluteImport(
        rootPath: string,
        execEnv: ExecutionEnvironment,
        moduleDescriptor: ImportedModuleDescriptor,
        importName: string,
        importFailureInfo: string[],
        allowPartial: boolean,
        allowNativeLib: boolean,
        useStubPackage: boolean,
        allowPyi: boolean,
        lookForPyTyped: boolean
    ): ImportResult {
        if (useStubPackage) {
            importFailureInfo.push(`Attempting to resolve stub package using root path '${rootPath}'`);
        } else {
            importFailureInfo.push(`Attempting to resolve using root path '${rootPath}'`);
        }

        // Starting at the specified path, walk the file system to find the
        // specified module.
        const resolvedPaths: string[] = [];
        let dirPath = rootPath;
        let isNamespacePackage = false;
        let isStubPackage = false;
        let isStubFile = false;
        let isNativeLib = false;
        let implicitImports: ImplicitImport[] = [];
        let packageDirectory: string | undefined;
        let pyTypedInfo: PyTypedInfo | undefined;

        // Handle the "from . import XXX" case.
        if (moduleDescriptor.nameParts.length === 0) {
            const fileNameWithoutExtension = '__init__';
            const pyFilePath = combinePaths(dirPath, fileNameWithoutExtension + '.py');
            const pyiFilePath = combinePaths(dirPath, fileNameWithoutExtension + '.pyi');

            if (allowPyi && this.fileExistsCached(pyiFilePath)) {
                importFailureInfo.push(`Resolved import with file '${pyiFilePath}'`);
                resolvedPaths.push(pyiFilePath);
                isStubFile = true;
            } else if (this.fileExistsCached(pyFilePath)) {
                importFailureInfo.push(`Resolved import with file '${pyFilePath}'`);
                resolvedPaths.push(pyFilePath);
            } else {
                importFailureInfo.push(`Partially resolved import with directory '${dirPath}'`);
                resolvedPaths.push('');
                isNamespacePackage = true;
            }

            implicitImports = this._findImplicitImports(importName, dirPath, [pyFilePath, pyiFilePath]);
        } else {
            for (let i = 0; i < moduleDescriptor.nameParts.length; i++) {
                const isFirstPart = i === 0;
                const isLastPart = i === moduleDescriptor.nameParts.length - 1;
                dirPath = combinePaths(dirPath, moduleDescriptor.nameParts[i]);

                if (useStubPackage && isFirstPart) {
                    dirPath += stubsSuffix;
                    isStubPackage = true;
                }

                const foundDirectory = this.dirExistsCached(dirPath);

                if (foundDirectory) {
                    if (isFirstPart) {
                        packageDirectory = dirPath;
                    }

                    // See if we can find an __init__.py[i] in this directory.
                    const fileNameWithoutExtension = '__init__';
                    const pyFilePath = combinePaths(dirPath, fileNameWithoutExtension + '.py');
                    const pyiFilePath = combinePaths(dirPath, fileNameWithoutExtension + '.pyi');
                    let foundInit = false;

                    if (allowPyi && this.fileExistsCached(pyiFilePath)) {
                        importFailureInfo.push(`Resolved import with file '${pyiFilePath}'`);
                        resolvedPaths.push(pyiFilePath);
                        if (isLastPart) {
                            isStubFile = true;
                        }
                        foundInit = true;
                    } else if (this.fileExistsCached(pyFilePath)) {
                        importFailureInfo.push(`Resolved import with file '${pyFilePath}'`);
                        resolvedPaths.push(pyFilePath);
                        foundInit = true;
                    }

                    if (foundInit && !pyTypedInfo && lookForPyTyped) {
                        if (this.fileExistsCached(combinePaths(dirPath, 'py.typed'))) {
                            pyTypedInfo = getPyTypedInfo(this.fileSystem, dirPath);
                        }
                    }

                    if (!isLastPart) {
                        // We are not at the last part, and we found a directory,
                        // so continue to look for the next part.
                        if (!foundInit) {
                            resolvedPaths.push('');
                            isNamespacePackage = true;
                            pyTypedInfo = undefined;
                        }
                        continue;
                    }

                    if (foundInit) {
                        implicitImports = this._findImplicitImports(moduleDescriptor.nameParts.join('.'), dirPath, [
                            pyFilePath,
                            pyiFilePath,
                        ]);
                        break;
                    }
                }

                // We weren't able to find a directory or we found a directory with
                // no __init__.py[i] file. See if we can find a ".py" or ".pyi" file
                // with this name.
                let fileDirectory = stripTrailingDirectorySeparator(dirPath);
                const fileNameWithoutExtension = getFileName(fileDirectory);
                fileDirectory = getDirectoryPath(fileDirectory);
                const pyFilePath = combinePaths(fileDirectory, fileNameWithoutExtension + '.py');
                const pyiFilePath = combinePaths(fileDirectory, fileNameWithoutExtension + '.pyi');

                if (allowPyi && this.fileExistsCached(pyiFilePath)) {
                    importFailureInfo.push(`Resolved import with file '${pyiFilePath}'`);
                    resolvedPaths.push(pyiFilePath);
                    if (isLastPart) {
                        isStubFile = true;
                    }
                } else if (this.fileExistsCached(pyFilePath)) {
                    importFailureInfo.push(`Resolved import with file '${pyFilePath}'`);
                    resolvedPaths.push(pyFilePath);
                } else {
                    if (allowNativeLib && this.dirExistsCached(fileDirectory)) {
                        const filesInDir = this._getFilesInDirectory(fileDirectory);
                        const nativeLibFileName = filesInDir.find((f) =>
                            this._isNativeModuleFileName(fileNameWithoutExtension, f)
                        );
                        if (nativeLibFileName) {
                            const nativeLibPath = combinePaths(fileDirectory, nativeLibFileName);
                            // Try resolving native library to a custom stub.
                            isNativeLib = this._resolveNativeModuleStub(
                                nativeLibPath,
                                execEnv,
                                importName,
                                moduleDescriptor,
                                importFailureInfo,
                                resolvedPaths
                            );
                        }
                    }

                    if (!isNativeLib && foundDirectory) {
                        importFailureInfo.push(`Partially resolved import with directory '${dirPath}'`);
                        resolvedPaths.push('');
                        if (isLastPart) {
                            implicitImports = this._findImplicitImports(importName, dirPath, [pyFilePath, pyiFilePath]);
                            isNamespacePackage = true;
                        }
                    } else if (isNativeLib) {
                        importFailureInfo.push(`Did not find file '${pyiFilePath}' or '${pyFilePath}'`);
                    }
                }
                break;
            }
        }

        let importFound: boolean;
        const isPartlyResolved = resolvedPaths.length > 0 && resolvedPaths.length < moduleDescriptor.nameParts.length;
        if (allowPartial) {
            importFound = resolvedPaths.length > 0;
        } else {
            importFound = resolvedPaths.length >= moduleDescriptor.nameParts.length;
        }

        return {
            importName,
            isRelative: false,
            isNamespacePackage,
            isStubPackage,
            isImportFound: importFound,
            isPartlyResolved,
            importFailureInfo,
            importType: ImportType.Local,
            resolvedPaths,
            searchPath: rootPath,
            isStubFile,
            isNativeLib,
            implicitImports,
            pyTypedInfo,
            filteredImplicitImports: implicitImports,
            packageDirectory,
        };
    }

    // Intended to be overridden by subclasses to provide additional stub
    // path capabilities. Return undefined if no extra stub path were found.
    protected getTypeshedPathEx(execEnv: ExecutionEnvironment, importFailureInfo: string[]): string | undefined {
        return undefined;
    }

    // Intended to be overridden by subclasses to provide additional stub
    // resolving capabilities. Return undefined if no stubs were found for
    // this import.
    protected resolveImportEx(
        sourceFilePath: string,
        execEnv: ExecutionEnvironment,
        moduleDescriptor: ImportedModuleDescriptor,
        importName: string,
        importFailureInfo: string[] = [],
        allowPyi = true
    ): ImportResult | undefined {
        return undefined;
    }

    // Intended to be overridden by subclasses to provide additional stub
    // resolving capabilities for native (compiled) modules. Returns undefined
    // if no stubs were found for this import.
    protected resolveNativeImportEx(
        libraryFilePath: string,
        importName: string,
        importFailureInfo: string[] = []
    ): string | undefined {
        return undefined;
    }

    protected getNativeModuleName(fileName: string): string | undefined {
        const fileExtension = getFileExtension(fileName, /* multiDotExtension */ false).toLowerCase();
        if (this._isNativeModuleFileExtension(fileExtension)) {
            return stripFileExtension(stripFileExtension(fileName));
        }
        return undefined;
    }

    private _lookUpResultsInCache(
        execEnv: ExecutionEnvironment,
        importName: string,
        importedSymbols: string[] | undefined
    ) {
        const cacheForExecEnv = this._cachedImportResults.get(execEnv.root);
        if (!cacheForExecEnv) {
            return undefined;
        }

        const cachedEntry = cacheForExecEnv.get(importName);
        if (!cachedEntry) {
            return undefined;
        }

        return this.filterImplicitImports(cachedEntry, importedSymbols);
    }

    // Determines whether a namespace package resolves all of the symbols
    // requested in the module descriptor. Namespace packages have no "__init__.py"
    // file, so the only way that symbols can be resolved is if submodules
    // are present. If specific symbols were requested, make sure they
    // are all satisfied by submodules (as listed in the implicit imports).
    private _isNamespacePackageResolved(moduleDescriptor: ImportedModuleDescriptor, implicitImports: ImplicitImport[]) {
        if (moduleDescriptor.importedSymbols) {
            if (
                !moduleDescriptor.importedSymbols.some((symbol) => {
                    return implicitImports.some((implicitImport) => {
                        return implicitImport.name === symbol;
                    });
                })
            ) {
                return false;
            }
        } else if (implicitImports.length === 0) {
            return false;
        }
        return true;
    }

    protected getModuleNameFromPath(
        containerPath: string,
        filePath: string,
        stripTopContainerDir = false
    ): string | undefined {
        containerPath = ensureTrailingDirectorySeparator(containerPath);
        let filePathWithoutExtension = stripFileExtension(filePath);

        // If module is native, strip platform part, such as 'cp36-win_amd64' in 'mtrand.cp36-win_amd64'.
        if (this._isNativeModuleFileExtension(getFileExtension(filePath))) {
            filePathWithoutExtension = stripFileExtension(filePathWithoutExtension);
        }

        if (!filePathWithoutExtension.startsWith(containerPath)) {
            return undefined;
        }

        // Strip off the '/__init__' if it's present.
        if (filePathWithoutExtension.endsWith('__init__')) {
            filePathWithoutExtension = filePathWithoutExtension.substr(0, filePathWithoutExtension.length - 9);
        }

        const relativeFilePath = filePathWithoutExtension.substr(containerPath.length);
        const parts = getPathComponents(relativeFilePath);
        parts.shift();
        if (stripTopContainerDir) {
            if (parts.length === 0) {
                return undefined;
            }
            parts.shift();
        }

        if (parts.length === 0) {
            return undefined;
        }

        // Handle the case where the symbol was resolved to a stubs package
        // rather than the real package. We'll strip off the "-stubs" suffix
        // in this case.
        if (parts[0].endsWith(stubsSuffix)) {
            parts[0] = parts[0].substr(0, parts[0].length - stubsSuffix.length);
        }

        // Check whether parts contains invalid characters.
        if (parts.some((p) => !this._isIdentifier(p))) {
            return undefined;
        }

        return parts.join('.');
    }

    private _resolveBestAbsoluteImport(
        sourceFilePath: string,
        execEnv: ExecutionEnvironment,
        moduleDescriptor: ImportedModuleDescriptor,
        allowPyi: boolean
    ): ImportResult | undefined {
        const importName = this.formatImportName(moduleDescriptor);
        const importFailureInfo: string[] = [];

        // Check for a local stub file using stubPath.
        if (allowPyi && this._configOptions.stubPath) {
            importFailureInfo.push(`Looking in stubPath '${this._configOptions.stubPath}'`);
            const typingsImport = this.resolveAbsoluteImport(
                this._configOptions.stubPath,
                execEnv,
                moduleDescriptor,
                importName,
                importFailureInfo,
                /* allowPartial */ undefined,
                /* allowNativeLib */ false,
                /* useStubPackage */ true,
                allowPyi,
                /* lookForPyTyped */ false
            );

            if (typingsImport.isImportFound) {
                // We will treat typings files as "local" rather than "third party".
                typingsImport.importType = ImportType.Local;
                typingsImport.isLocalTypingsFile = true;
                return typingsImport;
            }
        }

        let bestResultSoFar: ImportResult | undefined;
        let localImport: ImportResult | undefined;

        // Look for it in the root directory of the execution environment.
        if (execEnv.root) {
            importFailureInfo.push(`Looking in root directory of execution environment ` + `'${execEnv.root}'`);

            localImport = this.resolveAbsoluteImport(
                execEnv.root,
                execEnv,
                moduleDescriptor,
                importName,
                importFailureInfo,
                /* allowPartial */ undefined,
                /* allowNativeLib */ true,
                /* useStubPackage */ true,
                allowPyi,
                /* lookForPyTyped */ false
            );
            bestResultSoFar = localImport;
        }

        for (const extraPath of execEnv.extraPaths) {
            importFailureInfo.push(`Looking in extraPath '${extraPath}'`);
            localImport = this.resolveAbsoluteImport(
                extraPath,
                execEnv,
                moduleDescriptor,
                importName,
                importFailureInfo,
                /* allowPartial */ undefined,
                /* allowNativeLib */ true,
                /* useStubPackage */ true,
                allowPyi,
                /* lookForPyTyped */ false
            );
            bestResultSoFar = this._pickBestImport(bestResultSoFar, localImport, moduleDescriptor);
        }

        // Look for the import in the list of third-party packages.
        const pythonSearchPaths = this.getPythonSearchPaths(importFailureInfo);
        if (pythonSearchPaths.length > 0) {
            for (const searchPath of pythonSearchPaths) {
                importFailureInfo.push(`Looking in python search path '${searchPath}'`);

                const thirdPartyImport = this.resolveAbsoluteImport(
                    searchPath,
                    execEnv,
                    moduleDescriptor,
                    importName,
                    importFailureInfo,
                    /* allowPartial */ allowPartialResolutionForThirdPartyPackages,
                    /* allowNativeLib */ true,
                    /* useStubPackage */ true,
                    allowPyi,
                    /* lookForPyTyped */ true
                );

                if (thirdPartyImport) {
                    thirdPartyImport.importType = ImportType.ThirdParty;

                    if (thirdPartyImport.isImportFound && thirdPartyImport.isStubFile) {
                        return thirdPartyImport;
                    }

                    bestResultSoFar = this._pickBestImport(bestResultSoFar, thirdPartyImport, moduleDescriptor);
                }
            }
        } else {
            importFailureInfo.push('No python interpreter search path');
        }

        // If a library is fully py.typed, then we have found the best match,
        // unless the execution environment is typeshed itself, in which case
        // we don't want to favor py.typed libraries. Use the typeshed lookup below.
        if (execEnv.root !== this._getTypeshedRoot(execEnv, importFailureInfo)) {
            if (bestResultSoFar?.pyTypedInfo && !bestResultSoFar.isPartlyResolved) {
                return bestResultSoFar;
            }
        }

        // Call the extensibility hook for subclasses.
        const extraResults = this.resolveImportEx(
            sourceFilePath,
            execEnv,
            moduleDescriptor,
            importName,
            importFailureInfo,
            allowPyi
        );

        if (extraResults) {
            return extraResults;
        }

        if (allowPyi && moduleDescriptor.nameParts.length > 0) {
            // Check for a stdlib typeshed file.
            importFailureInfo.push(`Looking for typeshed stdlib path`);
            const typeshedStdlibImport = this._findTypeshedPath(
                execEnv,
                moduleDescriptor,
                importName,
                /* isStdLib */ true,
                importFailureInfo
            );

            if (typeshedStdlibImport) {
                typeshedStdlibImport.isTypeshedFile = true;
                return typeshedStdlibImport;
            }

            // Check for a third-party typeshed file.
            importFailureInfo.push(`Looking for typeshed third-party path`);
            const typeshedImport = this._findTypeshedPath(
                execEnv,
                moduleDescriptor,
                importName,
                /* isStdLib */ false,
                importFailureInfo
            );

            if (typeshedImport) {
                typeshedImport.isTypeshedFile = true;
                bestResultSoFar = this._pickBestImport(bestResultSoFar, typeshedImport, moduleDescriptor);
            }
        }

        // We weren't able to find an exact match, so return the best
        // partial match.
        return bestResultSoFar;
    }

    private _pickBestImport(
        bestImportSoFar: ImportResult | undefined,
        newImport: ImportResult | undefined,
        moduleDescriptor: ImportedModuleDescriptor
    ) {
        if (!bestImportSoFar) {
            return newImport;
        }

        if (!newImport) {
            return bestImportSoFar;
        }

        if (newImport.isImportFound) {
            // Prefer found over not found.
            if (!bestImportSoFar.isImportFound) {
                return newImport;
            }

            // Prefer traditional over namespace imports.
            if (bestImportSoFar.isNamespacePackage && !newImport.isNamespacePackage) {
                return newImport;
            }

            // Prefer local packages.
            if (bestImportSoFar.importType === ImportType.Local && !bestImportSoFar.isNamespacePackage) {
                return bestImportSoFar;
            }

            // If both are namespace imports, select the one that resolves the symbols.
            if (
                bestImportSoFar.isNamespacePackage &&
                newImport.isNamespacePackage &&
                moduleDescriptor.importedSymbols
            ) {
                if (
                    !this._isNamespacePackageResolved(moduleDescriptor, bestImportSoFar.implicitImports) &&
                    this._isNamespacePackageResolved(moduleDescriptor, newImport.implicitImports)
                ) {
                    return newImport;
                }
            }

            // Prefer py.typed over non-py.typed.
            if (bestImportSoFar.pyTypedInfo && !newImport.pyTypedInfo) {
                return bestImportSoFar;
            } else if (!bestImportSoFar.pyTypedInfo && newImport.pyTypedInfo) {
                return newImport;
            }

            // Prefer pyi over py.
            if (bestImportSoFar.isStubFile && !newImport.isStubFile) {
                return bestImportSoFar;
            } else if (!bestImportSoFar.isStubFile && newImport.isStubFile) {
                return newImport;
            }

            // All else equal, prefer shorter resolution paths.
            if (bestImportSoFar.resolvedPaths.length > newImport.resolvedPaths.length) {
                return newImport;
            }
        } else if (newImport.isPartlyResolved && bestImportSoFar.isNamespacePackage && !newImport.isNamespacePackage) {
            // Always prefer a traditional over namespace import even
            // if the traditional import is only partly resolved.
            return newImport;
        }

        return bestImportSoFar;
    }

    private _isIdentifier(value: string) {
        for (let i = 0; i < value.length; i++) {
            if (i === 0 ? !isIdentifierStartChar(value.charCodeAt(i)) : !isIdentifierChar(value.charCodeAt(i))) {
                return false;
            }
        }

        return true;
    }

    protected getPythonSearchPaths(importFailureInfo: string[]) {
        // Find the site packages for the configured virtual environment.
        if (!this._cachedPythonSearchPaths) {
            const paths = (
                PythonPathUtils.findPythonSearchPaths(
                    this.fileSystem,
                    this._configOptions,
                    this.host,
                    importFailureInfo
                ) || []
            ).map((p) => this.fileSystem.realCasePath(p));

            // Remove duplicates (yes, it happens).
            this._cachedPythonSearchPaths = [...new Set(paths)];
        }

        return this._cachedPythonSearchPaths;
    }

    private _findTypeshedPath(
        execEnv: ExecutionEnvironment,
        moduleDescriptor: ImportedModuleDescriptor,
        importName: string,
        isStdLib: boolean,
        importFailureInfo: string[]
    ): ImportResult | undefined {
        importFailureInfo.push(
            `Looking for typeshed ${
                isStdLib ? PythonPathUtils.stdLibFolderName : PythonPathUtils.thirdPartyFolderName
            } path`
        );

        let typeshedPaths: string[] | undefined;
        if (isStdLib) {
            const path = this._getStdlibTypeshedPath(execEnv, importFailureInfo, moduleDescriptor);
            if (path) {
                typeshedPaths = [path];
            }
        } else {
            typeshedPaths = this._getThirdPartyTypeshedPackagePaths(moduleDescriptor, execEnv, importFailureInfo);
        }

        if (typeshedPaths) {
            for (const typeshedPath of typeshedPaths) {
                if (this.dirExistsCached(typeshedPath)) {
                    const importInfo = this.resolveAbsoluteImport(
                        typeshedPath,
                        execEnv,
                        moduleDescriptor,
                        importName,
                        importFailureInfo
                    );
                    if (importInfo.isImportFound) {
                        importInfo.importType = isStdLib ? ImportType.BuiltIn : ImportType.ThirdParty;
                        return importInfo;
                    }
                }
            }
        }

        importFailureInfo.push(`Typeshed path not found`);
        return undefined;
    }

    // Populates a cache of third-party packages found within the typeshed
    // directory. They are organized such that top-level directories contain
    // the pypi-registered name of the package and an inner directory contains
    // the name of the package as it is referenced by import statements. These
    // don't always match.
    private _buildTypeshedThirdPartyPackageMap(thirdPartyDir: string | undefined) {
        this._cachedTypeshedThirdPartyPackagePaths = new Map<string, string[]>();

        if (thirdPartyDir) {
            this.readdirEntriesCached(thirdPartyDir).forEach((outerEntry) => {
                if (outerEntry.isDirectory()) {
                    const innerDirPath = combinePaths(thirdPartyDir, outerEntry.name);

                    this.readdirEntriesCached(innerDirPath).forEach((innerEntry) => {
                        if (innerEntry.name === '@python2') {
                            return;
                        }

                        if (innerEntry.isDirectory()) {
                            const pathList = this._cachedTypeshedThirdPartyPackagePaths!.get(innerEntry.name);
                            if (pathList) {
                                pathList.push(innerDirPath);
                            } else {
                                this._cachedTypeshedThirdPartyPackagePaths!.set(innerEntry.name, [innerDirPath]);
                            }
                        } else if (innerEntry.isFile()) {
                            if (innerEntry.name.endsWith('.pyi')) {
                                const strippedFileName = stripFileExtension(innerEntry.name);
                                const pathList = this._cachedTypeshedThirdPartyPackagePaths!.get(strippedFileName);
                                if (pathList) {
                                    pathList.push(innerDirPath);
                                } else {
                                    this._cachedTypeshedThirdPartyPackagePaths!.set(strippedFileName, [innerDirPath]);
                                }
                            }
                        }
                    });
                }
            });
        }

        this._cachedTypeshedThirdPartyPackageRoots = [
            ...new Set(...this._cachedTypeshedThirdPartyPackagePaths.values()),
        ].sort();
    }

    private _getCompletionSuggestionsTypeshedPath(
        sourceFilePath: string,
        execEnv: ExecutionEnvironment,
        moduleDescriptor: ImportedModuleDescriptor,
        isStdLib: boolean,
        suggestions: Set<string>
    ) {
        const importFailureInfo: string[] = [];

        let typeshedPaths: string[] | undefined;
        if (isStdLib) {
            const path = this._getStdlibTypeshedPath(execEnv, importFailureInfo, moduleDescriptor);
            if (path) {
                typeshedPaths = [path];
            }
        } else {
            typeshedPaths = this._getThirdPartyTypeshedPackagePaths(
                moduleDescriptor,
                execEnv,
                importFailureInfo,
                /*includeMatchOnly*/ false
            );

            const typeshedPathEx = this.getTypeshedPathEx(execEnv, importFailureInfo);
            if (typeshedPathEx) {
                typeshedPaths = typeshedPaths ?? [];
                typeshedPaths.push(typeshedPathEx);
            }
        }

        if (!typeshedPaths) {
            return;
        }

        typeshedPaths.forEach((typeshedPath) => {
            if (this.dirExistsCached(typeshedPath)) {
                this._getCompletionSuggestionsAbsolute(
                    sourceFilePath,
                    execEnv,
                    typeshedPath,
                    moduleDescriptor,
                    suggestions
                );
            }
        });
    }

    // Returns the directory for a module within the stdlib typeshed directory.
    // If moduleDescriptor is provided, it is filtered based on the VERSIONS
    // file in the typeshed stubs.
    private _getStdlibTypeshedPath(
        execEnv: ExecutionEnvironment,
        importFailureInfo: string[],
        moduleDescriptor?: ImportedModuleDescriptor
    ) {
        const subdirectory = this._getTypeshedSubdirectory(/* isStdLib */ true, execEnv, importFailureInfo);
        if (
            subdirectory &&
            moduleDescriptor &&
            !this._isStdlibTypeshedStubValidForVersion(moduleDescriptor, execEnv, importFailureInfo)
        ) {
            return undefined;
        }

        return subdirectory;
    }

    private _getThirdPartyTypeshedPath(execEnv: ExecutionEnvironment, importFailureInfo: string[]) {
        return this._getTypeshedSubdirectory(/* isStdLib */ false, execEnv, importFailureInfo);
    }

    private _isStdlibTypeshedStubValidForVersion(
        moduleDescriptor: ImportedModuleDescriptor,
        execEnv: ExecutionEnvironment,
        importFailureInfo: string[]
    ) {
        if (!this._cachedTypeshedStdLibModuleVersions) {
            this._cachedTypeshedStdLibModuleVersions = this._readTypeshedStdLibVersions(execEnv, importFailureInfo);
        }

        // Loop through the name parts to make sure the module and submodules
        // referenced in the import statement are valid for this version of Python.
        for (let namePartCount = 1; namePartCount <= moduleDescriptor.nameParts.length; namePartCount++) {
            const namePartsToConsider = moduleDescriptor.nameParts.slice(0, namePartCount);
            const versionRange = this._cachedTypeshedStdLibModuleVersions.get(namePartsToConsider.join('.'));
            if (versionRange) {
                if (execEnv.pythonVersion < versionRange.min) {
                    return false;
                }

                if (versionRange.max !== undefined && execEnv.pythonVersion > versionRange.max) {
                    return false;
                }
            }
        }

        return true;
    }

    private _readTypeshedStdLibVersions(
        execEnv: ExecutionEnvironment,
        importFailureInfo: string[]
    ): Map<string, SupportedVersionRange> {
        const versionRangeMap = new Map<string, SupportedVersionRange>();

        // Read the VERSIONS file from typeshed.
        const typeshedStdLibPath = this._getTypeshedSubdirectory(/* isStdLib */ true, execEnv, importFailureInfo);

        if (typeshedStdLibPath) {
            const versionsFilePath = combinePaths(typeshedStdLibPath, 'VERSIONS');
            try {
                const fileStats = this.fileSystem.statSync(versionsFilePath);
                if (fileStats.size > 0 && fileStats.size < 256 * 1024) {
                    const fileContents = this.fileSystem.readFileSync(versionsFilePath, 'utf8');
                    fileContents.split(/\r?\n/).forEach((line) => {
                        const commentSplit = line.split('#');
                        const colonSplit = commentSplit[0].split(':');
                        if (colonSplit.length !== 2) {
                            return;
                        }

                        const versionSplit = colonSplit[1].split('-');
                        if (versionSplit.length > 2) {
                            return;
                        }

                        const moduleName = colonSplit[0].trim();
                        if (!moduleName) {
                            return;
                        }

                        let minVersionString = versionSplit[0].trim();
                        if (minVersionString.endsWith('+')) {
                            // If the version ends in "+", strip it off.
                            minVersionString = minVersionString.substr(0, minVersionString.length - 1);
                        }
                        let minVersion = versionFromString(minVersionString);
                        if (!minVersion) {
                            minVersion = PythonVersion.V3_0;
                        }

                        let maxVersion: PythonVersion | undefined;
                        if (versionSplit.length > 1) {
                            maxVersion = versionFromString(versionSplit[1].trim());
                        }

                        versionRangeMap.set(moduleName, { min: minVersion, max: maxVersion });
                    });
                } else {
                    importFailureInfo.push(`Typeshed stdlib VERSIONS file is unexpectedly large`);
                }
            } catch (e: any) {
                importFailureInfo.push(`Could not read typeshed stdlib VERSIONS file: '${JSON.stringify(e)}'`);
            }
        }

        return versionRangeMap;
    }

    private _getThirdPartyTypeshedPackagePaths(
        moduleDescriptor: ImportedModuleDescriptor,
        execEnv: ExecutionEnvironment,
        importFailureInfo: string[],
        includeMatchOnly = true
    ): string[] | undefined {
        const typeshedPath = this._getThirdPartyTypeshedPath(execEnv, importFailureInfo);

        if (!this._cachedTypeshedThirdPartyPackagePaths) {
            this._buildTypeshedThirdPartyPackageMap(typeshedPath);
        }

        const firstNamePart = moduleDescriptor.nameParts.length > 0 ? moduleDescriptor.nameParts[0] : '';
        if (includeMatchOnly) {
            return this._cachedTypeshedThirdPartyPackagePaths!.get(firstNamePart);
        }

        if (firstNamePart) {
            return flatten(
                getMapValues(this._cachedTypeshedThirdPartyPackagePaths!, (k) => k.startsWith(firstNamePart))
            );
        }

        return [];
    }

    private _getThirdPartyTypeshedPackageRoots(execEnv: ExecutionEnvironment, importFailureInfo: string[]) {
        const typeshedPath = this._getThirdPartyTypeshedPath(execEnv, importFailureInfo);

        if (!this._cachedTypeshedThirdPartyPackagePaths) {
            this._buildTypeshedThirdPartyPackageMap(typeshedPath);
        }

        return this._cachedTypeshedThirdPartyPackageRoots!;
    }

    private _getTypeshedRoot(execEnv: ExecutionEnvironment, importFailureInfo: string[]) {
        if (this._cachedTypeshedRoot !== undefined) {
            return this._cachedTypeshedRoot;
        }

        let typeshedPath = '';

        // Did the user specify a typeshed path? If not, we'll look in the
        // python search paths, then in the typeshed-fallback directory.
        if (this._configOptions.typeshedPath) {
            const possibleTypeshedPath = this._configOptions.typeshedPath;
            if (this.dirExistsCached(possibleTypeshedPath)) {
                typeshedPath = possibleTypeshedPath;
            }
        } else {
            const pythonSearchPaths = this.getPythonSearchPaths(importFailureInfo);
            for (const searchPath of pythonSearchPaths) {
                const possibleTypeshedPath = combinePaths(searchPath, 'typeshed');
                if (this.dirExistsCached(possibleTypeshedPath)) {
                    typeshedPath = possibleTypeshedPath;
                    break;
                }
            }
        }

        // If typeshed directory wasn't found in other locations, use the fallback.
        if (!typeshedPath) {
            typeshedPath = PythonPathUtils.getTypeShedFallbackPath(this.fileSystem) || '';
        }

        this._cachedTypeshedRoot = typeshedPath;
        return typeshedPath;
    }

    private _getTypeshedSubdirectory(isStdLib: boolean, execEnv: ExecutionEnvironment, importFailureInfo: string[]) {
        // See if we have it cached.
        if (isStdLib) {
            if (this._cachedTypeshedStdLibPath !== undefined) {
                return this._cachedTypeshedStdLibPath;
            }
        } else {
            if (this._cachedTypeshedThirdPartyPath !== undefined) {
                return this._cachedTypeshedThirdPartyPath;
            }
        }

        let typeshedPath = this._getTypeshedRoot(execEnv, importFailureInfo);
        typeshedPath = PythonPathUtils.getTypeshedSubdirectory(typeshedPath, isStdLib);

        if (!this.dirExistsCached(typeshedPath)) {
            return undefined;
        }

        // Cache the results.
        if (isStdLib) {
            this._cachedTypeshedStdLibPath = typeshedPath;
        } else {
            this._cachedTypeshedThirdPartyPath = typeshedPath;
        }

        return typeshedPath;
    }

    private _resolveRelativeImport(
        sourceFilePath: string,
        execEnv: ExecutionEnvironment,
        moduleDescriptor: ImportedModuleDescriptor,
        importName: string,
        importFailureInfo: string[]
    ): ImportResult | undefined {
        importFailureInfo.push('Attempting to resolve relative import');

        // Determine which search path this file is part of.
        const directory = getDirectoryLeadingDotsPointsTo(
            getDirectoryPath(sourceFilePath),
            moduleDescriptor.leadingDots
        );
        if (!directory) {
            importFailureInfo.push(`Invalid relative path '${importName}'`);
            return undefined;
        }

        // Now try to match the module parts from the current directory location.
        const absImport = this.resolveAbsoluteImport(
            directory,
            execEnv,
            moduleDescriptor,
            importName,
            importFailureInfo,
            /* allowPartial */ false,
            /* allowNativeLib */ true
        );
        return this.filterImplicitImports(absImport, moduleDescriptor.importedSymbols);
    }

    private _getCompletionSuggestionsRelative(
        sourceFilePath: string,
        execEnv: ExecutionEnvironment,
        moduleDescriptor: ImportedModuleDescriptor,
        suggestions: Set<string>
    ) {
        // Determine which search path this file is part of.
        const directory = getDirectoryLeadingDotsPointsTo(
            getDirectoryPath(sourceFilePath),
            moduleDescriptor.leadingDots
        );
        if (!directory) {
            return;
        }

        // Now try to match the module parts from the current directory location.
        this._getCompletionSuggestionsAbsolute(sourceFilePath, execEnv, directory, moduleDescriptor, suggestions);
    }

    private _getFilesInDirectory(dirPath: string): string[] {
        const entriesInDir = this.readdirEntriesCached(dirPath);
        const filesInDir = entriesInDir.filter((f) => f.isFile()).map((f) => f.name);

        // Add any symbolic links that point to files.
        entriesInDir.forEach((f) => {
            const linkPath = combinePaths(dirPath, f.name);
            if (f.isSymbolicLink() && tryStat(this.fileSystem, linkPath)?.isFile()) {
                filesInDir.push(f.name);
            }
        });

        return filesInDir;
    }

    private _getCompletionSuggestionsAbsolute(
        sourceFilePath: string,
        execEnv: ExecutionEnvironment,
        rootPath: string,
        moduleDescriptor: ImportedModuleDescriptor,
        suggestions: Set<string>,
        strictOnly = true
    ) {
        // Starting at the specified path, walk the file system to find the
        // specified module.
        let dirPath = rootPath;

        // Copy the nameParts into a new directory and add an extra empty
        // part if there is a trailing dot.
        const nameParts = moduleDescriptor.nameParts.map((name) => name);
        if (moduleDescriptor.hasTrailingDot) {
            nameParts.push('');
        }

        // We need to track this since a module might be resolvable using relative path
        // but can't resolved by absolute path.
        const leadingDots = moduleDescriptor.leadingDots;
        const parentNameParts = nameParts.slice(0, -1);

        // Handle the case where the user has typed the first
        // dot (or multiple) in a relative path.
        if (nameParts.length === 0) {
            this._addFilteredSuggestionsAbsolute(
                sourceFilePath,
                execEnv,
                dirPath,
                '',
                suggestions,
                leadingDots,
                parentNameParts,
                strictOnly
            );
        } else {
            for (let i = 0; i < nameParts.length; i++) {
                // Provide completions only if we're on the last part
                // of the name.
                if (i === nameParts.length - 1) {
                    this._addFilteredSuggestionsAbsolute(
                        sourceFilePath,
                        execEnv,
                        dirPath,
                        nameParts[i],
                        suggestions,
                        leadingDots,
                        parentNameParts,
                        strictOnly
                    );
                }

                dirPath = combinePaths(dirPath, nameParts[i]);
                if (!this.dirExistsCached(dirPath)) {
                    break;
                }
            }
        }
    }

    private _addFilteredSuggestionsAbsolute(
        sourceFilePath: string,
        execEnv: ExecutionEnvironment,
        currentPath: string,
        filter: string,
        suggestions: Set<string>,
        leadingDots: number,
        parentNameParts: string[],
        strictOnly: boolean
    ) {
        // Enumerate all of the files and directories in the path, expanding links.
        const entries = getFileSystemEntriesFromDirEntries(
            this.readdirEntriesCached(currentPath),
            this.fileSystem,
            currentPath
        );

        entries.files.forEach((file) => {
            // Strip multi-dot extensions to handle file names like "foo.cpython-32m.so". We want
            // to detect the ".so" but strip off the entire ".cpython-32m.so" extension.
            const fileExtension = getFileExtension(file, /* multiDotExtension */ false).toLowerCase();
            const fileWithoutExtension = stripFileExtension(file, /* multiDotExtension */ true);

            if (supportedFileExtensions.some((ext) => ext === fileExtension)) {
                if (fileWithoutExtension === '__init__') {
                    return;
                }

                if (filter && !StringUtils.isPatternInSymbol(filter, fileWithoutExtension)) {
                    return;
                }

                if (
                    !this._isUniqueValidSuggestion(fileWithoutExtension, suggestions) ||
                    !this._isResolvableSuggestion(
                        fileWithoutExtension,
                        leadingDots,
                        parentNameParts,
                        sourceFilePath,
                        execEnv,
                        strictOnly
                    )
                ) {
                    return;
                }

                suggestions.add(fileWithoutExtension);
            }
        });

        entries.directories.forEach((dir) => {
            if (filter && !dir.startsWith(filter)) {
                return;
            }

            if (
                !this._isUniqueValidSuggestion(dir, suggestions) ||
                !this._isResolvableSuggestion(dir, leadingDots, parentNameParts, sourceFilePath, execEnv, strictOnly)
            ) {
                return;
            }

            suggestions.add(dir);
        });
    }

    // Fix for editable installed submodules where the suggested directory was a namespace directory that wouldn't resolve.
    // only used for absolute imports
    private _isResolvableSuggestion(
        name: string,
        leadingDots: number,
        parentNameParts: string[],
        sourceFilePath: string,
        execEnv: ExecutionEnvironment,
        strictOnly: boolean
    ) {
        // We always resolve names based on sourceFilePath.
        const moduleDescriptor = {
            leadingDots: leadingDots,
            nameParts: [...parentNameParts, name],
            importedSymbols: [],
        };

        // Make sure we don't use parent folder resolution when checking whether the given name is resolvable.
        if (strictOnly) {
            const importName = this.formatImportName(moduleDescriptor);
            const importFailureInfo: string[] = [];

            return this._resolveImportStrict(importName, sourceFilePath, execEnv, moduleDescriptor, importFailureInfo)
                .isImportFound;
        }

        return this._resolveImport(sourceFilePath, execEnv, moduleDescriptor).isImportFound;
    }

    private _isUniqueValidSuggestion(suggestionToAdd: string, suggestions: Set<string>) {
        if (suggestions.has(suggestionToAdd)) {
            return false;
        }

        // Don't add directories with illegal module names.
        if (/[.-]/.test(suggestionToAdd)) {
            return false;
        }

        // Don't add directories with dunder names like "__pycache__".
        if (isDunderName(suggestionToAdd) && suggestionToAdd !== '__future__') {
            return false;
        }

        return true;
    }

    // Potentially modifies the ImportResult by removing some or all of the
    // implicit import entries. Only the imported symbols should be included.
    protected filterImplicitImports(importResult: ImportResult, importedSymbols: string[] | undefined): ImportResult {
        if (importedSymbols === undefined) {
            const newImportResult = Object.assign({}, importResult);
            newImportResult.filteredImplicitImports = [];
            return newImportResult;
        }

        if (importedSymbols.length === 0) {
            return importResult;
        }

        if (importResult.implicitImports.length === 0) {
            return importResult;
        }

        const filteredImplicitImports = importResult.implicitImports.filter((implicitImport) => {
            return importedSymbols.some((sym) => sym === implicitImport.name);
        });

        if (filteredImplicitImports.length === importResult.implicitImports.length) {
            return importResult;
        }

        const newImportResult = Object.assign({}, importResult);
        newImportResult.filteredImplicitImports = filteredImplicitImports;
        return newImportResult;
    }

    private _findImplicitImports(importingModuleName: string, dirPath: string, exclusions: string[]): ImplicitImport[] {
        const implicitImportMap = new Map<string, ImplicitImport>();

        // Enumerate all of the files and directories in the path, expanding links.
        const entries = getFileSystemEntriesFromDirEntries(
            this.readdirEntriesCached(dirPath),
            this.fileSystem,
            dirPath
        );

        // Add implicit file-based modules.
        for (const fileName of entries.files) {
            const fileExt = getFileExtension(fileName);
            let strippedFileName: string;
            let isNativeLib = false;

            if (fileExt === '.py' || fileExt === '.pyi') {
                strippedFileName = stripFileExtension(fileName);
            } else if (
                this._isNativeModuleFileExtension(fileExt) &&
                !this.fileExistsCached(`${fileName}.py`) &&
                !this.fileExistsCached(`${fileName}.pyi`)
            ) {
                // Native module.
                strippedFileName = fileName.substr(0, fileName.indexOf('.'));
                isNativeLib = true;
            } else {
                continue;
            }

            const filePath = combinePaths(dirPath, fileName);
            if (!exclusions.find((exclusion) => exclusion === filePath)) {
                const implicitImport: ImplicitImport = {
                    isStubFile: fileName.endsWith('.pyi'),
                    isNativeLib,
                    name: strippedFileName,
                    path: filePath,
                };

                // Always prefer stub files over non-stub files.
                const entry = implicitImportMap.get(implicitImport.name);
                if (!entry || !entry.isStubFile) {
                    // Try resolving resolving native lib to a custom stub.
                    if (isNativeLib) {
                        const nativeLibPath = combinePaths(dirPath, fileName);
                        const nativeStubPath = this.resolveNativeImportEx(
                            nativeLibPath,
                            `${importingModuleName}.${strippedFileName}`,
                            []
                        );
                        if (nativeStubPath) {
                            implicitImport.path = nativeStubPath;
                            implicitImport.isNativeLib = false;
                        }
                    }
                    implicitImportMap.set(implicitImport.name, implicitImport);
                }
            }
        }

        // Add implicit directory-based modules.
        for (const dirName of entries.directories) {
            const pyFilePath = combinePaths(dirPath, dirName, '__init__.py');
            const pyiFilePath = pyFilePath + 'i';
            let isStubFile = false;
            let path = '';

            if (this.fileExistsCached(pyiFilePath)) {
                isStubFile = true;
                path = pyiFilePath;
            } else if (this.fileExistsCached(pyFilePath)) {
                path = pyFilePath;
            }

            if (path) {
                if (!exclusions.find((exclusion) => exclusion === path)) {
                    const implicitImport: ImplicitImport = {
                        isStubFile,
                        isNativeLib: false,
                        name: dirName,
                        path,
                    };

                    implicitImportMap.set(implicitImport.name, implicitImport);
                }
            }
        }

        return [...implicitImportMap.values()];
    }

    protected formatImportName(moduleDescriptor: ImportedModuleDescriptor) {
        return '.'.repeat(moduleDescriptor.leadingDots) + moduleDescriptor.nameParts.join('.');
    }

    private _resolveNativeModuleStub(
        nativeLibPath: string,
        execEnv: ExecutionEnvironment,
        importName: string,
        moduleDescriptor: ImportedModuleDescriptor,
        importFailureInfo: string[],
        resolvedPaths: string[]
    ): boolean {
        let moduleFullName = importName;

        if (moduleDescriptor.leadingDots > 0) {
            // Relative path. Convert `.mtrand` to `numpy.random.mtrand` based on search path.
            const info = this.getModuleNameForImport(nativeLibPath, execEnv);
            moduleFullName = info.moduleName.length > 0 ? info.moduleName : moduleFullName;
        }

        const compiledStubPath = this.resolveNativeImportEx(nativeLibPath, moduleFullName, importFailureInfo);
        if (compiledStubPath) {
            importFailureInfo.push(`Resolved native import ${importName} with stub '${compiledStubPath}'`);
            resolvedPaths.push(compiledStubPath);
            return false; // Resolved to a stub.
        }

        importFailureInfo.push(`Resolved import with file '${nativeLibPath}'`);
        resolvedPaths.push(nativeLibPath);
        return true;
    }

    private _isNativeModuleFileName(moduleName: string, fileName: string): boolean {
        // Strip off the final file extension and the part of the file name
        // that excludes all (multi-part) file extensions. This allows us to
        // handle file names like "foo.cpython-32m.so".
        const fileExtension = getFileExtension(fileName, /* multiDotExtension */ false).toLowerCase();
        const withoutExtension = stripFileExtension(fileName, /* multiDotExtension */ true);
        return (
            this._isNativeModuleFileExtension(fileExtension) &&
            equateStringsCaseInsensitive(moduleName, withoutExtension)
        );
    }

    private _isNativeModuleFileExtension(fileExtension: string): boolean {
        return supportedNativeLibExtensions.some((ext) => ext === fileExtension);
    }

    private _tryWalkUp(current: string): [success: boolean, path: string] {
        if (isDiskPathRoot(current)) {
            return [false, ''];
        }

        return [
            true,
            ensureTrailingDirectorySeparator(
                normalizePathCase(this.fileSystem, normalizePath(combinePaths(current, '..')))
            ),
        ];
    }

    private _shouldWalkUp(current: string, root: string, execEnv: ExecutionEnvironment) {
        return current.length > root.length || (current === root && !execEnv.root);
    }

    protected getParentImportResolutionRoot(sourceFilePath: string, executionRoot: string | undefined) {
        if (executionRoot) {
            return ensureTrailingDirectorySeparator(normalizePathCase(this.fileSystem, normalizePath(executionRoot)));
        }

        return ensureTrailingDirectorySeparator(getDirectoryPath(sourceFilePath));
    }
}

export type ImportResolverFactory = (fs: FileSystem, options: ConfigOptions, host: Host) => ImportResolver;
