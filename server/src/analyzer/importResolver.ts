/*
* importResolver.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Provides the logic for resolving imports according to the
* runtime rules of Python.
*/

import { ConfigOptions, ExecutionEnvironment } from '../common/configOptions';
import {
    combinePaths, ensureTrailingDirectorySeparator, getDirectoryPath,
    getFileExtension, getFileSystemEntries, getPathComponents, isDirectory,
    isFile, stripFileExtension, stripTrailingDirectorySeparator
} from '../common/pathUtils';
import { versionToString } from '../common/pythonVersion';
import * as StringUtils from '../common/stringUtils';
import { ImplicitImport, ImportResult, ImportType } from './importResult';
import * as PythonPathUtils from './pythonPathUtils';
import { isDunderName } from './symbolNameUtils';
import { VirtualFileSystem } from '../common/vfs';

export interface ImportedModuleDescriptor {
    leadingDots: number;
    nameParts: string[];
    hasTrailingDot?: boolean;
    importedSymbols: string[] | undefined;
}

export interface ModuleNameAndType {
    moduleName: string;
    importType: ImportType;
}

type CachedImportResults = Map<string, ImportResult>;

export class ImportResolver {
    private _configOptions: ConfigOptions;
    private _cachedPythonSearchPaths = new Map<string, string[]>();
    private _cachedImportResults = new Map<string, CachedImportResults>();
    private _cachedTypeshedStdLibPath: string | undefined;
    private _cachedTypeshedThirdPartyPath: string | undefined;

    readonly fileSystem: VirtualFileSystem;

    constructor(fs: VirtualFileSystem, configOptions: ConfigOptions) {
        this.fileSystem = fs;
        this._configOptions = configOptions;
    }

    invalidateCache() {
        this._cachedPythonSearchPaths = new Map<string, string[]>();
        this._cachedImportResults = new Map<string, CachedImportResults>();
    }

    // Resolves the import and returns the path if it exists, otherwise
    // returns undefined.
    resolveImport(sourceFilePath: string, execEnv: ExecutionEnvironment,
        moduleDescriptor: ImportedModuleDescriptor): ImportResult {

        const importName = this._formatImportName(moduleDescriptor);
        const importFailureInfo: string[] = [];

        // Is it a relative import?
        if (moduleDescriptor.leadingDots > 0) {
            const relativeImport = this._resolveRelativeImport(sourceFilePath,
                moduleDescriptor, importName, importFailureInfo);

            if (relativeImport) {
                relativeImport.isRelative = true;
                return relativeImport;
            }
        } else {
            // Is it already cached?
            const cachedResults = this._lookUpResultsInCache(execEnv, importName,
                moduleDescriptor.importedSymbols);
            if (cachedResults) {
                return cachedResults;
            }

            // First check for a typeshed file.
            if (moduleDescriptor.nameParts.length > 0) {
                const builtInImport = this._findTypeshedPath(execEnv, moduleDescriptor,
                    importName, true, importFailureInfo);
                if (builtInImport) {
                    builtInImport.isTypeshedFile = true;
                    return this._addResultsToCache(execEnv, importName, builtInImport,
                        moduleDescriptor.importedSymbols);
                }
            }

            let bestResultSoFar: ImportResult | undefined;

            // Look for it in the root directory of the execution environment.
            importFailureInfo.push(`Looking in root directory of execution environment ` +
                `'${ execEnv.root }'`);
            let localImport = this._resolveAbsoluteImport(
                execEnv.root, moduleDescriptor, importName, importFailureInfo);
            if (localImport && localImport.isImportFound) {
                return this._addResultsToCache(execEnv, importName, localImport,
                    moduleDescriptor.importedSymbols);
            }
            bestResultSoFar = localImport;

            for (const extraPath of execEnv.extraPaths) {
                importFailureInfo.push(`Looking in extraPath '${ extraPath }'`);
                localImport = this._resolveAbsoluteImport(extraPath, moduleDescriptor,
                    importName, importFailureInfo);
                if (localImport && localImport.isImportFound) {
                    return this._addResultsToCache(execEnv, importName, localImport,
                        moduleDescriptor.importedSymbols);
                }

                if (localImport && (bestResultSoFar === undefined ||
                    localImport.resolvedPaths.length > bestResultSoFar.resolvedPaths.length)) {
                    bestResultSoFar = localImport;
                }
            }

            // Check for a typings file.
            if (this._configOptions.typingsPath) {
                importFailureInfo.push(`Looking in typingsPath '${ this._configOptions.typingsPath }'`);
                const typingsImport = this._resolveAbsoluteImport(
                    this._configOptions.typingsPath, moduleDescriptor, importName, importFailureInfo);
                if (typingsImport && typingsImport.isImportFound) {
                    // We will treat typings files as "local" rather than "third party".
                    typingsImport.importType = ImportType.Local;
                    typingsImport.isLocalTypingsFile = true;
                    return this._addResultsToCache(execEnv, importName, typingsImport,
                        moduleDescriptor.importedSymbols);
                }
            }

            // Check for a typeshed file.
            importFailureInfo.push(`Looking for typeshed path`);
            const typeshedImport = this._findTypeshedPath(execEnv, moduleDescriptor,
                importName, false, importFailureInfo);
            if (typeshedImport) {
                typeshedImport.isTypeshedFile = true;
                return this._addResultsToCache(execEnv, importName, typeshedImport,
                    moduleDescriptor.importedSymbols);
            }

            // Look for the import in the list of third-party packages.
            const pythonSearchPaths = this._getPythonSearchPaths(execEnv, importFailureInfo);
            if (pythonSearchPaths.length > 0) {
                for (const searchPath of pythonSearchPaths) {
                    // Allow partial resolution because some third-party packages
                    // use tricks to populate their package namespaces.
                    importFailureInfo.push(`Looking in python search path '${ searchPath }'`);
                    const thirdPartyImport = this._resolveAbsoluteImport(
                        searchPath, moduleDescriptor, importName, importFailureInfo,
                        true, true, true);
                    if (thirdPartyImport) {
                        thirdPartyImport.importType = ImportType.ThirdParty;

                        if (thirdPartyImport.isImportFound) {
                            return this._addResultsToCache(execEnv, importName,
                                thirdPartyImport, moduleDescriptor.importedSymbols);
                        }

                        if (bestResultSoFar === undefined ||
                            thirdPartyImport.resolvedPaths.length > bestResultSoFar.resolvedPaths.length) {
                            bestResultSoFar = thirdPartyImport;
                        }
                    }
                }
            } else {
                importFailureInfo.push('No python interpreter search path');
            }

            // We weren't able to find an exact match, so return the best
            // partial match.
            if (bestResultSoFar) {
                return this._addResultsToCache(execEnv, importName, bestResultSoFar,
                    moduleDescriptor.importedSymbols);
            }
        }

        const notFoundResult: ImportResult = {
            importName,
            isRelative: false,
            isImportFound: false,
            importFailureInfo,
            resolvedPaths: [],
            importType: ImportType.Local,
            isStubFile: false,
            isPydFile: false,
            implicitImports: []
        };

        return this._addResultsToCache(execEnv, importName, notFoundResult, undefined);
    }

    getCompletionSuggestions(sourceFilePath: string, execEnv: ExecutionEnvironment,
        moduleDescriptor: ImportedModuleDescriptor, similarityLimit: number): string[] {

        const importFailureInfo: string[] = [];
        const suggestions: string[] = [];

        // Is it a relative import?
        if (moduleDescriptor.leadingDots > 0) {
            this._getCompletionSuggestionsRelative(sourceFilePath,
                moduleDescriptor, suggestions, similarityLimit);
        } else {
            // First check for a typeshed file.
            if (moduleDescriptor.nameParts.length > 0) {
                this._getCompletionSuggestionsTypeshedPath(execEnv, moduleDescriptor,
                    true, suggestions, similarityLimit);
            }

            // Look for it in the root directory of the execution environment.
            this._getCompletionSuggestionsAbsolute(execEnv.root,
                moduleDescriptor, suggestions, similarityLimit);

            for (const extraPath of execEnv.extraPaths) {
                this._getCompletionSuggestionsAbsolute(extraPath, moduleDescriptor,
                    suggestions, similarityLimit);
            }

            // Check for a typings file.
            if (this._configOptions.typingsPath) {
                this._getCompletionSuggestionsAbsolute(this._configOptions.typingsPath,
                    moduleDescriptor, suggestions, similarityLimit);
            }

            // Check for a typeshed file.
            this._getCompletionSuggestionsTypeshedPath(execEnv, moduleDescriptor,
                false, suggestions, similarityLimit);

            // Look for the import in the list of third-party packages.
            const pythonSearchPaths = this._getPythonSearchPaths(execEnv, importFailureInfo);
            for (const searchPath of pythonSearchPaths) {
                this._getCompletionSuggestionsAbsolute(searchPath,
                    moduleDescriptor, suggestions, similarityLimit);
            }
        }

        return suggestions;
    }

    // Returns the module name (of the form X.Y.Z) that needs to be imported
    // from the current context to access the module with the specified file path.
    // In a sense, it's performing the inverse of resolveImport.
    getModuleNameForImport(filePath: string, execEnv: ExecutionEnvironment): ModuleNameAndType {
        let moduleName: string | undefined;
        let importType = ImportType.BuiltIn;

        const importFailureInfo: string[] = [];

        // Is this ia stdlib typeshed path?
        const stdLibTypeshedPath = this._getTypeshedPath(true, execEnv, importFailureInfo);
        if (stdLibTypeshedPath) {
            moduleName = this._getModuleNameFromPath(stdLibTypeshedPath, filePath, true);
            if (moduleName) {
                return { moduleName, importType };
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
        if (this._configOptions.typingsPath) {
            const candidateModuleName = this._getModuleNameFromPath(
                this._configOptions.typingsPath, filePath);

            // Does this candidate look better than the previous best module name?
            // We'll always try to use the shortest version.
            if (!moduleName || (candidateModuleName && candidateModuleName.length < moduleName.length)) {
                moduleName = candidateModuleName;
                importType = ImportType.ThirdParty;
            }
        }

        // Check for a typeshed file.
        const thirdPartyTypeshedPath = this._getTypeshedPath(false, execEnv, importFailureInfo);
        if (thirdPartyTypeshedPath) {
            const candidateModuleName = this._getModuleNameFromPath(thirdPartyTypeshedPath, filePath, true);

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
            return { moduleName, importType };
        }

        // We didn't find any module name.
        return { moduleName: '', importType: ImportType.Local };
    }

    private _lookUpResultsInCache(execEnv: ExecutionEnvironment, importName: string,
        importedSymbols: string[] | undefined) {

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

    private _addResultsToCache(execEnv: ExecutionEnvironment, importName: string,
        importResult: ImportResult, importedSymbols: string[] | undefined) {

        let cacheForExecEnv = this._cachedImportResults.get(execEnv.root);
        if (!cacheForExecEnv) {
            cacheForExecEnv = new Map<string, ImportResult>();
            this._cachedImportResults.set(execEnv.root, cacheForExecEnv);
        }

        cacheForExecEnv.set(importName, importResult);

        return this._filterImplicitImports(importResult, importedSymbols);
    }

    private _getModuleNameFromPath(containerPath: string, filePath: string,
        stripTopContainerDir = false): string | undefined {

        containerPath = ensureTrailingDirectorySeparator(containerPath);
        let filePathWithoutExtension = stripFileExtension(filePath);

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

        return parts.join('.');
    }

    private _getPythonSearchPaths(execEnv: ExecutionEnvironment,
        importFailureInfo: string[]) {

        const cacheKey = execEnv.venv ? execEnv.venv : '<default>';

        // Find the site packages for the configured virtual environment.
        if (!this._cachedPythonSearchPaths.has(cacheKey)) {
            this._cachedPythonSearchPaths.set(cacheKey, PythonPathUtils.findPythonSearchPaths(
                this.fileSystem, this._configOptions, execEnv.venv, importFailureInfo) || []);
        }

        return this._cachedPythonSearchPaths.get(cacheKey)!;
    }

    private _findTypeshedPath(execEnv: ExecutionEnvironment, moduleDescriptor: ImportedModuleDescriptor,
        importName: string, isStdLib: boolean, importFailureInfo: string[]): ImportResult | undefined {

        importFailureInfo.push(`Looking for typeshed ${ isStdLib ? 'stdlib' : 'third_party' } path`);

        const typeshedPath = this._getTypeshedPath(isStdLib, execEnv, importFailureInfo);
        if (!typeshedPath) {
            return undefined;
        }

        const pythonVersion = execEnv.pythonVersion;
        let minorVersion = pythonVersion & 0xFF;

        // Search for module starting at "3.x" down to "3.1", then "3", then "2and3".
        while (true) {
            const pythonVersionString = minorVersion > 0 ? versionToString(0x300 + minorVersion) :
                minorVersion === 0 ? '3' : '2and3';
            const testPath = combinePaths(typeshedPath, pythonVersionString);
            if (this.fileSystem.existsSync(testPath)) {
                const importInfo = this._resolveAbsoluteImport(testPath, moduleDescriptor,
                    importName, importFailureInfo);
                if (importInfo && importInfo.isImportFound) {
                    importInfo.importType = isStdLib ? ImportType.BuiltIn : ImportType.ThirdParty;
                    return importInfo;
                }
            }

            // We use -1 to indicate "2and3", which is searched after "3.0".
            if (minorVersion === -1) {
                break;
            }
            minorVersion--;
        }

        importFailureInfo.push(`Typeshed path not found`);
        return undefined;
    }

    private _getCompletionSuggestionsTypeshedPath(execEnv: ExecutionEnvironment,
        moduleDescriptor: ImportedModuleDescriptor, isStdLib: boolean,
        suggestions: string[], similarityLimit: number) {

        const importFailureInfo: string[] = [];
        const typeshedPath = this._getTypeshedPath(isStdLib, execEnv, importFailureInfo);
        if (!typeshedPath) {
            return;
        }

        const pythonVersion = execEnv.pythonVersion;
        let minorVersion = pythonVersion & 0xFF;

        // Search for module starting at "3.x" down to "3.1", then "3", then "2and3".
        while (true) {
            const pythonVersionString = minorVersion > 0 ? versionToString(0x300 + minorVersion) :
                minorVersion === 0 ? '3' : '2and3';
            const testPath = combinePaths(typeshedPath, pythonVersionString);
            if (this.fileSystem.existsSync(testPath)) {
                this._getCompletionSuggestionsAbsolute(testPath, moduleDescriptor,
                    suggestions, similarityLimit);
            }

            // We use -1 to indicate "2and3", which is searched after "3.0".
            if (minorVersion === -1) {
                break;
            }
            minorVersion--;
        }
    }

    private _getTypeshedPath(isStdLib: boolean, execEnv: ExecutionEnvironment,
        importFailureInfo: string[]) {

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
            if (this.fileSystem.existsSync(possibleTypeshedPath) && isDirectory(this.fileSystem, possibleTypeshedPath)) {
                typeshedPath = possibleTypeshedPath;
            }
        } else {
            const pythonSearchPaths = this._getPythonSearchPaths(execEnv, importFailureInfo);
            for (const searchPath of pythonSearchPaths) {
                const possibleTypeshedPath = combinePaths(searchPath, 'typeshed');
                if (this.fileSystem.existsSync(possibleTypeshedPath) && isDirectory(this.fileSystem, possibleTypeshedPath)) {
                    typeshedPath = possibleTypeshedPath;
                    break;
                }
            }
        }

        // If typeshed directory wasn't found in other locations, use the fallback.
        if (!typeshedPath) {
            typeshedPath = PythonPathUtils.getTypeShedFallbackPath(this.fileSystem.getModulePath()) || '';
        }

        typeshedPath = PythonPathUtils.getTypeshedSubdirectory(typeshedPath, isStdLib);

        if (!this.fileSystem.existsSync(typeshedPath) || !isDirectory(this.fileSystem, typeshedPath)) {
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

    private _resolveRelativeImport(sourceFilePath: string,
        moduleDescriptor: ImportedModuleDescriptor, importName: string,
        importFailureInfo: string[]): ImportResult | undefined {

        importFailureInfo.push('Attempting to resolve relative import');

        // Determine which search path this file is part of.
        let curDir = getDirectoryPath(sourceFilePath);
        for (let i = 1; i < moduleDescriptor.leadingDots; i++) {
            if (curDir === '') {
                importFailureInfo.push(`Invalid relative path '${ importName }'`);
                return undefined;
            }
            curDir = getDirectoryPath(curDir);
        }

        // Now try to match the module parts from the current directory location.
        const absImport = this._resolveAbsoluteImport(curDir, moduleDescriptor,
            importName, importFailureInfo);
        if (!absImport) {
            return undefined;
        }

        return this._filterImplicitImports(absImport, moduleDescriptor.importedSymbols);
    }

    private _getCompletionSuggestionsRelative(sourceFilePath: string,
        moduleDescriptor: ImportedModuleDescriptor, suggestions: string[],
        similarityLimit: number) {

        // Determine which search path this file is part of.
        let curDir = getDirectoryPath(sourceFilePath);
        for (let i = 1; i < moduleDescriptor.leadingDots; i++) {
            if (curDir === '') {
                return;
            }
            curDir = getDirectoryPath(curDir);
        }

        // Now try to match the module parts from the current directory location.
        this._getCompletionSuggestionsAbsolute(curDir, moduleDescriptor,
            suggestions, similarityLimit);
    }

    // Follows import resolution algorithm defined in PEP-420:
    // https://www.python.org/dev/peps/pep-0420/
    private _resolveAbsoluteImport(rootPath: string, moduleDescriptor: ImportedModuleDescriptor,
        importName: string, importFailureInfo: string[], allowPartial = false,
        allowPydFile = false, allowStubsFolder = false): ImportResult | undefined {

        importFailureInfo.push(`Attempting to resolve using root path '${ rootPath }'`);

        // Starting at the specified path, walk the file system to find the
        // specified module.
        const resolvedPaths: string[] = [];
        let dirPath = rootPath;
        let isNamespacePackage = false;
        let isStubFile = false;
        let isPydFile = false;
        let implicitImports: ImplicitImport[] = [];

        // Handle the "from . import XXX" case.
        if (moduleDescriptor.nameParts.length === 0) {
            const pyFilePath = combinePaths(dirPath, '__init__.py');
            const pyiFilePath = pyFilePath + 'i';
            const pydFilePath = pyFilePath + 'd';

            if (this.fileSystem.existsSync(pyiFilePath) && isFile(this.fileSystem, pyiFilePath)) {
                importFailureInfo.push(`Resolved import with file '${ pyiFilePath }'`);
                resolvedPaths.push(pyiFilePath);
                isStubFile = true;
            } else if (this.fileSystem.existsSync(pyFilePath) && isFile(this.fileSystem, pyFilePath)) {
                importFailureInfo.push(`Resolved import with file '${ pyFilePath }'`);
                resolvedPaths.push(pyFilePath);
            } else if (allowPydFile && this.fileSystem.existsSync(pydFilePath) && isFile(this.fileSystem, pydFilePath)) {
                importFailureInfo.push(`Resolved import with file '${ pydFilePath }'`);
                resolvedPaths.push(pydFilePath);
                isPydFile = true;
            } else {
                importFailureInfo.push(`Partially resolved import with directory '${ dirPath }'`);
                resolvedPaths.push('');
                isNamespacePackage = true;
            }

            implicitImports = this._findImplicitImports(dirPath, [pyFilePath, pyiFilePath]);
        } else {
            for (let i = 0; i < moduleDescriptor.nameParts.length; i++) {
                const isLastPart = i === moduleDescriptor.nameParts.length - 1;
                dirPath = combinePaths(dirPath, moduleDescriptor.nameParts[i]);
                let foundDirectory = false;

                if (allowStubsFolder) {
                    // PEP 561 indicates that package authors can ship their stubs
                    // separately from their package implementation by appending
                    // the string '-stubs' to its top-level directory name. We'll
                    // look there first.
                    const stubsDirPath = dirPath + '-stubs';
                    foundDirectory = this.fileSystem.existsSync(stubsDirPath) && isDirectory(this.fileSystem, stubsDirPath);
                    if (foundDirectory) {
                        dirPath = stubsDirPath;
                    }
                }

                if (!foundDirectory) {
                    foundDirectory = this.fileSystem.existsSync(dirPath) && isDirectory(this.fileSystem, dirPath);
                }

                if (foundDirectory) {
                    if (!isLastPart) {
                        // We are not at the last part, and we found a directory,
                        // so continue to look for the next part.
                        resolvedPaths.push('');
                        continue;
                    }

                    // See if we can find an __init__.py[i] in this directory.
                    const pyFilePath = combinePaths(dirPath, '__init__.py');
                    const pyiFilePath = pyFilePath + 'i';
                    let foundInit = false;

                    if (this.fileSystem.existsSync(pyiFilePath) && isFile(this.fileSystem, pyiFilePath)) {
                        importFailureInfo.push(`Resolved import with file '${ pyiFilePath }'`);
                        resolvedPaths.push(pyiFilePath);
                        if (isLastPart) {
                            isStubFile = true;
                        }
                        foundInit = true;
                    } else if (this.fileSystem.existsSync(pyFilePath) && isFile(this.fileSystem, pyFilePath)) {
                        importFailureInfo.push(`Resolved import with file '${ pyFilePath }'`);
                        resolvedPaths.push(pyFilePath);
                        foundInit = true;
                    }

                    if (foundInit) {
                        implicitImports = this._findImplicitImports(dirPath, [pyFilePath, pyiFilePath]);
                        break;
                    }
                }

                // We weren't able to find a directory or we found a directory with
                // no __init__.py[i] file. See if we can find a ".py" or ".pyi" file
                // with this name.
                const pyFilePath = stripTrailingDirectorySeparator(dirPath) + '.py';
                const pyiFilePath = pyFilePath + 'i';
                const pydFilePath = pyFilePath + 'd';

                if (this.fileSystem.existsSync(pyiFilePath) && isFile(this.fileSystem, pyiFilePath)) {
                    importFailureInfo.push(`Resolved import with file '${ pyiFilePath }'`);
                    resolvedPaths.push(pyiFilePath);
                    if (isLastPart) {
                        isStubFile = true;
                    }
                } else if (this.fileSystem.existsSync(pyFilePath) && isFile(this.fileSystem, pyFilePath)) {
                    importFailureInfo.push(`Resolved import with file '${ pyFilePath }'`);
                    resolvedPaths.push(pyFilePath);
                } else if (allowPydFile && this.fileSystem.existsSync(pydFilePath) && isFile(this.fileSystem, pydFilePath)) {
                    importFailureInfo.push(`Resolved import with file '${ pydFilePath }'`);
                    resolvedPaths.push(pydFilePath);
                    if (isLastPart) {
                        isPydFile = true;
                    }
                } else if (foundDirectory) {
                    importFailureInfo.push(`Partially resolved import with directory '${ dirPath }'`);
                    resolvedPaths.push('');
                    if (isLastPart) {
                        implicitImports = this._findImplicitImports(dirPath, [pyFilePath, pyiFilePath]);
                        isNamespacePackage = true;
                    }
                } else {
                    importFailureInfo.push(`Did not find file '${ pyiFilePath }',` +
                        ` '${ pyFilePath }' or '${ pydFilePath }'`);
                }
                break;
            }
        }

        let importFound: boolean;
        if (allowPartial) {
            importFound = resolvedPaths.length > 0;
        } else {
            importFound = resolvedPaths.length >= moduleDescriptor.nameParts.length;

            // Empty namespace packages are not allowed.
            if (isNamespacePackage && implicitImports.length === 0) {
                importFound = false;
            }
        }

        return {
            importName,
            isRelative: false,
            isImportFound: importFound,
            importFailureInfo,
            importType: ImportType.Local,
            resolvedPaths,
            searchPath: rootPath,
            isStubFile,
            isPydFile,
            implicitImports
        };
    }

    private _getCompletionSuggestionsAbsolute(rootPath: string,
        moduleDescriptor: ImportedModuleDescriptor, suggestions: string[],
        similarityLimit: number) {

        // Starting at the specified path, walk the file system to find the
        // specified module.
        let dirPath = rootPath;

        // Copy the nameParts into a new directory and add an extra empty
        // part if there is a trailing dot.
        const nameParts = moduleDescriptor.nameParts.map(name => name);
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
                    this._addFilteredSuggestions(dirPath,
                        nameParts[i], suggestions, similarityLimit);
                }

                dirPath = combinePaths(dirPath, nameParts[i]);
                if (!this.fileSystem.existsSync(dirPath) || !isDirectory(this.fileSystem, dirPath)) {
                    break;
                }
            }
        }
    }

    private _addFilteredSuggestions(dirPath: string, filter: string, suggestions: string[],
        similarityLimit: number) {

        const entries = getFileSystemEntries(this.fileSystem, dirPath);

        entries.files.forEach(file => {
            const fileWithoutExtension = stripFileExtension(file);
            const fileExtension = getFileExtension(file);

            if (fileExtension === '.py' || fileExtension === '.pyi' || fileExtension === '.pyd') {
                if (fileWithoutExtension !== '__init__') {
                    if (!filter || StringUtils.computeCompletionSimilarity(
                        filter, fileWithoutExtension) >= similarityLimit) {

                        this._addUniqueSuggestion(fileWithoutExtension, suggestions);
                    }
                }
            }
        });

        entries.directories.forEach(dir => {
            if (!filter || dir.startsWith(filter)) {
                this._addUniqueSuggestion(dir, suggestions);
            }
        });
    }

    private _addUniqueSuggestion(suggestionToAdd: string, suggestions: string[]) {
        if (suggestions.some(s => s === suggestionToAdd)) {
            return;
        }

        // Don't add directories with illegal module names.
        if (/[.-]/.test(suggestionToAdd)) {
            return;
        }

        // Don't add directories with dunder names like "__pycache__".
        if (isDunderName(suggestionToAdd)) {
            return;
        }

        suggestions.push(suggestionToAdd);
    }

    // Potentially modifies the ImportResult by removing some or all of the
    // implicit import entries. Only the imported symbols should be included.
    private _filterImplicitImports(importResult: ImportResult, importedSymbols: string[] | undefined): ImportResult {
        if (importedSymbols === undefined || importedSymbols.length === 0) {
            return importResult;
        }

        if (importResult.implicitImports.length === 0) {
            return importResult;
        }

        const filteredImplicitImports = importResult.implicitImports.filter(implicitImport => {
            return importedSymbols.some(sym => sym === implicitImport.name);
        });

        if (filteredImplicitImports.length === importResult.implicitImports.length) {
            return importResult;
        }

        const newImportResult = Object.assign({}, importResult);
        newImportResult.implicitImports = filteredImplicitImports;
        return newImportResult;
    }

    private _findImplicitImports(dirPath: string, exclusions: string[]): ImplicitImport[] {
        const implicitImportMap = new Map<string, ImplicitImport>();

        // Enumerate all of the files and directories in the path.
        const entries = getFileSystemEntries(this.fileSystem, dirPath);

        // Add implicit file-based modules.
        for (const fileName of entries.files) {
            if (fileName.endsWith('.py') || fileName.endsWith('.pyi')) {
                const filePath = combinePaths(dirPath, fileName);

                if (!exclusions.find(exclusion => exclusion === filePath)) {
                    const strippedFileName = stripFileExtension(fileName);
                    const implicitImport: ImplicitImport = {
                        isStubFile: fileName.endsWith('.pyi'),
                        name: strippedFileName,
                        path: filePath
                    };

                    // Always prefer stub files over non-stub files.
                    const entry = implicitImportMap.get(implicitImport.name);
                    if (!entry || !entry.isStubFile) {
                        implicitImportMap.set(implicitImport.name, implicitImport);
                    }
                }
            }
        }

        // Add implicit directory-based modules.
        for (const dirName of entries.directories) {
            const pyFilePath = combinePaths(dirPath, dirName, '__init__.py');
            const pyiFilePath = pyFilePath + 'i';
            let isStubFile = false;
            let path = '';

            if (this.fileSystem.existsSync(pyiFilePath) && isFile(this.fileSystem, pyiFilePath)) {
                isStubFile = true;
                path = pyiFilePath;
            } else if (this.fileSystem.existsSync(pyFilePath) && isFile(this.fileSystem, pyFilePath)) {
                path = pyFilePath;
            }

            if (path) {
                if (!exclusions.find(exclusion => exclusion === path)) {
                    const implicitImport: ImplicitImport = {
                        isStubFile,
                        name: dirName,
                        path
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

        return name + moduleDescriptor.nameParts.map(part => part).join('.');
    }
}
