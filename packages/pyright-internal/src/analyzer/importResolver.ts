/*
 * importResolver.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides the logic for resolving imports according to the
 * runtime rules of Python.
 */

import { Dirent } from 'fs';

import { getOrAdd } from '../common/collectionUtils';
import { ConfigOptions, ExecutionEnvironment } from '../common/configOptions';
import { FileSystem } from '../common/fileSystem';
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
    isFile,
    resolvePaths,
    stripFileExtension,
    stripTrailingDirectorySeparator,
    tryStat,
} from '../common/pathUtils';
import { equateStringsCaseInsensitive } from '../common/stringUtils';
import * as StringUtils from '../common/stringUtils';
import { isIdentifierChar, isIdentifierStartChar } from '../parser/characters';
import { PyrightFileSystem } from '../pyrightFileSystem';
import { ImplicitImport, ImportResult, ImportType } from './importResult';
import * as PythonPathUtils from './pythonPathUtils';
import { getPyTypedInfo, PyTypedInfo } from './pyTypedUtils';
import { isDunderName } from './symbolNameUtils';

export interface ImportedModuleDescriptor {
    leadingDots: number;
    nameParts: string[];
    hasTrailingDot?: boolean;
    importedSymbols: string[] | undefined;
}

export interface ModuleNameAndType {
    moduleName: string;
    importType: ImportType;
    isLocalTypingsFile: boolean;
}

type CachedImportResults = Map<string, ImportResult>;

const supportedNativeLibExtensions = ['.pyd', '.so', '.dylib'];
const supportedFileExtensions = ['.py', '.pyi', ...supportedNativeLibExtensions];

// Should we allow partial resolution for third-party packages? Some use tricks
// to populate their package namespaces, so we might be able to partially resolve
// a multi - part import(e.g. "a.b.c") but not fully resolve it. If this is set to
// false, we will have some false positives. If it is set to true, we won't report
// errors when these partial-resolutions fail.
const allowPartialResolutionForThirdPartyPackages = false;

export class ImportResolver {
    protected _configOptions: ConfigOptions;

    private _cachedPythonSearchPaths = new Map<string, string[]>();
    private _cachedImportResults = new Map<string, CachedImportResults>();
    private _cachedModuleNameResults = new Map<string, Map<string, ModuleNameAndType>>();
    private _cachedTypeshedStdLibPath: string | undefined;
    private _cachedTypeshedThirdPartyPath: string | undefined;
    private _cachedTypeshedThirdPartyPackagePaths: Map<string, string> | undefined;
    private _cachedTypeshedThirdPartyPackageRoots: string[] | undefined;
    private _cachedEntriesForPath = new Map<string, Dirent[]>();

    readonly fileSystem: FileSystem;

    constructor(fs: FileSystem, configOptions: ConfigOptions) {
        this.fileSystem = fs;
        this._configOptions = configOptions;
    }

    invalidateCache() {
        this._cachedPythonSearchPaths = new Map<string, string[]>();
        this._cachedImportResults = new Map<string, CachedImportResults>();
        this._cachedModuleNameResults = new Map<string, Map<string, ModuleNameAndType>>();
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
        const importName = this._formatImportName(moduleDescriptor);
        const importFailureInfo: string[] = [];

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
        moduleDescriptor: ImportedModuleDescriptor,
        similarityLimit: number
    ): string[] {
        const importFailureInfo: string[] = [];
        const suggestions: string[] = [];

        // Is it a relative import?
        if (moduleDescriptor.leadingDots > 0) {
            this._getCompletionSuggestionsRelative(sourceFilePath, moduleDescriptor, suggestions, similarityLimit);
        } else {
            // First check for a typeshed file.
            if (moduleDescriptor.nameParts.length > 0) {
                this._getCompletionSuggestionsTypeshedPath(
                    execEnv,
                    moduleDescriptor,
                    true,
                    suggestions,
                    similarityLimit
                );
            }

            // Look for it in the root directory of the execution environment.
            this._getCompletionSuggestionsAbsolute(execEnv.root, moduleDescriptor, suggestions, similarityLimit);

            for (const extraPath of execEnv.extraPaths) {
                this._getCompletionSuggestionsAbsolute(extraPath, moduleDescriptor, suggestions, similarityLimit);
            }

            // Check for a typings file.
            if (this._configOptions.stubPath) {
                this._getCompletionSuggestionsAbsolute(
                    this._configOptions.stubPath,
                    moduleDescriptor,
                    suggestions,
                    similarityLimit
                );
            }

            // Check for a typeshed file.
            this._getCompletionSuggestionsTypeshedPath(execEnv, moduleDescriptor, false, suggestions, similarityLimit);

            // Look for the import in the list of third-party packages.
            const pythonSearchPaths = this._getPythonSearchPaths(execEnv, importFailureInfo);
            for (const searchPath of pythonSearchPaths) {
                this._getCompletionSuggestionsAbsolute(searchPath, moduleDescriptor, suggestions, similarityLimit);
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

                            if (nonEmptyPath.endsWith('.py')) {
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
            moduleName = this._getModuleNameFromPath(stdLibTypeshedPath, filePath);
            if (moduleName) {
                return { moduleName, importType, isLocalTypingsFile };
            }
        }

        // Look for it in the root directory of the execution environment.
        moduleName = this._getModuleNameFromPath(execEnv.root, filePath);

        for (const extraPath of execEnv.extraPaths) {
            const candidateModuleName = this._getModuleNameFromPath(extraPath, filePath);

            // Does this candidate look better than the previous best module name?
            // We'll always try to use the shortest version.
            if (!moduleName || (candidateModuleName && candidateModuleName.length < moduleName.length)) {
                moduleName = candidateModuleName;
                importType = ImportType.Local;
            }
        }

        // Check for a typings file.
        if (this._configOptions.stubPath) {
            const candidateModuleName = this._getModuleNameFromPath(this._configOptions.stubPath, filePath);

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
            const candidateModuleName = this._getModuleNameFromPath(
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
            const candidateModuleName = this._getModuleNameFromPath(thirdPartyTypeshedPathEx, filePath);

            // Does this candidate look better than the previous best module name?
            // We'll always try to use the shortest version.
            if (!moduleName || (candidateModuleName && candidateModuleName.length < moduleName.length)) {
                moduleName = candidateModuleName;
                importType = ImportType.ThirdParty;
            }
        }

        // Look for the import in the list of third-party packages.
        const pythonSearchPaths = this._getPythonSearchPaths(execEnv, importFailureInfo);
        for (const searchPath of pythonSearchPaths) {
            const candidateModuleName = this._getModuleNameFromPath(searchPath, filePath);

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

    getImportRoots(execEnv: ExecutionEnvironment) {
        const importFailureInfo: string[] = [];
        const roots = [];

        const stdTypeshed = this._getStdlibTypeshedPath(execEnv, importFailureInfo);
        if (stdTypeshed) {
            roots.push(stdTypeshed);
        }

        roots.push(execEnv.root);
        roots.push(...execEnv.extraPaths);

        if (this._configOptions.stubPath) {
            roots.push(this._configOptions.stubPath);
        }

        const thirdPartyPaths = this._getThirdPartyTypeshedPackagePaths(execEnv, importFailureInfo);
        roots.push(...thirdPartyPaths);

        const typeshedPathEx = this.getTypeshedPathEx(execEnv, importFailureInfo);
        if (typeshedPathEx) {
            roots.push(typeshedPathEx);
        }

        const pythonSearchPaths = this._getPythonSearchPaths(execEnv, importFailureInfo);
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
            const realPath = this.fileSystem.realpathSync(path);
            if (this.fileSystem.existsSync(realPath) && isFile(this.fileSystem, realPath)) {
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
            const realPath = this.fileSystem.realpathSync(path);
            if (this.fileSystem.existsSync(realPath) && isDirectory(this.fileSystem, realPath)) {
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
        this._getPythonSearchPaths(execEnv, ignored).forEach((p) => addPaths(p));

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

        return this._filterImplicitImports(importResult, importedSymbols);
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
                return importResult;
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
        importFailureInfo.push(`Attempting to resolve using root path '${rootPath}'`);

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

        return this._filterImplicitImports(cachedEntry, importedSymbols);
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

    private _getModuleNameFromPath(
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
        const importName = this._formatImportName(moduleDescriptor);
        const importFailureInfo: string[] = [];

        // First check for a stdlib typeshed file.
        if (allowPyi && moduleDescriptor.nameParts.length > 0) {
            const builtInImport = this._findTypeshedPath(
                execEnv,
                moduleDescriptor,
                importName,
                /* isStdLib */ true,
                importFailureInfo
            );
            if (builtInImport) {
                builtInImport.isTypeshedFile = true;
                return builtInImport;
            }
        }

        if (allowPyi) {
            // Check for a local stub file using stubPath.
            if (this._configOptions.stubPath) {
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
        }

        let bestResultSoFar: ImportResult | undefined;

        // Look for it in the root directory of the execution environment.
        importFailureInfo.push(`Looking in root directory of execution environment ` + `'${execEnv.root}'`);
        let localImport = this.resolveAbsoluteImport(
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
            bestResultSoFar = this._pickBestImport(bestResultSoFar, localImport);
        }

        // Look for the import in the list of third-party packages.
        const pythonSearchPaths = this._getPythonSearchPaths(execEnv, importFailureInfo);
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

                    bestResultSoFar = this._pickBestImport(bestResultSoFar, thirdPartyImport);
                }
            }
        } else {
            importFailureInfo.push('No python interpreter search path');
        }

        const extraResults = this.resolveImportEx(
            sourceFilePath,
            execEnv,
            moduleDescriptor,
            importName,
            importFailureInfo,
            allowPyi
        );
        if (extraResults !== undefined) {
            return extraResults;
        }

        if (allowPyi) {
            // Check for a third-party typeshed file.
            importFailureInfo.push(`Looking for typeshed path`);
            const typeshedImport = this._findTypeshedPath(
                execEnv,
                moduleDescriptor,
                importName,
                /* isStdLib */ false,
                importFailureInfo
            );
            if (typeshedImport) {
                typeshedImport.isTypeshedFile = true;
                return typeshedImport;
            }
        }

        // We weren't able to find an exact match, so return the best
        // partial match.
        return bestResultSoFar;
    }

    private _pickBestImport(bestImportSoFar: ImportResult | undefined, newImport: ImportResult | undefined) {
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

    private _getPythonSearchPaths(execEnv: ExecutionEnvironment, importFailureInfo: string[]) {
        const cacheKey = '<default>';

        // Find the site packages for the configured virtual environment.
        if (!this._cachedPythonSearchPaths.has(cacheKey)) {
            let paths =
                PythonPathUtils.findPythonSearchPaths(this.fileSystem, this._configOptions, importFailureInfo) || [];

            // Remove duplicates (yes, it happens).
            paths = [...new Set(paths)];

            this._cachedPythonSearchPaths.set(cacheKey, paths);
        }

        return this._cachedPythonSearchPaths.get(cacheKey)!;
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

        const typeshedPath = isStdLib
            ? this._getStdlibTypeshedPath(execEnv, importFailureInfo)
            : this._getThirdPartyTypeshedPackagePath(moduleDescriptor, execEnv, importFailureInfo);

        if (typeshedPath && this.dirExistsCached(typeshedPath)) {
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

        importFailureInfo.push(`Typeshed path not found`);
        return undefined;
    }

    // Populates a cache of third-party packages found within the typeshed
    // directory. They are organized such that top-level directories contain
    // the pypi-registered name of the package and an inner directory contains
    // the name of the package as it is referenced by import statements. These
    // don't always match.
    private _buildTypeshedThirdPartyPackageMap(thirdPartyDir: string | undefined) {
        this._cachedTypeshedThirdPartyPackagePaths = new Map<string, string>();

        if (thirdPartyDir) {
            this.readdirEntriesCached(thirdPartyDir).forEach((outerEntry) => {
                if (outerEntry.isDirectory()) {
                    const innerDirPath = combinePaths(thirdPartyDir, outerEntry.name);

                    this.readdirEntriesCached(innerDirPath).forEach((innerEntry) => {
                        if (innerEntry.name === '@python2') {
                            return;
                        }

                        if (innerEntry.isDirectory()) {
                            this._cachedTypeshedThirdPartyPackagePaths!.set(innerEntry.name, innerDirPath);
                        } else if (innerEntry.isFile()) {
                            if (innerEntry.name.endsWith('.pyi')) {
                                this._cachedTypeshedThirdPartyPackagePaths!.set(
                                    stripFileExtension(innerEntry.name),
                                    innerDirPath
                                );
                            }
                        }
                    });
                }
            });
        }

        this._cachedTypeshedThirdPartyPackageRoots = [
            ...new Set(this._cachedTypeshedThirdPartyPackagePaths.values()),
        ].sort();
    }

    private _getCompletionSuggestionsTypeshedPath(
        execEnv: ExecutionEnvironment,
        moduleDescriptor: ImportedModuleDescriptor,
        isStdLib: boolean,
        suggestions: string[],
        similarityLimit: number
    ) {
        const importFailureInfo: string[] = [];

        const typeshedPath = isStdLib
            ? this._getStdlibTypeshedPath(execEnv, importFailureInfo)
            : this._getThirdPartyTypeshedPackagePath(moduleDescriptor, execEnv, importFailureInfo);

        if (!typeshedPath) {
            return;
        }

        if (this.dirExistsCached(typeshedPath)) {
            this._getCompletionSuggestionsAbsolute(typeshedPath, moduleDescriptor, suggestions, similarityLimit);
        }
    }

    private _getStdlibTypeshedPath(execEnv: ExecutionEnvironment, importFailureInfo: string[]) {
        return this._getTypeshedSubdirectory(/* isStdLib */ true, execEnv, importFailureInfo);
    }

    private _getThirdPartyTypeshedPath(execEnv: ExecutionEnvironment, importFailureInfo: string[]) {
        return this._getTypeshedSubdirectory(/* isStdLib */ false, execEnv, importFailureInfo);
    }

    private _getThirdPartyTypeshedPackagePath(
        moduleDescriptor: ImportedModuleDescriptor,
        execEnv: ExecutionEnvironment,
        importFailureInfo: string[]
    ) {
        const typeshedPath = this._getThirdPartyTypeshedPath(execEnv, importFailureInfo);

        if (!this._cachedTypeshedThirdPartyPackagePaths) {
            this._buildTypeshedThirdPartyPackageMap(typeshedPath);
        }

        const firstNamePart = moduleDescriptor.nameParts.length > 0 ? moduleDescriptor.nameParts[0] : '';
        return this._cachedTypeshedThirdPartyPackagePaths!.get(firstNamePart);
    }

    private _getThirdPartyTypeshedPackagePaths(execEnv: ExecutionEnvironment, importFailureInfo: string[]) {
        const typeshedPath = this._getThirdPartyTypeshedPath(execEnv, importFailureInfo);

        if (!this._cachedTypeshedThirdPartyPackagePaths) {
            this._buildTypeshedThirdPartyPackageMap(typeshedPath);
        }

        return this._cachedTypeshedThirdPartyPackageRoots!;
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

        let typeshedPath = '';

        // Did the user specify a typeshed path? If not, we'll look in the
        // python search paths, then in the typeshed-fallback directory.
        if (this._configOptions.typeshedPath) {
            const possibleTypeshedPath = this._configOptions.typeshedPath;
            if (this.dirExistsCached(possibleTypeshedPath)) {
                typeshedPath = possibleTypeshedPath;
            }
        } else {
            const pythonSearchPaths = this._getPythonSearchPaths(execEnv, importFailureInfo);
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
        let curDir = getDirectoryPath(sourceFilePath);
        for (let i = 1; i < moduleDescriptor.leadingDots; i++) {
            if (curDir === '') {
                importFailureInfo.push(`Invalid relative path '${importName}'`);
                return undefined;
            }
            curDir = getDirectoryPath(curDir);
        }

        // Now try to match the module parts from the current directory location.
        const absImport = this.resolveAbsoluteImport(
            curDir,
            execEnv,
            moduleDescriptor,
            importName,
            importFailureInfo,
            /* allowPartial */ false,
            /* allowNativeLib */ true
        );
        return this._filterImplicitImports(absImport, moduleDescriptor.importedSymbols);
    }

    private _getCompletionSuggestionsRelative(
        sourceFilePath: string,
        moduleDescriptor: ImportedModuleDescriptor,
        suggestions: string[],
        similarityLimit: number
    ) {
        // Determine which search path this file is part of.
        let curDir = getDirectoryPath(sourceFilePath);
        for (let i = 1; i < moduleDescriptor.leadingDots; i++) {
            if (curDir === '') {
                return;
            }
            curDir = getDirectoryPath(curDir);
        }

        // Now try to match the module parts from the current directory location.
        this._getCompletionSuggestionsAbsolute(curDir, moduleDescriptor, suggestions, similarityLimit);
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
        rootPath: string,
        moduleDescriptor: ImportedModuleDescriptor,
        suggestions: string[],
        similarityLimit: number
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

        // Handle the case where the user has typed the first
        // dot (or multiple) in a relative path.
        if (nameParts.length === 0) {
            this._addFilteredSuggestions(dirPath, '', suggestions, similarityLimit);
        } else {
            for (let i = 0; i < nameParts.length; i++) {
                // Provide completions only if we're on the last part
                // of the name.
                if (i === nameParts.length - 1) {
                    this._addFilteredSuggestions(dirPath, nameParts[i], suggestions, similarityLimit);
                }

                dirPath = combinePaths(dirPath, nameParts[i]);
                if (!this.dirExistsCached(dirPath)) {
                    break;
                }
            }
        }
    }

    private _addFilteredSuggestions(dirPath: string, filter: string, suggestions: string[], similarityLimit: number) {
        // Enumerate all of the files and directories in the path, expanding links.
        const entries = getFileSystemEntriesFromDirEntries(
            this.readdirEntriesCached(dirPath),
            this.fileSystem,
            dirPath
        );

        entries.files.forEach((file) => {
            // Strip multi-dot extensions to handle file names like "foo.cpython-32m.so". We want
            // to detect the ".so" but strip off the entire ".cpython-32m.so" extension.
            const fileExtension = getFileExtension(file, /* multiDotExtension */ false).toLowerCase();
            const fileWithoutExtension = stripFileExtension(file, /* multiDotExtension */ true);

            if (supportedFileExtensions.some((ext) => ext === fileExtension)) {
                if (fileWithoutExtension !== '__init__') {
                    if (!filter || StringUtils.isPatternInSymbol(filter, fileWithoutExtension)) {
                        this._addUniqueSuggestion(fileWithoutExtension, suggestions);
                    }
                }
            }
        });

        entries.directories.forEach((dir) => {
            if (!filter || dir.startsWith(filter)) {
                this._addUniqueSuggestion(dir, suggestions);
            }
        });
    }

    private _addUniqueSuggestion(suggestionToAdd: string, suggestions: string[]) {
        if (suggestions.some((s) => s === suggestionToAdd)) {
            return;
        }

        // Don't add directories with illegal module names.
        if (/[.-]/.test(suggestionToAdd)) {
            return;
        }

        // Don't add directories with dunder names like "__pycache__".
        if (isDunderName(suggestionToAdd) && suggestionToAdd !== '__future__') {
            return;
        }

        suggestions.push(suggestionToAdd);
    }

    // Potentially modifies the ImportResult by removing some or all of the
    // implicit import entries. Only the imported symbols should be included.
    private _filterImplicitImports(importResult: ImportResult, importedSymbols: string[] | undefined): ImportResult {
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

    private _formatImportName(moduleDescriptor: ImportedModuleDescriptor) {
        let name = '';
        for (let i = 0; i < moduleDescriptor.leadingDots; i++) {
            name += '.';
        }

        return name + moduleDescriptor.nameParts.map((part) => part).join('.');
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
}

export type ImportResolverFactory = (fs: FileSystem, options: ConfigOptions) => ImportResolver;
