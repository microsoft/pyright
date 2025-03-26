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

import { appendArray, flatten, getMapValues, getOrAdd } from '../common/collectionUtils';
import { ConfigOptions, ExecutionEnvironment, matchFileSpecs } from '../common/configOptions';
import { Host } from '../common/host';
import { stubsSuffix } from '../common/pathConsts';
import { stripFileExtension } from '../common/pathUtils';
import { PythonVersion, pythonVersion3_0 } from '../common/pythonVersion';
import { ServiceProvider } from '../common/serviceProvider';
import * as StringUtils from '../common/stringUtils';
import { equateStringsCaseInsensitive } from '../common/stringUtils';
import { Uri } from '../common/uri/uri';
import { getFileSystemEntriesFromDirEntries, isDirectory, isFile, tryRealpath, tryStat } from '../common/uri/uriUtils';
import { Tokenizer } from '../parser/tokenizer';
import { ImplicitImport, ImportResult, ImportType } from './importResult';
import { getDirectoryLeadingDotsPointsTo } from './importStatementUtils';
import { ImportPath, ParentDirectoryCache } from './parentDirectoryCache';
import { PyTypedInfo, getPyTypedInfoForPyTypedFile } from './pyTypedUtils';
import * as PythonPathUtils from './pythonPathUtils';
import * as SymbolNameUtils from './symbolNameUtils';
import { isDunderName } from './symbolNameUtils';

export interface ImportedModuleDescriptor {
    leadingDots: number;
    nameParts: string[];
    hasTrailingDot?: boolean | undefined;
    importedSymbols: Set<string> | undefined;
}

export interface ModuleNameAndType {
    moduleName: string;
    importType: ImportType;
    isLocalTypingsFile: boolean;
}

export interface ModuleImportInfo extends ModuleNameAndType {
    isTypeshedFile: boolean;
    isThirdPartyPyTypedPresent: boolean;
}

export interface ModuleNameInfoFromPath {
    moduleName: string;
    containsInvalidCharacters?: boolean;
}

export function createImportedModuleDescriptor(moduleName: string): ImportedModuleDescriptor {
    if (moduleName.length === 0) {
        return { leadingDots: 0, nameParts: [], importedSymbols: new Set<string>() };
    }

    let startIndex = 0;
    let leadingDots = 0;
    for (; startIndex < moduleName.length; startIndex++) {
        if (moduleName[startIndex] !== '.') {
            break;
        }

        leadingDots++;
    }

    return {
        leadingDots,
        nameParts: moduleName.slice(startIndex).split('.'),
        importedSymbols: new Set<string>(),
    };
}

type CachedImportResults = Map<string, ImportResult>;
interface SupportedVersionInfo {
    min: PythonVersion;
    max?: PythonVersion | undefined;
    unsupportedPlatforms?: string[];
    supportedPlatforms?: string[];
}

const supportedNativeLibExtensions = ['.pyd', '.so', '.dylib'];
export const supportedSourceFileExtensions = ['.py', '.pyi'];
export const supportedFileExtensions = [...supportedSourceFileExtensions, ...supportedNativeLibExtensions];

// Should we allow partial resolution for third-party packages? Some use tricks
// to populate their package namespaces, so we might be able to partially resolve
// a multi - part import(e.g. "a.b.c") but not fully resolve it. If this is set to
// false, we will have some false positives. If it is set to true, we won't report
// errors when these partial-resolutions fail.
const allowPartialResolutionForThirdPartyPackages = false;

export class ImportResolver {
    private _cachedPythonSearchPaths: { paths: Uri[]; failureInfo: string[] } | undefined;
    private _cachedImportResults = new Map<string | undefined, CachedImportResults>();
    private _cachedModuleNameResults = new Map<string, Map<string, ModuleImportInfo>>();
    private _cachedTypeshedRoot: Uri | undefined;
    private _cachedTypeshedStdLibPath: Uri | undefined;
    private _cachedTypeshedStdLibModuleVersionInfo: Map<string, SupportedVersionInfo> | undefined;
    private _cachedTypeshedThirdPartyPath: Uri | undefined;
    private _cachedTypeshedThirdPartyPackagePaths: Map<string, Uri[]> | undefined;
    private _cachedTypeshedThirdPartyPackageRoots: Uri[] | undefined;
    private _cachedEntriesForPath = new Map<string, Dirent[]>();
    private _cachedFilesForPath = new Map<string, Uri[]>();
    private _cachedDirExistenceForRoot = new Map<string, boolean>();
    private _stdlibModules: Set<string> | undefined;

    protected readonly cachedParentImportResults: ParentDirectoryCache;

    constructor(readonly serviceProvider: ServiceProvider, private _configOptions: ConfigOptions, readonly host: Host) {
        this.cachedParentImportResults = new ParentDirectoryCache(() => this.getPythonSearchPaths([]));
    }

    get fileSystem() {
        return this.serviceProvider.fs();
    }

    get tmp() {
        return this.serviceProvider.tmp();
    }

    get partialStubs() {
        return this.serviceProvider.partialStubs();
    }

    static isSupportedImportSourceFile(uri: Uri) {
        const fileExtension = uri.lastExtension.toLowerCase();
        return supportedSourceFileExtensions.some((ext) => fileExtension === ext);
    }

    static isSupportedImportFile(uri: Uri) {
        const fileExtension = uri.lastExtension.toLowerCase();
        return supportedFileExtensions.some((ext) => fileExtension === ext);
    }

    invalidateCache() {
        this._cachedImportResults = new Map<string | undefined, CachedImportResults>();
        this._cachedModuleNameResults = new Map<string, Map<string, ModuleImportInfo>>();
        this.cachedParentImportResults.reset();
        this._stdlibModules = undefined;

        this._invalidateFileSystemCache();

        this.partialStubs?.clearPartialStubs();
    }

    // Resolves the import and returns the path if it exists, otherwise
    // returns undefined.
    resolveImport(
        sourceFileUri: Uri,
        execEnv: ExecutionEnvironment,
        moduleDescriptor: ImportedModuleDescriptor
    ): ImportResult {
        // Wrap internal call to resolveImportInternal() to prevent calling any
        // child class version of resolveImport().
        return this.resolveImportInternal(sourceFileUri, execEnv, moduleDescriptor);
    }

    getCompletionSuggestions(
        sourceFileUri: Uri,
        execEnv: ExecutionEnvironment,
        moduleDescriptor: ImportedModuleDescriptor
    ) {
        const suggestions = this._getCompletionSuggestionsStrict(sourceFileUri, execEnv, moduleDescriptor);

        // We only do parent import resolution for absolute path.
        if (moduleDescriptor.leadingDots > 0) {
            return suggestions;
        }

        const root = getParentImportResolutionRoot(sourceFileUri, execEnv.root);
        const origin = sourceFileUri.getDirectory();

        let current: Uri | undefined = origin;
        while (this._shouldWalkUp(current, root, execEnv) && current) {
            this._getCompletionSuggestionsAbsolute(
                sourceFileUri,
                execEnv,
                current,
                moduleDescriptor,
                suggestions,
                /* strictOnly */ false
            );

            current = this._tryWalkUp(current);
        }

        return suggestions;
    }

    getConfigOptions() {
        return this._configOptions;
    }

    setConfigOptions(configOptions: ConfigOptions): void {
        this._configOptions = configOptions;
        this.invalidateCache();
    }

    // Returns the implementation file(s) for the given stub file.
    getSourceFilesFromStub(stubFileUri: Uri, execEnv: ExecutionEnvironment, _mapCompiled: boolean): Uri[] {
        const sourceFileUris: Uri[] = [];

        // When ImportResolver resolves an import to a stub file, a second resolve is done
        // ignoring stub files, which gives us an approximation of where the implementation
        // for that stub is located.
        this._cachedImportResults.forEach((map) => {
            map.forEach((result) => {
                if (result.isStubFile && result.isImportFound && result.nonStubImportResult) {
                    if (result.resolvedUris[result.resolvedUris.length - 1].equals(stubFileUri)) {
                        if (result.nonStubImportResult.isImportFound) {
                            const nonEmptyUri =
                                result.nonStubImportResult.resolvedUris[
                                    result.nonStubImportResult.resolvedUris.length - 1
                                ];

                            if (nonEmptyUri.hasExtension('.py') || nonEmptyUri.hasExtension('.pyi')) {
                                // We allow pyi in case there are multiple pyi for a compiled module such as
                                // numpy.random.mtrand
                                sourceFileUris.push(nonEmptyUri);
                            }
                        }
                    }
                }
            });
        });

        // We haven't seen an import of that stub, attempt to find the source
        // in some other ways.
        if (sourceFileUris.length === 0) {
            // Simple case where the stub and source files are next to each other.
            const sourceFileUri = stubFileUri.replaceExtension('.py');
            if (this.dirExistsCached(sourceFileUri)) {
                sourceFileUris.push(sourceFileUri);
            }
        }

        if (sourceFileUris.length === 0) {
            // The stub and the source file may have the same name, but be located
            // in different folder hierarchies.
            // Example:
            // <stubPath>\package\module.pyi
            // <site-packages>\package\module.py
            // We get the relative path(s) of the stub to its import root(s),
            // in theory there can be more than one, then look for source
            // files in all the import roots using the same relative path(s).
            const importRoots = this.getImportRoots(execEnv);

            const relativeStubPaths: string[] = [];
            for (const importRootUri of importRoots) {
                if (stubFileUri.isChild(importRootUri)) {
                    const parts = Array.from(importRootUri.getRelativePathComponents(stubFileUri));

                    if (parts.length >= 1) {
                        // Handle the case where the symbol was resolved to a stubs package
                        // rather than the real package. We'll strip off the "-stubs" suffix
                        // in this case.
                        if (parts[0].endsWith(stubsSuffix)) {
                            parts[0] = parts[0].slice(0, parts[0].length - stubsSuffix.length);
                        }

                        relativeStubPaths.push(parts.join('/'));
                    }
                }
            }

            for (const relativeStubPath of relativeStubPaths) {
                for (const importRootUri of importRoots) {
                    const absoluteStubPath = importRootUri.resolvePaths(relativeStubPath);
                    let absoluteSourcePath = absoluteStubPath.replaceExtension('.py');
                    if (this.fileExistsCached(absoluteSourcePath)) {
                        sourceFileUris.push(absoluteSourcePath);
                    } else {
                        const filePathWithoutExtension = absoluteSourcePath.stripExtension();

                        if (filePathWithoutExtension.pathEndsWith('__init__')) {
                            // Did not match: <root>/package/__init__.py
                            // Try equivalent: <root>/package.py
                            absoluteSourcePath = filePathWithoutExtension.getDirectory().packageUri;
                            if (this.fileExistsCached(absoluteSourcePath)) {
                                sourceFileUris.push(absoluteSourcePath);
                            }
                        } else {
                            // Did not match: <root>/package.py
                            // Try equivalent: <root>/package/__init__.py
                            absoluteSourcePath = filePathWithoutExtension.initPyUri;
                            if (this.fileExistsCached(absoluteSourcePath)) {
                                sourceFileUris.push(absoluteSourcePath);
                            }
                        }
                    }
                }
            }
        }

        return sourceFileUris;
    }

    // Returns the module name (of the form X.Y.Z) that needs to be imported
    // from the current context to access the module with the specified file path.
    // In a sense, it's performing the inverse of resolveImport.
    getModuleNameForImport(
        fileUri: Uri,
        execEnv: ExecutionEnvironment,
        allowInvalidModuleName = false,
        detectPyTyped = false
    ) {
        // Cache results of the reverse of resolveImport as we cache resolveImport.
        const cache = getOrAdd(
            this._cachedModuleNameResults,
            execEnv.root?.key,
            () => new Map<string, ModuleImportInfo>()
        );
        const key = `${allowInvalidModuleName}.${detectPyTyped}.${fileUri.key}`;
        return getOrAdd(cache, key, () =>
            this._getModuleNameForImport(fileUri, execEnv, allowInvalidModuleName, detectPyTyped)
        );
    }

    getTypeshedStdLibPath(execEnv: ExecutionEnvironment) {
        const unused: string[] = [];
        return this._getStdlibTypeshedPath(
            this._configOptions.typeshedPath,
            execEnv.pythonVersion,
            execEnv.pythonPlatform,
            unused
        );
    }

    getTypeshedThirdPartyPath(execEnv: ExecutionEnvironment) {
        const unused: string[] = [];
        return this._getThirdPartyTypeshedPath(this._configOptions.typeshedPath, unused);
    }

    isStdlibModule(module: ImportedModuleDescriptor, execEnv: ExecutionEnvironment): boolean {
        if (!this._stdlibModules) {
            this._stdlibModules = this._buildStdlibCache(this.getTypeshedStdLibPath(execEnv), execEnv);
        }

        return this._stdlibModules.has(module.nameParts.join('.'));
    }

    getImportRoots(execEnv: ExecutionEnvironment, forLogging = false) {
        const importFailureInfo: string[] = [];
        const roots = [];

        const stdTypeshed = this._getStdlibTypeshedPath(
            this._configOptions.typeshedPath,
            execEnv.pythonVersion,
            execEnv.pythonPlatform,
            importFailureInfo
        );
        if (stdTypeshed) {
            roots.push(stdTypeshed);
        }

        // The "default" workspace has a root-less execution environment; ignore it.
        if (execEnv.root) {
            roots.push(execEnv.root);
        }

        appendArray(roots, execEnv.extraPaths);

        if (this._configOptions.stubPath) {
            roots.push(this._configOptions.stubPath);
        }

        if (forLogging) {
            // There's one path for each third party package, which blows up logging.
            // Just get the root directly and show it with `...` to indicate that this
            // is where the third party folder is in the roots.
            const thirdPartyRoot = this._getThirdPartyTypeshedPath(this._configOptions.typeshedPath, importFailureInfo);
            if (thirdPartyRoot) {
                roots.push(thirdPartyRoot.resolvePaths('...'));
            }
        } else {
            const thirdPartyPaths = this._getThirdPartyTypeshedPackageRoots(importFailureInfo);
            appendArray(roots, thirdPartyPaths);
        }

        const typeshedPathEx = this.getTypeshedPathEx(execEnv, importFailureInfo);
        if (typeshedPathEx) {
            roots.push(typeshedPathEx);
        }

        const pythonSearchPaths = this.getPythonSearchPaths(importFailureInfo);
        if (pythonSearchPaths.length > 0) {
            appendArray(roots, pythonSearchPaths);
        }

        return roots;
    }

    ensurePartialStubPackages(execEnv: ExecutionEnvironment) {
        if (!this.partialStubs) {
            return false;
        }

        if (this.partialStubs.isPartialStubPackagesScanned(execEnv)) {
            return false;
        }

        const ps = this.partialStubs;
        const ignored: string[] = [];
        const paths: Uri[] = [];
        const typeshedPathEx = this.getTypeshedPathEx(execEnv, ignored);

        // Add paths to search stub packages.
        addPaths(this._configOptions.stubPath);
        addPaths(execEnv.root ?? this._configOptions.projectRoot);
        execEnv.extraPaths.forEach((p) => addPaths(p));
        addPaths(typeshedPathEx);

        this.getPythonSearchPaths(ignored).forEach((p) => addPaths(p));

        this.partialStubs.processPartialStubPackages(paths, this.getImportRoots(execEnv), typeshedPathEx);
        this._invalidateFileSystemCache();
        return true;

        function addPaths(path?: Uri) {
            if (!path || ps.isPathScanned(path)) {
                return;
            }

            paths.push(path);
        }
    }

    getPythonSearchPaths(importFailureInfo: string[]): Uri[] {
        // Find the site packages for the configured virtual environment.
        if (!this._cachedPythonSearchPaths) {
            const info: string[] = [];
            const paths = (
                PythonPathUtils.findPythonSearchPaths(this.fileSystem, this._configOptions, this.host, info) || []
            ).map((p) => this.fileSystem.realCasePath(p));

            // Remove duplicates (yes, it happens).
            this._cachedPythonSearchPaths = { paths: Array.from(new Set(paths)), failureInfo: info };
        }

        // Make sure we cache the logs as well so we can find out why search path failed.
        importFailureInfo.push(...this._cachedPythonSearchPaths.failureInfo);
        return this._cachedPythonSearchPaths.paths;
    }

    getTypeshedStdlibExcludeList(
        customTypeshedPath: Uri | undefined,
        pythonVersion: PythonVersion,
        pythonPlatform: string | undefined
    ): Uri[] {
        const unused: string[] = [];
        const typeshedStdlibPath = this._getStdlibTypeshedPath(
            customTypeshedPath,
            pythonVersion,
            pythonPlatform,
            unused
        );
        const excludes: Uri[] = [];

        if (!typeshedStdlibPath) {
            return excludes;
        }

        if (!this._cachedTypeshedStdLibModuleVersionInfo) {
            this._cachedTypeshedStdLibModuleVersionInfo = this._readTypeshedStdLibVersions(customTypeshedPath, []);
        }

        this._cachedTypeshedStdLibModuleVersionInfo.forEach((versionInfo, moduleName) => {
            let shouldExcludeModule = false;

            if (versionInfo.max !== undefined && PythonVersion.isGreaterThan(pythonVersion, versionInfo.max)) {
                shouldExcludeModule = true;
            }

            if (pythonPlatform !== undefined) {
                const pythonPlatformLower = pythonPlatform.toLowerCase();

                // If there are supported platforms listed, and we are not using one
                // of those supported platforms, exclude it.
                if (versionInfo.supportedPlatforms) {
                    if (versionInfo.supportedPlatforms.every((p) => p.toLowerCase() !== pythonPlatformLower)) {
                        shouldExcludeModule = true;
                    }
                }

                // If there are unsupported platforms listed, see if we're using one of them.
                if (versionInfo.unsupportedPlatforms) {
                    if (versionInfo.unsupportedPlatforms.some((p) => p.toLowerCase() === pythonPlatformLower)) {
                        shouldExcludeModule = true;
                    }
                }
            }

            if (shouldExcludeModule) {
                // Add excludes for both the ".pyi" file and the directory that contains it
                // (in case it's using a "__init__.pyi" file).
                const moduleDirPath = typeshedStdlibPath.combinePaths(...moduleName.split('.'));
                excludes.push(moduleDirPath);

                const moduleFilePath = moduleDirPath.replaceExtension('.pyi');
                excludes.push(moduleFilePath);
            }
        });

        return excludes;
    }

    // Intended to be overridden by subclasses to provide additional stub
    // path capabilities. Return undefined if no extra stub path were found.
    getTypeshedPathEx(execEnv: ExecutionEnvironment, importFailureInfo: string[]): Uri | undefined {
        return undefined;
    }

    protected readdirEntriesCached(uri: Uri): Dirent[] {
        const cachedValue = this._cachedEntriesForPath.get(uri.key);
        if (cachedValue) {
            return cachedValue;
        }

        let newCacheValue: Dirent[];
        try {
            newCacheValue = this.fileSystem.readdirEntriesSync(uri);
        } catch {
            newCacheValue = [];
        }

        // Populate cache for next time.
        this._cachedEntriesForPath.set(uri.key, newCacheValue);
        return newCacheValue;
    }

    // Resolves the import and returns the path if it exists, otherwise
    // returns undefined.
    protected resolveImportInternal(
        sourceFileUri: Uri,
        execEnv: ExecutionEnvironment,
        moduleDescriptor: ImportedModuleDescriptor
    ): ImportResult {
        const importName = formatImportName(moduleDescriptor);
        const importFailureInfo: string[] = [];
        const importResult = this._resolveImportStrict(
            importName,
            sourceFileUri,
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
        const origin = sourceFileUri.getDirectory();

        const result = this.cachedParentImportResults.getImportResult(origin, importName, importResult);
        if (result) {
            // Already ran the parent directory resolution for this import name on this location.
            return this.filterImplicitImports(result, moduleDescriptor.importedSymbols);
        }

        // Check whether the given file is in the parent directory import resolution cache.
        const root = getParentImportResolutionRoot(sourceFileUri, execEnv.root);
        if (!this.cachedParentImportResults.checkValidPath(this.fileSystem, sourceFileUri, root)) {
            return importResult;
        }

        const localImportFailureInfo: string[] = [`Attempting to resolve using local imports: ${importName}`];
        const importPath: ImportPath = { importPath: undefined };

        // Going up the given folder one by one until we can resolve the import.
        let current: Uri | undefined = origin;
        while (this._shouldWalkUp(current, root, execEnv) && current) {
            const result = this.resolveAbsoluteImport(
                sourceFileUri,
                current,
                execEnv,
                moduleDescriptor,
                importName,
                localImportFailureInfo,
                /* allowPartial */ undefined,
                /* allowNativeLib */ undefined,
                /* useStubPackage */ false,
                /* allowPyi */ true
            );

            this.cachedParentImportResults.checked(current!, importName, importPath);

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

            current = this._tryWalkUp(current);
        }

        if (current) {
            this.cachedParentImportResults.checked(current, importName, importPath);
        }

        if (this._configOptions.verboseOutput) {
            const console = this.serviceProvider.console();
            localImportFailureInfo.forEach((diag) => console.log(diag));
        }

        return importResult;
    }

    protected fileExistsCached(uri: Uri): boolean {
        const directory = uri.getDirectory();
        if (directory.equals(uri)) {
            // Started at root, so this can't be a file.
            return false;
        }
        const fileName = uri.fileName;
        const entries = this.readdirEntriesCached(directory);
        const entry = entries.find((entry) => entry.name === fileName);
        if (entry?.isFile()) {
            return true;
        }

        if (entry?.isSymbolicLink()) {
            const realPath = tryRealpath(this.fileSystem, uri);
            if (realPath && this.fileSystem.existsSync(realPath) && isFile(this.fileSystem, realPath)) {
                return true;
            }
        }

        return false;
    }

    protected dirExistsCached(uri: Uri): boolean {
        const parent = uri.getDirectory();
        if (parent.equals(uri)) {
            // Started at root. No entries to read, so have to check ourselves.
            let cachedExistence = this._cachedDirExistenceForRoot.get(uri.key);
            // Check if the value was in the cache or not. Undefined means it wasn't.
            if (cachedExistence === undefined) {
                cachedExistence = tryStat(this.fileSystem, uri)?.isDirectory() ?? false;
                this._cachedDirExistenceForRoot.set(uri.key, cachedExistence);
            }
            return cachedExistence;
        }

        // Otherwise not a root, so read the entries we have cached to see if
        // the directory exists or not.
        const directoryName = uri.fileName;
        const entries = this.readdirEntriesCached(parent);
        const entry = entries.find((entry) => entry.name === directoryName);
        if (entry?.isDirectory()) {
            return true;
        }

        if (entry?.isSymbolicLink()) {
            const realPath = tryRealpath(this.fileSystem, uri);
            if (realPath && this.fileSystem.existsSync(realPath) && isDirectory(this.fileSystem, realPath)) {
                return true;
            }
        }

        return false;
    }

    protected addResultsToCache(
        sourceFileUri: Uri,
        execEnv: ExecutionEnvironment,
        importName: string,
        importResult: ImportResult,
        moduleDescriptor: ImportedModuleDescriptor | undefined,
        fromUserFile: boolean
    ) {
        // If the import is relative, include the source file path in the key.
        const relativeSourceFileUri = moduleDescriptor && moduleDescriptor.leadingDots > 0 ? sourceFileUri : undefined;

        getOrAdd(this._cachedImportResults, execEnv.root?.key, () => new Map<string, ImportResult>()).set(
            this._getImportCacheKey(relativeSourceFileUri, importName, fromUserFile),
            importResult
        );

        return this.filterImplicitImports(importResult, moduleDescriptor?.importedSymbols);
    }

    // Follows import resolution algorithm defined in PEP-420:
    // https://www.python.org/dev/peps/pep-0420/
    protected resolveAbsoluteImport(
        sourceFileUri: Uri | undefined,
        rootPath: Uri,
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

    // Intended to be overridden by subclasses to provide additional stub
    // resolving capabilities. Return undefined if no stubs were found for
    // this import.
    protected resolveImportEx(
        sourceFileUri: Uri,
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
        libraryFileUri: Uri,
        importName: string,
        importFailureInfo: string[] = []
    ): Uri | undefined {
        return undefined;
    }

    protected getNativeModuleName(uri: Uri): string | undefined {
        const fileExtension = uri.lastExtension.toLowerCase();
        if (_isNativeModuleFileExtension(fileExtension)) {
            return stripFileExtension(uri.fileName, /* multiDotExtension */ true);
        }
        return undefined;
    }

    // Potentially modifies the ImportResult by removing some or all of the
    // implicit import entries. Only the imported symbols should be included.
    protected filterImplicitImports(
        importResult: ImportResult,
        importedSymbols: Set<string> | undefined
    ): ImportResult {
        if (importedSymbols === undefined) {
            const newImportResult = Object.assign({}, importResult);
            newImportResult.filteredImplicitImports = new Map<string, ImplicitImport>();
            return newImportResult;
        }

        if (importedSymbols.size === 0) {
            return importResult;
        }

        if (importResult.implicitImports.size === 0) {
            return importResult;
        }

        const filteredImplicitImports = new Map<string, ImplicitImport>();
        importResult.implicitImports.forEach((implicitImport) => {
            if (importedSymbols.has(implicitImport.name)) {
                filteredImplicitImports.set(implicitImport.name, implicitImport);
            }
        });

        if (filteredImplicitImports.size === importResult.implicitImports.size) {
            return importResult;
        }

        const newImportResult = Object.assign({}, importResult);
        newImportResult.filteredImplicitImports = filteredImplicitImports;
        return newImportResult;
    }

    protected findImplicitImports(
        importingModuleName: string,
        dirPath: Uri,
        exclusions: Uri[]
    ): Map<string, ImplicitImport> {
        const implicitImportMap = new Map<string, ImplicitImport>();

        // Enumerate all of the files and directories in the path, expanding links.
        const entries = getFileSystemEntriesFromDirEntries(
            this.readdirEntriesCached(dirPath),
            this.fileSystem,
            dirPath
        );

        // Add implicit file-based modules.
        for (const filePath of entries.files) {
            const fileExt = filePath.lastExtension;
            let strippedFileName: string;
            let isNativeLib = false;

            if (fileExt === '.py' || fileExt === '.pyi') {
                strippedFileName = stripFileExtension(filePath.fileName);
            } else if (
                _isNativeModuleFileExtension(fileExt) &&
                !this.fileExistsCached(filePath.packageUri) &&
                !this.fileExistsCached(filePath.packageStubUri)
            ) {
                // Native module.
                strippedFileName = filePath.stripAllExtensions().fileName;
                isNativeLib = true;
            } else {
                continue;
            }

            if (!exclusions.find((exclusion) => exclusion.equals(filePath))) {
                const implicitImport: ImplicitImport = {
                    isStubFile: filePath.hasExtension('.pyi'),
                    isNativeLib,
                    name: strippedFileName,
                    uri: filePath,
                };

                // Always prefer stub files over non-stub files.
                const entry = implicitImportMap.get(implicitImport.name);
                if (!entry || !entry.isStubFile) {
                    // Try resolving resolving native lib to a custom stub.
                    if (isNativeLib) {
                        const nativeLibPath = filePath;
                        const nativeStubPath = this.resolveNativeImportEx(
                            nativeLibPath,
                            `${importingModuleName}.${strippedFileName}`,
                            []
                        );
                        if (nativeStubPath) {
                            implicitImport.uri = nativeStubPath;
                            implicitImport.isNativeLib = false;
                        }
                    }
                    implicitImportMap.set(implicitImport.name, implicitImport);
                }
            }
        }

        // Add implicit directory-based modules.
        for (const dirPath of entries.directories) {
            const pyFilePath = dirPath.initPyUri;
            const pyiFilePath = dirPath.initPyiUri;
            let isStubFile = false;
            let path: Uri | undefined;

            if (this.fileExistsCached(pyiFilePath)) {
                isStubFile = true;
                path = pyiFilePath;
            } else if (this.fileExistsCached(pyFilePath)) {
                path = pyFilePath;
            }

            if (path) {
                if (!exclusions.find((exclusion) => exclusion.equals(path))) {
                    const implicitImport: ImplicitImport = {
                        isStubFile,
                        isNativeLib: false,
                        name: dirPath.fileName,
                        uri: path,
                        pyTypedInfo: this._getPyTypedInfo(dirPath),
                    };

                    implicitImportMap.set(implicitImport.name, implicitImport);
                }
            }
        }

        return implicitImportMap;
    }

    private _resolveImportStrict(
        importName: string,
        sourceFileUri: Uri,
        execEnv: ExecutionEnvironment,
        moduleDescriptor: ImportedModuleDescriptor,
        importFailureInfo: string[]
    ) {
        const fromUserFile = matchFileSpecs(this._configOptions, sourceFileUri);
        const notFoundResult: ImportResult = {
            importName,
            isRelative: false,
            isImportFound: false,
            isPartlyResolved: false,
            isNamespacePackage: false,
            isInitFilePresent: false,
            isStubPackage: false,
            importFailureInfo,
            resolvedUris: [],
            importType: ImportType.Local,
            isStubFile: false,
            isNativeLib: false,
            implicitImports: new Map<string, ImplicitImport>(),
            filteredImplicitImports: new Map<string, ImplicitImport>(),
            nonStubImportResult: undefined,
        };

        this.ensurePartialStubPackages(execEnv);

        // Is it a relative import?
        if (moduleDescriptor.leadingDots > 0) {
            const cachedResults = this._lookUpResultsInCache(
                sourceFileUri,
                execEnv,
                importName,
                moduleDescriptor,
                fromUserFile
            );

            if (cachedResults) {
                return cachedResults;
            }

            const relativeImport = this._resolveRelativeImport(
                sourceFileUri,
                execEnv,
                moduleDescriptor,
                importName,
                importFailureInfo
            );

            if (relativeImport) {
                relativeImport.isRelative = true;

                return this.addResultsToCache(
                    sourceFileUri,
                    execEnv,
                    importName,
                    relativeImport,
                    moduleDescriptor,
                    fromUserFile
                );
            }
        } else {
            const cachedResults = this._lookUpResultsInCache(
                sourceFileUri,
                execEnv,
                importName,
                moduleDescriptor,
                fromUserFile
            );

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

            const bestImport = this._resolveBestAbsoluteImport(
                sourceFileUri,
                execEnv,
                moduleDescriptor,
                /* allowPyi */ true
            );

            if (bestImport) {
                if (bestImport.isStubFile) {
                    bestImport.nonStubImportResult =
                        this._resolveBestAbsoluteImport(
                            sourceFileUri,
                            execEnv,
                            moduleDescriptor,
                            /* allowPyi */ false
                        ) || notFoundResult;
                }

                return this.addResultsToCache(
                    sourceFileUri,
                    execEnv,
                    importName,
                    bestImport,
                    moduleDescriptor,
                    fromUserFile
                );
            }
        }

        return this.addResultsToCache(
            sourceFileUri,
            execEnv,
            importName,
            notFoundResult,
            /* moduleDescriptor */ undefined,
            fromUserFile
        );
    }

    private _getCompletionSuggestionsStrict(
        sourceFileUri: Uri,
        execEnv: ExecutionEnvironment,
        moduleDescriptor: ImportedModuleDescriptor
    ): Map<string, Uri> {
        const importFailureInfo: string[] = [];
        const suggestions = new Map<string, Uri>();

        // Is it a relative import?
        if (moduleDescriptor.leadingDots > 0) {
            this._getCompletionSuggestionsRelative(sourceFileUri, execEnv, moduleDescriptor, suggestions);
        } else {
            // First check for a typeshed file.
            if (moduleDescriptor.nameParts.length > 0) {
                this._getCompletionSuggestionsTypeshedPath(sourceFileUri, execEnv, moduleDescriptor, true, suggestions);
            }

            // Look for it in the root directory of the execution environment.
            if (execEnv.root) {
                this._getCompletionSuggestionsAbsolute(
                    sourceFileUri,
                    execEnv,
                    execEnv.root,
                    moduleDescriptor,
                    suggestions
                );
            }

            for (const extraPath of execEnv.extraPaths) {
                this._getCompletionSuggestionsAbsolute(
                    sourceFileUri,
                    execEnv,
                    extraPath,
                    moduleDescriptor,
                    suggestions
                );
            }

            // Check for a typings file.
            if (this._configOptions.stubPath) {
                this._getCompletionSuggestionsAbsolute(
                    sourceFileUri,
                    execEnv,
                    this._configOptions.stubPath,
                    moduleDescriptor,
                    suggestions
                );
            }

            // Check for a typeshed file.
            this._getCompletionSuggestionsTypeshedPath(sourceFileUri, execEnv, moduleDescriptor, false, suggestions);

            // Look for the import in the list of third-party packages.
            const pythonSearchPaths = this.getPythonSearchPaths(importFailureInfo);
            for (const searchPath of pythonSearchPaths) {
                this._getCompletionSuggestionsAbsolute(
                    sourceFileUri,
                    execEnv,
                    searchPath,
                    moduleDescriptor,
                    suggestions
                );
            }
        }

        return suggestions;
    }

    private _getModuleNameForImport(
        fileUri: Uri,
        execEnv: ExecutionEnvironment,
        allowInvalidModuleName: boolean,
        detectPyTyped: boolean
    ): ModuleImportInfo {
        let moduleName: string | undefined;
        let importType = ImportType.BuiltIn;
        let isLocalTypingsFile = false;
        let isThirdPartyPyTypedPresent = false;
        let isTypeshedFile = false;

        const importFailureInfo: string[] = [];

        // If we cannot find a fully-qualified module name with legal characters,
        // look for one with invalid characters (e.g. "-"). This is important to
        // differentiate between different modules in a project in case they
        // declare types with the same (local) name.
        let moduleNameWithInvalidCharacters: string | undefined;

        // Is this a stdlib typeshed path?
        const stdLibTypeshedPath = this._getStdlibTypeshedPath(
            this._configOptions.typeshedPath,
            execEnv.pythonVersion,
            execEnv.pythonPlatform,
            importFailureInfo
        );

        if (stdLibTypeshedPath) {
            moduleName = getModuleNameFromPath(stdLibTypeshedPath, fileUri);
            if (moduleName) {
                const moduleDescriptor: ImportedModuleDescriptor = {
                    leadingDots: 0,
                    nameParts: moduleName.split('.'),
                    importedSymbols: undefined,
                };

                if (
                    this._isStdlibTypeshedStubValidForVersion(
                        moduleDescriptor,
                        this._configOptions.typeshedPath,
                        execEnv.pythonVersion,
                        execEnv.pythonPlatform,
                        []
                    )
                ) {
                    return {
                        moduleName,
                        importType,
                        isTypeshedFile: true,
                        isLocalTypingsFile,
                        isThirdPartyPyTypedPresent,
                    };
                }
            }
        }

        // Look for it in the root directory of the execution environment.
        if (execEnv.root) {
            const candidateModuleNameInfo = _getModuleNameInfoFromPath(execEnv.root, fileUri);

            if (candidateModuleNameInfo) {
                if (candidateModuleNameInfo.containsInvalidCharacters) {
                    moduleNameWithInvalidCharacters = candidateModuleNameInfo.moduleName;
                } else {
                    moduleName = candidateModuleNameInfo.moduleName;
                }
            }

            importType = ImportType.Local;
        }

        for (const extraPath of execEnv.extraPaths) {
            const candidateModuleNameInfo = _getModuleNameInfoFromPath(extraPath, fileUri);

            if (candidateModuleNameInfo) {
                if (candidateModuleNameInfo.containsInvalidCharacters) {
                    moduleNameWithInvalidCharacters = candidateModuleNameInfo.moduleName;
                } else {
                    // Does this candidate look better than the previous best module name?
                    // We'll always try to use the shortest version.
                    const candidateModuleName = candidateModuleNameInfo.moduleName;
                    if (!moduleName || (candidateModuleName && candidateModuleName.length < moduleName.length)) {
                        moduleName = candidateModuleName;
                        importType = ImportType.Local;
                    }
                }
            }
        }

        // Check for a typings file.
        if (this._configOptions.stubPath) {
            const candidateModuleNameInfo = _getModuleNameInfoFromPath(this._configOptions.stubPath, fileUri);

            if (candidateModuleNameInfo) {
                if (candidateModuleNameInfo.containsInvalidCharacters) {
                    moduleNameWithInvalidCharacters = candidateModuleNameInfo.moduleName;
                } else {
                    // Does this candidate look better than the previous best module name?
                    // We'll always try to use the shortest version.
                    const candidateModuleName = candidateModuleNameInfo.moduleName;
                    if (!moduleName || (candidateModuleName && candidateModuleName.length < moduleName.length)) {
                        moduleName = candidateModuleName;

                        // Treat the typings path as a local import so errors are reported for it.
                        importType = ImportType.Local;
                        isLocalTypingsFile = true;
                    }
                }
            }
        }

        // Check for a typeshed file.
        const thirdPartyTypeshedPath = this._getThirdPartyTypeshedPath(
            this._configOptions.typeshedPath,
            importFailureInfo
        );

        if (thirdPartyTypeshedPath) {
            const candidateModuleName = getModuleNameFromPath(
                thirdPartyTypeshedPath,
                fileUri,
                /* stripTopContainerDir */ true
            );

            // Does this candidate look better than the previous best module name?
            // We'll always try to use the shortest version.
            if (!moduleName || (candidateModuleName && candidateModuleName.length < moduleName.length)) {
                moduleName = candidateModuleName;
                importType = ImportType.ThirdParty;
                isTypeshedFile = true;
            }
        }

        const thirdPartyTypeshedPathEx = this.getTypeshedPathEx(execEnv, importFailureInfo);
        if (thirdPartyTypeshedPathEx) {
            const candidateModuleName = getModuleNameFromPath(thirdPartyTypeshedPathEx, fileUri);

            // Does this candidate look better than the previous best module name?
            // We'll always try to use the shortest version.
            if (!moduleName || (candidateModuleName && candidateModuleName.length < moduleName.length)) {
                moduleName = candidateModuleName;
                importType = ImportType.ThirdParty;
                isTypeshedFile = true;
            }
        }

        // Look for the import in the list of third-party packages.
        const pythonSearchPaths = this.getPythonSearchPaths(importFailureInfo);

        for (const searchPath of pythonSearchPaths) {
            const candidateModuleNameInfo = _getModuleNameInfoFromPath(searchPath, fileUri);

            if (candidateModuleNameInfo) {
                if (candidateModuleNameInfo.containsInvalidCharacters) {
                    moduleNameWithInvalidCharacters = candidateModuleNameInfo.moduleName;
                } else {
                    // Does this candidate look better than the previous best module name?
                    // We'll always try to use the shortest version.
                    const candidateModuleName = candidateModuleNameInfo.moduleName;
                    if (!moduleName || (candidateModuleName && candidateModuleName.length < moduleName.length)) {
                        moduleName = candidateModuleName;
                        importType = ImportType.ThirdParty;
                        isTypeshedFile = false;
                    }
                }
            }
        }

        if (detectPyTyped && importType === ImportType.ThirdParty) {
            const root = getParentImportResolutionRoot(fileUri, execEnv.root);

            // Go up directories one by one looking for a py.typed file.
            let current: Uri | undefined = fileUri.getDirectory();
            while (this._shouldWalkUp(current, root, execEnv)) {
                const pyTypedInfo = this._getPyTypedInfo(current!);
                if (pyTypedInfo) {
                    if (!pyTypedInfo.isPartiallyTyped) {
                        isThirdPartyPyTypedPresent = true;
                    }
                    break;
                }

                current = this._tryWalkUp(current);
            }
        }

        if (moduleName) {
            return { moduleName, importType, isTypeshedFile, isLocalTypingsFile, isThirdPartyPyTypedPresent };
        }

        if (allowInvalidModuleName && moduleNameWithInvalidCharacters) {
            return {
                moduleName: moduleNameWithInvalidCharacters,
                isTypeshedFile,
                importType,
                isLocalTypingsFile,
                isThirdPartyPyTypedPresent,
            };
        }

        // We didn't find any module name.
        return {
            moduleName: '',
            isTypeshedFile,
            importType: ImportType.Local,
            isLocalTypingsFile,
            isThirdPartyPyTypedPresent,
        };
    }

    private _invalidateFileSystemCache() {
        this._cachedEntriesForPath.clear();
        this._cachedFilesForPath.clear();
        this._cachedDirExistenceForRoot.clear();
    }

    private _resolveAbsoluteImport(
        rootPath: Uri,
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
        const resolvedPaths: Uri[] = [];
        let dirPath = rootPath;
        let isNamespacePackage = false;
        let isInitFilePresent = false;
        let isStubPackage = false;
        let isStubFile = false;
        let isNativeLib = false;
        let implicitImports = new Map<string, ImplicitImport>();
        let packageDirectory: Uri | undefined;
        let pyTypedInfo: PyTypedInfo | undefined;

        // Handle the "from . import XXX" case.
        if (moduleDescriptor.nameParts.length === 0) {
            const pyFilePath = dirPath.initPyUri;
            const pyiFilePath = dirPath.initPyiUri;

            if (allowPyi && this.fileExistsCached(pyiFilePath)) {
                importFailureInfo.push(`Resolved import with file '${pyiFilePath}'`);
                resolvedPaths.push(pyiFilePath);
                isStubFile = true;
            } else if (this.fileExistsCached(pyFilePath)) {
                importFailureInfo.push(`Resolved import with file '${pyFilePath}'`);
                resolvedPaths.push(pyFilePath);
            } else {
                importFailureInfo.push(`Partially resolved import with directory '${dirPath}'`);
                resolvedPaths.push(Uri.empty());
                isNamespacePackage = true;
            }

            implicitImports = this.findImplicitImports(importName, dirPath, [pyFilePath, pyiFilePath]);
        } else {
            for (let i = 0; i < moduleDescriptor.nameParts.length; i++) {
                const isFirstPart = i === 0;
                const isLastPart = i === moduleDescriptor.nameParts.length - 1;
                dirPath = dirPath.combinePaths(moduleDescriptor.nameParts[i]);

                if (useStubPackage && isFirstPart) {
                    dirPath = dirPath.addPath(stubsSuffix);
                    isStubPackage = true;
                }

                const foundDirectory = this.dirExistsCached(dirPath);

                if (foundDirectory) {
                    if (isFirstPart) {
                        packageDirectory = dirPath;
                    }

                    // See if we can find an __init__.py[i] in this directory.
                    const pyFilePath = dirPath.initPyUri;
                    const pyiFilePath = dirPath.initPyiUri;
                    isInitFilePresent = false;

                    if (allowPyi && this.fileExistsCached(pyiFilePath)) {
                        importFailureInfo.push(`Resolved import with file '${pyiFilePath}'`);
                        resolvedPaths.push(pyiFilePath);
                        if (isLastPart) {
                            isStubFile = true;
                        }
                        isInitFilePresent = true;
                    } else if (this.fileExistsCached(pyFilePath)) {
                        importFailureInfo.push(`Resolved import with file '${pyFilePath}'`);
                        resolvedPaths.push(pyFilePath);
                        isInitFilePresent = true;
                    }

                    if (!pyTypedInfo && lookForPyTyped) {
                        pyTypedInfo = this._getPyTypedInfo(dirPath);
                    }

                    if (isInitFilePresent) {
                        if (!isLastPart) {
                            // We are not at the last part, and we found a directory,
                            // so continue to look for the next part.
                            continue;
                        }

                        implicitImports = this.findImplicitImports(moduleDescriptor.nameParts.join('.'), dirPath, [
                            pyFilePath,
                            pyiFilePath,
                        ]);
                        break;
                    }
                }

                // We weren't able to find a directory or we found a directory with
                // no __init__.py[i] file. See if we can find a ".py" or ".pyi" file
                // with this name.
                const pyFilePath = dirPath.packageUri;
                const pyiFilePath = dirPath.packageStubUri;
                const fileDirectory = dirPath.getDirectory();

                if (allowPyi && this.fileExistsCached(pyiFilePath)) {
                    importFailureInfo.push(`Resolved import with file '${pyiFilePath}'`);
                    resolvedPaths.push(pyiFilePath);
                    if (isLastPart) {
                        isStubFile = true;
                    }
                } else if (this.fileExistsCached(pyFilePath)) {
                    importFailureInfo.push(`Resolved import with file '${pyFilePath}'`);
                    resolvedPaths.push(pyFilePath);
                } else if (
                    allowNativeLib &&
                    this._findAndResolveNativeModule(
                        fileDirectory,
                        dirPath,
                        execEnv,
                        importName,
                        moduleDescriptor,
                        importFailureInfo,
                        resolvedPaths
                    )
                ) {
                    isNativeLib = true;
                    importFailureInfo.push(`Did not find file '${pyiFilePath}' or '${pyFilePath}'`);
                } else if (foundDirectory) {
                    if (!isLastPart) {
                        // We are not at the last part, and we found a directory,
                        // so continue to look for the next part assuming this is
                        // a namespace package.
                        resolvedPaths.push(Uri.empty());
                        isNamespacePackage = true;
                        pyTypedInfo = undefined;
                        continue;
                    }

                    importFailureInfo.push(`Partially resolved import with directory '${dirPath}'`);
                    resolvedPaths.push(Uri.empty());

                    if (isLastPart) {
                        implicitImports = this.findImplicitImports(importName, dirPath, [pyFilePath, pyiFilePath]);
                        isNamespacePackage = true;
                    }
                }

                if (!pyTypedInfo && lookForPyTyped) {
                    pyTypedInfo = this._getPyTypedInfo(fileDirectory);
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
            isInitFilePresent,
            isStubPackage,
            isImportFound: importFound,
            isPartlyResolved,
            importFailureInfo,
            importType: ImportType.Local,
            resolvedUris: resolvedPaths,
            searchPath: rootPath,
            isStubFile,
            isNativeLib,
            implicitImports,
            pyTypedInfo,
            filteredImplicitImports: implicitImports,
            packageDirectory,
        };
    }

    private _getImportCacheKey(sourceFileUri: Uri | undefined, importName: string, fromUserFile: boolean) {
        return `${sourceFileUri?.key ?? ''}-${importName}-${fromUserFile}`;
    }

    private _lookUpResultsInCache(
        sourceFileUri: Uri,
        execEnv: ExecutionEnvironment,
        importName: string,
        moduleDescriptor: ImportedModuleDescriptor,
        fromUserFile: boolean
    ) {
        const cacheForExecEnv = this._cachedImportResults.get(execEnv.root?.key ?? '');
        if (!cacheForExecEnv) {
            return undefined;
        }

        // If the import is relative, include the source file path in the key.
        const relativeSourceFileUri = moduleDescriptor.leadingDots > 0 ? sourceFileUri : undefined;

        const cachedEntry = cacheForExecEnv.get(
            this._getImportCacheKey(relativeSourceFileUri, importName, fromUserFile)
        );

        if (!cachedEntry) {
            return undefined;
        }

        return this.filterImplicitImports(cachedEntry, moduleDescriptor.importedSymbols);
    }

    // Determines whether a namespace package resolves all of the symbols
    // requested in the module descriptor. Namespace packages have no "__init__.py"
    // file, so the only way that symbols can be resolved is if submodules
    // are present. If specific symbols were requested, make sure they
    // are all satisfied by submodules (as listed in the implicit imports).
    private _isNamespacePackageResolved(
        moduleDescriptor: ImportedModuleDescriptor,
        implicitImports: Map<string, ImplicitImport>
    ) {
        if (moduleDescriptor.importedSymbols) {
            if (!Array.from(moduleDescriptor.importedSymbols.keys()).some((symbol) => implicitImports.has(symbol))) {
                return false;
            }
        } else if (implicitImports.size === 0) {
            return false;
        }
        return true;
    }

    private _resolveBestAbsoluteImport(
        sourceFileUri: Uri,
        execEnv: ExecutionEnvironment,
        moduleDescriptor: ImportedModuleDescriptor,
        allowPyi: boolean
    ): ImportResult | undefined {
        const importName = formatImportName(moduleDescriptor);
        const importFailureInfo: string[] = [];

        // Check for a local stub file using stubPath.
        if (allowPyi && this._configOptions.stubPath) {
            importFailureInfo.push(`Looking in stubPath '${this._configOptions.stubPath}'`);
            const typingsImport = this.resolveAbsoluteImport(
                sourceFileUri,
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

                // If it's a namespace package that didn't resolve to a file, make sure that
                // the imported symbols are present in the implicit imports. If not, we'll
                // skip the typings import and continue searching.
                if (
                    typingsImport.isNamespacePackage &&
                    typingsImport.resolvedUris[typingsImport.resolvedUris.length - 1].isEmpty()
                ) {
                    if (this._isNamespacePackageResolved(moduleDescriptor, typingsImport.implicitImports)) {
                        return typingsImport;
                    }
                } else {
                    return typingsImport;
                }
            }
        }

        let bestResultSoFar: ImportResult | undefined;
        let localImport: ImportResult | undefined;

        // Look for it in the root directory of the execution environment.
        if (execEnv.root) {
            importFailureInfo.push(`Looking in root directory of execution environment ` + `'${execEnv.root}'`);

            localImport = this.resolveAbsoluteImport(
                sourceFileUri,
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
                sourceFileUri,
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

        // Check for a stdlib typeshed file.
        if (allowPyi && moduleDescriptor.nameParts.length > 0) {
            importFailureInfo.push(`Looking for typeshed stdlib path`);
            const typeshedStdlibImport = this._findTypeshedPath(
                execEnv,
                moduleDescriptor,
                importName,
                /* isStdLib */ true,
                importFailureInfo
            );

            if (typeshedStdlibImport) {
                typeshedStdlibImport.isStdlibTypeshedFile = true;
                return typeshedStdlibImport;
            }
        }

        // Look for the import in the list of third-party packages.
        const pythonSearchPaths = this.getPythonSearchPaths(importFailureInfo);
        if (pythonSearchPaths.length > 0) {
            for (const searchPath of pythonSearchPaths) {
                importFailureInfo.push(`Looking in python search path '${searchPath}'`);

                const thirdPartyImport = this.resolveAbsoluteImport(
                    sourceFileUri,
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

                    bestResultSoFar = this._pickBestImport(bestResultSoFar, thirdPartyImport, moduleDescriptor);
                }
            }
        } else {
            importFailureInfo.push('No python interpreter search path');
        }

        // If a library is fully py.typed, then we have found the best match,
        // unless the execution environment is typeshed itself, in which case
        // we don't want to favor py.typed libraries. Use the typeshed lookup below.
        if (execEnv.root !== this._getTypeshedRoot(this._configOptions.typeshedPath, importFailureInfo)) {
            if (bestResultSoFar?.pyTypedInfo && !bestResultSoFar.isPartlyResolved) {
                return bestResultSoFar;
            }
        }

        // Call the extensibility hook for subclasses.
        const extraResults = this.resolveImportEx(
            sourceFileUri,
            execEnv,
            moduleDescriptor,
            importName,
            importFailureInfo,
            allowPyi
        );

        if (extraResults) {
            return extraResults;
        }

        // Check for a third-party typeshed file.
        if (allowPyi && moduleDescriptor.nameParts.length > 0) {
            importFailureInfo.push(`Looking for typeshed third-party path`);
            const typeshedImport = this._findTypeshedPath(
                execEnv,
                moduleDescriptor,
                importName,
                /* isStdLib */ false,
                importFailureInfo
            );

            if (typeshedImport) {
                typeshedImport.isThirdPartyTypeshedFile = true;
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
            // Prefer traditional packages over namespace packages.
            const soFarIndex = bestImportSoFar.resolvedUris.findIndex((path) => !path.isEmpty());
            const newIndex = newImport.resolvedUris.findIndex((path) => !path.isEmpty());
            if (soFarIndex !== newIndex) {
                if (soFarIndex < 0) {
                    return newImport;
                } else if (newIndex < 0) {
                    return bestImportSoFar;
                }
                return soFarIndex < newIndex ? bestImportSoFar : newImport;
            }

            // Prefer found over not found.
            if (!bestImportSoFar.isImportFound) {
                return newImport;
            }

            // If both are namespace imports, select the one that resolves the symbols.
            if (bestImportSoFar.isNamespacePackage && newImport.isNamespacePackage) {
                if (moduleDescriptor.importedSymbols) {
                    if (!this._isNamespacePackageResolved(moduleDescriptor, bestImportSoFar.implicitImports)) {
                        if (this._isNamespacePackageResolved(moduleDescriptor, newImport.implicitImports)) {
                            return newImport;
                        }

                        // Prefer the namespace package that has an __init__.py(i) file present
                        // in the final directory over one that does not.
                        if (bestImportSoFar.isInitFilePresent && !newImport.isInitFilePresent) {
                            return bestImportSoFar;
                        } else if (!bestImportSoFar.isInitFilePresent && newImport.isInitFilePresent) {
                            return newImport;
                        }
                    }
                }
            }

            // Prefer local over third-party. We check local first, so we should never
            // see the reverse.
            if (bestImportSoFar.importType === ImportType.Local && newImport.importType === ImportType.ThirdParty) {
                return bestImportSoFar;
            }

            // Prefer py.typed over non-py.typed.
            if (bestImportSoFar.pyTypedInfo && !newImport.pyTypedInfo) {
                return bestImportSoFar;
            } else if (!bestImportSoFar.pyTypedInfo && newImport.pyTypedInfo) {
                if (bestImportSoFar.importType === newImport.importType) {
                    return newImport;
                }
            }

            // Prefer pyi over py.
            if (bestImportSoFar.isStubFile && !newImport.isStubFile) {
                return bestImportSoFar;
            } else if (!bestImportSoFar.isStubFile && newImport.isStubFile) {
                return newImport;
            }

            // All else equal, prefer shorter resolution paths.
            if (bestImportSoFar.resolvedUris.length > newImport.resolvedUris.length) {
                return newImport;
            }
        } else if (newImport.isPartlyResolved) {
            // If the new import is a traditional package but only partly resolves
            // the import but the best import so far is a namespace package, we need
            // to consider whether the best import so far also resolves the first part
            // of the import with a traditional package. Using the example "import a.b.c.d"
            // and the symbol ~ to represent a namespace package, consider the following
            // cases:
            //  bestSoFar: a/~b/~c/~d   new: a      Result: bestSoFar wins
            //  bestSoFar: ~a/~b/~c/~d  new: a      Result: new wins
            //  bestSoFar: a/~b/~c/~d   new: a/b    Result: new wins
            const soFarIndex = bestImportSoFar.resolvedUris.findIndex((path) => !path.isEmpty());
            const newIndex = newImport.resolvedUris.findIndex((path) => !path.isEmpty());

            if (soFarIndex !== newIndex) {
                if (soFarIndex < 0) {
                    return newImport;
                } else if (newIndex < 0) {
                    return bestImportSoFar;
                }
                return soFarIndex < newIndex ? bestImportSoFar : newImport;
            }
        }

        return bestImportSoFar;
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

        let typeshedPaths: Uri[] | undefined;
        if (isStdLib) {
            const path = this._getStdlibTypeshedPath(
                this._configOptions.typeshedPath,
                execEnv.pythonVersion,
                execEnv.pythonPlatform,
                importFailureInfo,
                moduleDescriptor
            );

            if (path) {
                typeshedPaths = [path];
            }
        } else {
            typeshedPaths = this._getThirdPartyTypeshedPackagePaths(moduleDescriptor, importFailureInfo);
        }

        if (typeshedPaths) {
            for (const typeshedPath of typeshedPaths) {
                if (this.dirExistsCached(typeshedPath)) {
                    const importInfo = this.resolveAbsoluteImport(
                        undefined,
                        typeshedPath,
                        execEnv,
                        moduleDescriptor,
                        importName,
                        importFailureInfo
                    );

                    if (importInfo.isImportFound) {
                        let importType = isStdLib ? ImportType.BuiltIn : ImportType.ThirdParty;

                        // Handle 'typing_extensions' as a special case because it's
                        // part of stdlib typeshed stubs, but it's not part of stdlib.
                        if (importName === 'typing_extensions') {
                            importType = ImportType.ThirdParty;
                        }

                        importInfo.importType = importType;
                        return importInfo;
                    }
                }
            }
        }

        importFailureInfo.push(`Typeshed path not found`);
        return undefined;
    }

    // Finds all of the stdlib modules and returns a Set containing all of their names.
    private _buildStdlibCache(stdlibRoot: Uri | undefined, executionEnvironment: ExecutionEnvironment): Set<string> {
        const cache = new Set<string>();

        if (stdlibRoot) {
            const readDir = (root: Uri, prefix: string | undefined) => {
                this.readdirEntriesCached(root).forEach((entry) => {
                    if (entry.isDirectory()) {
                        const dirRoot = root.combinePaths(entry.name);
                        readDir(dirRoot, prefix ? `${prefix}.${entry.name}` : entry.name);
                    } else if (entry.name.includes('.py')) {
                        const stripped = stripFileExtension(entry.name);
                        // Skip anything starting with an underscore.
                        if (!stripped.startsWith('_')) {
                            if (
                                this._isStdlibTypeshedStubValidForVersion(
                                    createImportedModuleDescriptor(stripped),
                                    root,
                                    executionEnvironment.pythonVersion,
                                    executionEnvironment.pythonPlatform,
                                    []
                                )
                            ) {
                                cache.add(prefix ? `${prefix}.${stripped}` : stripped);
                            }
                        }
                    }
                });
            };
            readDir(stdlibRoot, undefined);
        }

        return cache;
    }

    // Populates a cache of third-party packages found within the typeshed
    // directory. They are organized such that top-level directories contain
    // the pypi-registered name of the package and an inner directory contains
    // the name of the package as it is referenced by import statements. These
    // don't always match.
    private _buildTypeshedThirdPartyPackageMap(thirdPartyDir: Uri | undefined) {
        this._cachedTypeshedThirdPartyPackagePaths = new Map<string, Uri[]>();

        if (thirdPartyDir) {
            this.readdirEntriesCached(thirdPartyDir).forEach((outerEntry) => {
                if (outerEntry.isDirectory()) {
                    const innerDirPath = thirdPartyDir.combinePaths(outerEntry.name);

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

        const flattenPaths = Array.from(this._cachedTypeshedThirdPartyPackagePaths.values()).flatMap((v) => v);
        this._cachedTypeshedThirdPartyPackageRoots = Array.from(new Set(flattenPaths)).sort();
    }

    private _getCompletionSuggestionsTypeshedPath(
        sourceFileUri: Uri,
        execEnv: ExecutionEnvironment,
        moduleDescriptor: ImportedModuleDescriptor,
        isStdLib: boolean,
        suggestions: Map<string, Uri>
    ) {
        const importFailureInfo: string[] = [];

        let typeshedPaths: Uri[] | undefined;
        if (isStdLib) {
            const path = this._getStdlibTypeshedPath(
                this._configOptions.typeshedPath,
                execEnv.pythonVersion,
                execEnv.pythonPlatform,
                importFailureInfo,
                moduleDescriptor
            );
            if (path) {
                typeshedPaths = [path];
            }
        } else {
            typeshedPaths = this._getThirdPartyTypeshedPackagePaths(
                moduleDescriptor,
                importFailureInfo,
                /* includeMatchOnly */ false
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
                    sourceFileUri,
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
        customTypeshedPath: Uri | undefined,
        pythonVersion: PythonVersion,
        pythonPlatform: string | undefined,
        importFailureInfo: string[],
        moduleDescriptor?: ImportedModuleDescriptor
    ) {
        const subdirectory = this._getTypeshedSubdirectory(/* isStdLib */ true, customTypeshedPath, importFailureInfo);
        if (
            subdirectory &&
            moduleDescriptor &&
            !this._isStdlibTypeshedStubValidForVersion(
                moduleDescriptor,
                customTypeshedPath,
                pythonVersion,
                pythonPlatform,
                importFailureInfo
            )
        ) {
            return undefined;
        }

        return subdirectory;
    }

    private _getThirdPartyTypeshedPath(customTypeshedPath: Uri | undefined, importFailureInfo: string[]) {
        return this._getTypeshedSubdirectory(/* isStdLib */ false, customTypeshedPath, importFailureInfo);
    }

    private _isStdlibTypeshedStubValidForVersion(
        moduleDescriptor: ImportedModuleDescriptor,
        customTypeshedPath: Uri | undefined,
        pythonVersion: PythonVersion,
        pythonPlatform: string | undefined,
        importFailureInfo: string[]
    ) {
        if (!this._cachedTypeshedStdLibModuleVersionInfo) {
            this._cachedTypeshedStdLibModuleVersionInfo = this._readTypeshedStdLibVersions(
                customTypeshedPath,
                importFailureInfo
            );
        }

        // Loop through the name parts to make sure the module and submodules
        // referenced in the import statement are valid for this version of Python.
        for (let namePartCount = 1; namePartCount <= moduleDescriptor.nameParts.length; namePartCount++) {
            const namePartsToConsider = moduleDescriptor.nameParts.slice(0, namePartCount);
            const versionInfo = this._cachedTypeshedStdLibModuleVersionInfo.get(namePartsToConsider.join('.'));

            if (versionInfo) {
                if (PythonVersion.isLessThan(pythonVersion, versionInfo.min)) {
                    return false;
                }

                if (versionInfo.max !== undefined && PythonVersion.isGreaterThan(pythonVersion, versionInfo.max)) {
                    return false;
                }

                if (pythonPlatform !== undefined) {
                    const pythonPlatformLower = pythonPlatform.toLowerCase();

                    if (versionInfo.supportedPlatforms) {
                        if (versionInfo.supportedPlatforms.every((p) => p.toLowerCase() !== pythonPlatformLower)) {
                            return false;
                        }
                    }

                    if (versionInfo.unsupportedPlatforms) {
                        if (versionInfo.unsupportedPlatforms.some((p) => p.toLowerCase() === pythonPlatformLower)) {
                            return false;
                        }
                    }
                }
            }
        }

        return true;
    }

    private _readTypeshedStdLibVersions(
        customTypeshedPath: Uri | undefined,
        importFailureInfo: string[]
    ): Map<string, SupportedVersionInfo> {
        const versionRangeMap = new Map<string, SupportedVersionInfo>();

        // Read the VERSIONS file from typeshed.
        const typeshedStdLibPath = this._getTypeshedSubdirectory(
            /* isStdLib */ true,
            customTypeshedPath,
            importFailureInfo
        );

        if (typeshedStdLibPath) {
            const versionsFilePath = typeshedStdLibPath.combinePaths('VERSIONS');
            try {
                const fileStats = this.fileSystem.statSync(versionsFilePath);
                if (fileStats.size > 0 && fileStats.size < 256 * 1024) {
                    const fileContents = this.fileSystem.readFileSync(versionsFilePath, 'utf8');
                    fileContents.split(/\r?\n/).forEach((line) => {
                        const commentSplit = line.split('#');

                        // Platform-specific information can be specified after a semicolon.
                        const semicolonSplit = commentSplit[0].split(';').map((s) => s.trim());

                        // Version information is found after a colon.
                        const colonSplit = semicolonSplit[0].split(':');
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
                        let minVersion = PythonVersion.fromString(minVersionString);
                        if (!minVersion) {
                            minVersion = pythonVersion3_0;
                        }

                        let maxVersion: PythonVersion | undefined;
                        if (versionSplit.length > 1) {
                            maxVersion = PythonVersion.fromString(versionSplit[1].trim());
                        }

                        // A semicolon can be followed by a semicolon-delimited list of other
                        // exclusions. The "platform" exclusion is a comma delimited list platforms
                        // that are supported or not supported.
                        let supportedPlatforms: string[] | undefined;
                        let unsupportedPlatforms: string[] | undefined;
                        const platformsHeader = 'platforms=';
                        let platformExclusions = semicolonSplit.slice(1).find((s) => s.startsWith(platformsHeader));

                        if (platformExclusions) {
                            platformExclusions = platformExclusions.trim().substring(platformsHeader.length);
                            const commaSplit = platformExclusions.split(',');
                            for (let platform of commaSplit) {
                                platform = platform.trim();
                                let isUnsupported = false;

                                // Remove the '!' from the start if it's an exclusion.
                                if (platform.startsWith('!')) {
                                    isUnsupported = true;
                                    platform = platform.substring(1);
                                }

                                if (isUnsupported) {
                                    unsupportedPlatforms = unsupportedPlatforms ?? [];
                                    unsupportedPlatforms.push(platform);
                                } else {
                                    supportedPlatforms = supportedPlatforms ?? [];
                                    supportedPlatforms.push(platform);
                                }
                            }
                        }

                        versionRangeMap.set(moduleName, {
                            min: minVersion,
                            max: maxVersion,
                            supportedPlatforms,
                            unsupportedPlatforms,
                        });
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
        importFailureInfo: string[],
        includeMatchOnly = true
    ): Uri[] | undefined {
        const typeshedPath = this._getThirdPartyTypeshedPath(this._configOptions.typeshedPath, importFailureInfo);

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

    private _getThirdPartyTypeshedPackageRoots(importFailureInfo: string[]) {
        const typeshedPath = this._getThirdPartyTypeshedPath(this._configOptions.typeshedPath, importFailureInfo);

        if (!this._cachedTypeshedThirdPartyPackagePaths) {
            this._buildTypeshedThirdPartyPackageMap(typeshedPath);
        }

        return this._cachedTypeshedThirdPartyPackageRoots!;
    }

    private _getTypeshedRoot(customTypeshedPath: Uri | undefined, importFailureInfo: string[]) {
        if (this._cachedTypeshedRoot === undefined) {
            let typeshedPath = undefined;

            // Did the user specify a typeshed path? If not, we'll look in the
            // python search paths, then in the typeshed-fallback directory.
            if (customTypeshedPath) {
                if (this.dirExistsCached(customTypeshedPath)) {
                    typeshedPath = customTypeshedPath;
                }
            }

            // If typeshed directory wasn't found in other locations, use the fallback.
            if (!typeshedPath) {
                typeshedPath = PythonPathUtils.getTypeShedFallbackPath(this.fileSystem) ?? Uri.empty();
            }

            this._cachedTypeshedRoot = typeshedPath;
        }

        return this._cachedTypeshedRoot.isEmpty() ? undefined : this._cachedTypeshedRoot;
    }

    private _getTypeshedSubdirectory(
        isStdLib: boolean,
        customTypeshedPath: Uri | undefined,
        importFailureInfo: string[]
    ) {
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

        let typeshedPath = this._getTypeshedRoot(customTypeshedPath, importFailureInfo);
        if (typeshedPath === undefined) {
            return undefined;
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
        sourceFileUri: Uri,
        execEnv: ExecutionEnvironment,
        moduleDescriptor: ImportedModuleDescriptor,
        importName: string,
        importFailureInfo: string[]
    ): ImportResult | undefined {
        importFailureInfo.push('Attempting to resolve relative import');

        // Determine which search path this file is part of.
        const directory = getDirectoryLeadingDotsPointsTo(sourceFileUri.getDirectory(), moduleDescriptor.leadingDots);
        if (!directory) {
            importFailureInfo.push(`Invalid relative path '${importName}'`);
            return undefined;
        }

        // Now try to match the module parts from the current directory location.
        const absImport = this.resolveAbsoluteImport(
            sourceFileUri,
            directory,
            execEnv,
            moduleDescriptor,
            importName,
            importFailureInfo,
            /* allowPartial */ false,
            /* allowNativeLib */ true
        );

        if (absImport && absImport.isStubFile) {
            // If we found a stub for a relative import, only search
            // the same folder for the real module. Otherwise, it will
            // error out on runtime.
            absImport.nonStubImportResult = this.resolveAbsoluteImport(
                sourceFileUri,
                directory,
                execEnv,
                moduleDescriptor,
                importName,
                importFailureInfo,
                /* allowPartial */ false,
                /* allowNativeLib */ true,
                /* useStubPackage */ false,
                /* allowPyi */ false
            ) || {
                importName,
                isRelative: true,
                isImportFound: false,
                isPartlyResolved: false,
                isNamespacePackage: false,
                isStubPackage: false,
                importFailureInfo,
                resolvedUris: [],
                importType: ImportType.Local,
                isStubFile: false,
                isNativeLib: false,
                implicitImports: [],
                filteredImplicitImports: [],
                nonStubImportResult: undefined,
            };
        }

        return absImport;
    }

    private _getCompletionSuggestionsRelative(
        sourceFileUri: Uri,
        execEnv: ExecutionEnvironment,
        moduleDescriptor: ImportedModuleDescriptor,
        suggestions: Map<string, Uri>
    ) {
        // Determine which search path this file is part of.
        const directory = getDirectoryLeadingDotsPointsTo(sourceFileUri.getDirectory(), moduleDescriptor.leadingDots);
        if (!directory) {
            return;
        }

        // Now try to match the module parts from the current directory location.
        this._getCompletionSuggestionsAbsolute(sourceFileUri, execEnv, directory, moduleDescriptor, suggestions);
    }

    private _getFilesInDirectory(dirPath: Uri): Uri[] {
        const cachedValue = this._cachedFilesForPath.get(dirPath.key);
        if (cachedValue) {
            return cachedValue;
        }

        let newCacheValue: Uri[] = [];
        try {
            const entriesInDir = this.readdirEntriesCached(dirPath);
            const filesInDir = entriesInDir.filter((f) => f.isFile());

            // Add any symbolic links that point to files.
            entriesInDir.forEach((f) => {
                if (f.isSymbolicLink() && tryStat(this.fileSystem, dirPath.combinePaths(f.name))?.isFile()) {
                    filesInDir.push(f);
                }
            });

            newCacheValue = filesInDir.map((f) => dirPath.combinePaths(f.name));
        } catch {
            newCacheValue = [];
        }

        this._cachedFilesForPath.set(dirPath.key, newCacheValue);
        return newCacheValue;
    }

    private _getCompletionSuggestionsAbsolute(
        sourceFileUri: Uri,
        execEnv: ExecutionEnvironment,
        rootPath: Uri,
        moduleDescriptor: ImportedModuleDescriptor,
        suggestions: Map<string, Uri>,
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
                sourceFileUri,
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
                        sourceFileUri,
                        execEnv,
                        dirPath,
                        nameParts[i],
                        suggestions,
                        leadingDots,
                        parentNameParts,
                        strictOnly
                    );
                }

                dirPath = dirPath.combinePaths(nameParts[i]);
                if (!this.dirExistsCached(dirPath)) {
                    break;
                }
            }
        }
    }

    private _addFilteredSuggestionsAbsolute(
        sourceFileUri: Uri,
        execEnv: ExecutionEnvironment,
        currentPath: Uri,
        filter: string,
        suggestions: Map<string, Uri>,
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
            const fileWithoutExtension = file.stripAllExtensions().fileName;

            if (ImportResolver.isSupportedImportFile(file)) {
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
                        sourceFileUri,
                        execEnv,
                        strictOnly
                    )
                ) {
                    return;
                }

                suggestions.set(fileWithoutExtension, file);
            }
        });

        entries.directories.forEach((dir) => {
            const dirSuggestion = dir.fileName;
            if (filter && !dirSuggestion.startsWith(filter)) {
                return;
            }

            if (
                !this._isUniqueValidSuggestion(dirSuggestion, suggestions) ||
                !this._isResolvableSuggestion(
                    dirSuggestion,
                    leadingDots,
                    parentNameParts,
                    sourceFileUri,
                    execEnv,
                    strictOnly
                )
            ) {
                return;
            }

            const initPyiPath = dir.initPyiUri;
            if (this.fileExistsCached(initPyiPath)) {
                suggestions.set(dirSuggestion, initPyiPath);
                return;
            }

            const initPyPath = dir.initPyUri;
            if (this.fileExistsCached(initPyPath)) {
                suggestions.set(dirSuggestion, initPyPath);
                return;
            }

            // It is a namespace package. there is no corresponding module path.
            suggestions.set(dirSuggestion, Uri.empty());
        });
    }

    // Fix for editable installed submodules where the suggested directory was a namespace directory that wouldn't resolve.
    // only used for absolute imports
    private _isResolvableSuggestion(
        name: string,
        leadingDots: number,
        parentNameParts: string[],
        sourceFileUri: Uri,
        execEnv: ExecutionEnvironment,
        strictOnly: boolean
    ) {
        // We always resolve names based on sourceFileUri.
        const moduleDescriptor: ImportedModuleDescriptor = {
            leadingDots: leadingDots,
            nameParts: [...parentNameParts, name],
            importedSymbols: new Set<string>(),
        };

        // Make sure we don't use parent folder resolution when checking whether the given name is resolvable.
        let importResult: ImportResult | undefined;
        if (strictOnly) {
            const importName = formatImportName(moduleDescriptor);
            const importFailureInfo: string[] = [];

            importResult = this._resolveImportStrict(
                importName,
                sourceFileUri,
                execEnv,
                moduleDescriptor,
                importFailureInfo
            );
        } else {
            importResult = this.resolveImportInternal(sourceFileUri, execEnv, moduleDescriptor);
        }

        if (importResult && importResult.isImportFound) {
            // Check the import isn't for a private or protected module. If it is, then
            // only allow it if there's no py.typed file.
            if (!SymbolNameUtils.isPrivateOrProtectedName(name) || importResult.pyTypedInfo === undefined) {
                return true;
            }
        }
        return false;
    }

    private _isUniqueValidSuggestion(suggestionToAdd: string, suggestions: Map<string, Uri>) {
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

    // Retrieves the pytyped info for a directory if it exists. This is a small perf optimization
    // that allows skipping the search when the pytyped file doesn't exist.
    private _getPyTypedInfo(filePath: Uri): PyTypedInfo | undefined {
        if (!this.fileExistsCached(filePath.pytypedUri)) {
            return undefined;
        }

        return getPyTypedInfoForPyTypedFile(this.fileSystem, filePath.pytypedUri);
    }

    private _findAndResolveNativeModule(
        fileDirectory: Uri,
        dirPath: Uri,
        execEnv: ExecutionEnvironment,
        importName: string,
        moduleDescriptor: ImportedModuleDescriptor,
        importFailureInfo: string[],
        resolvedPaths: Uri[]
    ): boolean {
        let isNativeLib = false;

        if (!execEnv.skipNativeLibraries && this.dirExistsCached(fileDirectory)) {
            const filesInDir = this._getFilesInDirectory(fileDirectory);
            const dirName = dirPath.fileName;
            const nativeLibPath = filesInDir.find((f) => this._isNativeModuleFileName(dirName, f));

            if (nativeLibPath) {
                // Try resolving native library to a custom stub.
                isNativeLib = this._resolveNativeModuleWithStub(
                    nativeLibPath,
                    execEnv,
                    importName,
                    moduleDescriptor,
                    importFailureInfo,
                    resolvedPaths
                );

                if (isNativeLib) {
                    importFailureInfo.push(`Resolved with native lib '${nativeLibPath.toUserVisibleString()}'`);
                }
            }
        }

        return isNativeLib;
    }

    private _resolveNativeModuleWithStub(
        nativeLibPath: Uri,
        execEnv: ExecutionEnvironment,
        importName: string,
        moduleDescriptor: ImportedModuleDescriptor,
        importFailureInfo: string[],
        resolvedPaths: Uri[]
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

    private _isNativeModuleFileName(moduleName: string, fileUri: Uri): boolean {
        // Strip off the final file extension and the part of the file name
        // that excludes all (multi-part) file extensions. This allows us to
        // handle file names like "foo.cpython-32m.so".
        const fileExtension = fileUri.lastExtension.toLowerCase();
        const withoutExtension = stripFileExtension(fileUri.fileName, /* multiDotExtension */ true);
        return (
            _isNativeModuleFileExtension(fileExtension) && equateStringsCaseInsensitive(moduleName, withoutExtension)
        );
    }

    private _tryWalkUp(current: Uri | undefined): Uri | undefined {
        if (!current || current.isEmpty() || current.isRoot()) {
            return undefined;
        }

        // Ensure we don't go around forever even if isRoot returns false.
        const next = current.resolvePaths('..');
        if (next.equals(current)) {
            return undefined;
        }
        return next;
    }

    private _shouldWalkUp(current: Uri | undefined, root: Uri, execEnv: ExecutionEnvironment) {
        return (
            current &&
            !current.isEmpty() &&
            (current.isChild(root) || (current.equals(root) && isDefaultWorkspace(execEnv.root)))
        );
    }
}

export type ImportResolverFactory = (
    serviceProvider: ServiceProvider,
    options: ConfigOptions,
    host: Host
) => ImportResolver;

export function formatImportName(moduleDescriptor: ImportedModuleDescriptor) {
    return '.'.repeat(moduleDescriptor.leadingDots) + moduleDescriptor.nameParts.join('.');
}

export function getParentImportResolutionRoot(sourceFileUri: Uri, executionRoot: Uri | undefined): Uri {
    if (!isDefaultWorkspace(executionRoot)) {
        return executionRoot!;
    }

    return sourceFileUri.getDirectory();
}

export function getModuleNameFromPath(
    containerPath: Uri,
    fileUri: Uri,
    stripTopContainerDir = false
): string | undefined {
    const moduleNameInfo = _getModuleNameInfoFromPath(containerPath, fileUri, stripTopContainerDir);
    if (!moduleNameInfo || moduleNameInfo.containsInvalidCharacters) {
        return undefined;
    }

    return moduleNameInfo.moduleName;
}

function _getModuleNameInfoFromPath(
    containerPath: Uri,
    fileUri: Uri,
    stripTopContainerDir = false
): ModuleNameInfoFromPath | undefined {
    let fileUriWithoutExtension = fileUri.stripExtension();

    // If module is native, strip platform part, such as 'cp36-win_amd64' in 'mtrand.cp36-win_amd64'.
    if (_isNativeModuleFileExtension(fileUri.lastExtension)) {
        fileUriWithoutExtension = fileUriWithoutExtension.stripExtension();
    }

    if (!fileUriWithoutExtension.startsWith(containerPath)) {
        return undefined;
    }

    // Strip off the '/__init__' if it's present.
    if (fileUriWithoutExtension.pathEndsWith('__init__')) {
        fileUriWithoutExtension = fileUriWithoutExtension.getDirectory();
    }

    const parts = Array.from(containerPath.getRelativePathComponents(fileUriWithoutExtension));
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
    const containsInvalidCharacters = parts.some((p) => !Tokenizer.isPythonIdentifier(p));

    return {
        moduleName: parts.join('.'),
        containsInvalidCharacters,
    };
}

function _isNativeModuleFileExtension(fileExtension: string): boolean {
    return supportedNativeLibExtensions.some((ext) => ext === fileExtension);
}

export function isDefaultWorkspace(uri: Uri | undefined) {
    return !uri || uri.isEmpty() || Uri.isDefaultWorkspace(uri);
}
