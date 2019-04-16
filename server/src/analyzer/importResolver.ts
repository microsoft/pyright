/*
* importResolver.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Provides the logic for resolving imports according to the
* runtime rules of Python.
*/

import * as fs from 'fs';

import { ConfigOptions, ExecutionEnvironment } from '../common/configOptions';
import { combinePaths, getDirectoryPath, getFileSystemEntries, isDirectory, isFile,
    stripFileExtension, stripTrailingDirectorySeparator } from '../common/pathUtils';
import { is3x, versionToString } from '../common/pythonVersion';
import { ImplicitImport, ImportResult, ImportType } from './importResult';
import { PythonPathUtils } from './pythonPathUtils';

export interface ImportedModuleDescriptor {
    leadingDots: number;
    nameParts: string[];
    importedSymbols: string[] | undefined;
}

export class ImportResolver {
    private _sourceFilePath: string;
    private _configOptions: ConfigOptions;
    private _executionEnvironment: ExecutionEnvironment;
    private _cachedPythonSearchPaths: string[] | undefined;

    constructor(sourceFilePath: string, configOptions: ConfigOptions, execEnv: ExecutionEnvironment) {
        this._sourceFilePath = sourceFilePath;
        this._configOptions = configOptions;
        this._executionEnvironment = execEnv;
    }

    // Resolves the import and returns the path if it exists, otherwise
    // returns undefined.
    resolveImport(moduleDescriptor: ImportedModuleDescriptor): ImportResult {
        let importName = this._formatImportName(moduleDescriptor);

        // Find the site packages for the configured virtual environment.
        if (this._cachedPythonSearchPaths === undefined) {
            this._cachedPythonSearchPaths = PythonPathUtils.findPythonSearchPaths(
                this._configOptions, this._executionEnvironment);
        }

        // First check for a typeshed file.
        if (moduleDescriptor.leadingDots === 0 && moduleDescriptor.nameParts.length > 0) {
            let builtInImport = this._findTypeshedPath(moduleDescriptor, importName, true);
            if (builtInImport) {
                builtInImport.isTypeshedFile = true;
                return builtInImport;
            }
        }

        // Is it a relative import?
        if (moduleDescriptor.leadingDots > 0) {
            let relativeImport = this._resolveRelativeImport(moduleDescriptor, importName);
            if (relativeImport) {
                return relativeImport;
            }
        } else {
            let bestResultSoFar: ImportResult | undefined;

            // Look for it in the root directory of the execution environment.
            let localImport = this._resolveAbsoluteImport(
                this._executionEnvironment.root, moduleDescriptor, importName);
            if (localImport && localImport.importFound) {
                return localImport;
            }
            bestResultSoFar = localImport;

            for (let i = 0; i < this._executionEnvironment.extraPaths.length; i++) {
                let extraPath = this._executionEnvironment.extraPaths[i];
                localImport = this._resolveAbsoluteImport(extraPath, moduleDescriptor, importName);
                if (localImport && localImport.importFound) {
                    return localImport;
                }

                if (localImport && (bestResultSoFar === undefined ||
                        localImport.resolvedPaths.length > bestResultSoFar.resolvedPaths.length)) {
                    bestResultSoFar = localImport;
                }
            }

            // Check for a typings file.
            if (this._configOptions.typingsPath) {
                let typingsImport = this._resolveAbsoluteImport(
                    this._configOptions.typingsPath, moduleDescriptor, importName);
                if (typingsImport && typingsImport.importFound) {
                    return typingsImport;
                }
            }

            // Check for a typeshed file.
            let typeshedImport = this._findTypeshedPath(moduleDescriptor, importName, false);
            if (typeshedImport) {
                typeshedImport.isTypeshedFile = true;
                return typeshedImport;
            }

            // Look for the import in the list of third-party packages.
            if (this._cachedPythonSearchPaths) {
                for (let searchPath of this._cachedPythonSearchPaths) {
                    // Allow partial resolution because some third-party packages
                    // use tricks to populate their package namespaces.
                    let thirdPartyImport = this._resolveAbsoluteImport(
                        searchPath, moduleDescriptor, importName, true);
                    if (thirdPartyImport) {
                        thirdPartyImport.importType = ImportType.ThirdParty;
                        return thirdPartyImport;
                    }
                }
            }

            // We weren't able to find an exact match, so return the best
            // partial match.
            if (bestResultSoFar) {
                return bestResultSoFar;
            }
        }

        return {
            importName,
            importFound: false,
            resolvedPaths: [],
            importType: ImportType.Local,
            isNamespacePackage: false,
            isStubFile: false,
            implicitImports: []
        };
    }

    private _findTypeshedPath(moduleDescriptor: ImportedModuleDescriptor, importName: string,
            isStdLib: boolean): ImportResult | undefined {

        let typeshedPath = '';

        // Did the user specify a typeshed path? If not, we'll look in the
        // python search paths, then in the typeshed-fallback directory.
        if (this._configOptions.typeshedPath) {
            const possibleTypeshedPath = this._configOptions.typeshedPath;
            if (fs.existsSync(possibleTypeshedPath) && isDirectory(possibleTypeshedPath)) {
                typeshedPath = possibleTypeshedPath;
            }
        } else if (this._cachedPythonSearchPaths) {
            for (let searchPath of this._cachedPythonSearchPaths) {
                const possibleTypeshedPath = combinePaths(searchPath, 'typeshed');
                if (fs.existsSync(possibleTypeshedPath) && isDirectory(possibleTypeshedPath)) {
                    typeshedPath = possibleTypeshedPath;
                    break;
                }
            }
        }

        // If typeshed directory wasn't found in other locations, use the fallback.
        if (!typeshedPath) {
            typeshedPath = PythonPathUtils.getTypeShedFallbackPath() || '';
        }

        typeshedPath = PythonPathUtils.getTypeshedSubdirectory(typeshedPath, isStdLib);

        if (!fs.existsSync(typeshedPath) || !isDirectory(typeshedPath)) {
            return undefined;
        }

        // We currently support only 3.x.
        let pythonVersion = this._executionEnvironment.pythonVersion;
        if (!is3x(pythonVersion)) {
            return undefined;
        }

        let minorVersion = pythonVersion & 0xFF;

        // Search for module starting at "3.x" down to "3.1", then "3", then "2and3".
        while (true) {
            let pythonVersionString = minorVersion > 0 ? versionToString(0x300 + minorVersion) :
                minorVersion === 0 ? '3' : '2and3';
            let testPath = combinePaths(typeshedPath, pythonVersionString);
            if (fs.existsSync(testPath)) {
                let importInfo = this._resolveAbsoluteImport(testPath, moduleDescriptor, importName);
                if (importInfo && importInfo.importFound) {
                    if (isStdLib) {
                        importInfo.importType = ImportType.BuiltIn;
                    }
                    return importInfo;
                }
            }

            // We use -1 to indicate "2and3", which is searched after "3.0".
            if (minorVersion === -1) {
                break;
            }
            minorVersion--;
        }

        return undefined;
    }

    private _resolveRelativeImport(moduleDescriptor: ImportedModuleDescriptor,
            importName: string): ImportResult | undefined {

        // Determine which search path this file is part of.
        let curDir = getDirectoryPath(this._sourceFilePath);
        for (let i = 1; i < moduleDescriptor.leadingDots; i++) {
            curDir = getDirectoryPath(curDir);
        }

        // Now try to match the module parts from the current directory location.
        return this._resolveAbsoluteImport(curDir, moduleDescriptor, importName);
    }

    // Follows import resolution algorithm defined in PEP-420:
    // https://www.python.org/dev/peps/pep-0420/
    private _resolveAbsoluteImport(rootPath: string, moduleDescriptor: ImportedModuleDescriptor,
            importName: string, allowPartial = false): ImportResult | undefined {

        // Starting at the specified path, walk the file system to find the
        // specified module.
        let resolvedPaths: string[] = [];
        let dirPath = rootPath;
        let isNamespacePackage = false;
        let isStubFile = false;
        let implicitImports: ImplicitImport[] = [];

        // Handle the "from . import XXX" case.
        if (moduleDescriptor.nameParts.length === 0) {
            let pyFilePath = combinePaths(dirPath, '__init__.py');
            let pyiFilePath = pyFilePath + 'i';
            if (fs.existsSync(pyiFilePath) && isFile(pyiFilePath)) {
                resolvedPaths.push(pyiFilePath);
                isStubFile = true;
            } else if (fs.existsSync(pyFilePath) && isFile(pyFilePath)) {
                resolvedPaths.push(pyFilePath);
            } else {
                resolvedPaths.push(dirPath);
                isNamespacePackage = true;
            }

            implicitImports = this._findImplicitImports(
                dirPath, [pyFilePath, pyiFilePath], moduleDescriptor.importedSymbols);
        } else {
            for (let i = 0; i < moduleDescriptor.nameParts.length; i++) {
                dirPath = combinePaths(dirPath, moduleDescriptor.nameParts[i]);
                if (!fs.existsSync(dirPath) || !isDirectory(dirPath)) {
                    // We weren't able to find the subdirectory. See if we can
                    // find a ".py" or ".pyi" file with this name.
                    let pyFilePath = stripTrailingDirectorySeparator(dirPath) + '.py';
                    let pyiFilePath = pyFilePath + 'i';
                    if (fs.existsSync(pyiFilePath) && isFile(pyiFilePath)) {
                        resolvedPaths.push(pyiFilePath);
                        isStubFile = true;
                    } else if (fs.existsSync(pyFilePath) && isFile(pyFilePath)) {
                        resolvedPaths.push(pyFilePath);
                    }
                    break;
                }

                let pyFilePath = combinePaths(dirPath, '__init__.py');
                let pyiFilePath = pyFilePath + 'i';
                if (fs.existsSync(pyiFilePath) && isFile(pyiFilePath)) {
                    resolvedPaths.push(pyiFilePath);
                    isStubFile = true;
                } else if (fs.existsSync(pyFilePath) && isFile(pyFilePath)) {
                    resolvedPaths.push(pyFilePath);
                } else {
                    resolvedPaths.push(dirPath);
                    if (i === moduleDescriptor.nameParts.length - 1) {
                        isNamespacePackage = true;
                    }
                }

                if (i === moduleDescriptor.nameParts.length - 1) {
                    implicitImports = this._findImplicitImports(
                        dirPath, [pyFilePath, pyiFilePath], moduleDescriptor.importedSymbols);
                }
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
            importFound,
            importType: ImportType.Local,
            resolvedPaths,
            searchPath: rootPath,
            isNamespacePackage,
            isStubFile,
            implicitImports
        };
    }

    private _findImplicitImports(dirPath: string, exclusions: string[],
            importedSymbols: string[] | undefined): ImplicitImport[] {

        const implicitImportMap: { [name: string]: ImplicitImport } = {};
        const importAll = importedSymbols === undefined || importedSymbols.length === 0;
        const shouldImportFile = (strippedFileName: string) => {
            if (importAll) {
                return true;
            }

            return importedSymbols!.some(sym => sym === strippedFileName);
        };

        // Enumerate all of the files and directories in the path.
        let entries = getFileSystemEntries(dirPath);

        // Add implicit file-based modules.
        for (let fileName of entries.files) {
            if (fileName.endsWith('.py') || fileName.endsWith('.pyi')) {
                let filePath = combinePaths(dirPath, fileName);

                if (!exclusions.find(exclusion => exclusion === filePath)) {
                    const strippedFileName = stripFileExtension(fileName);
                    if (shouldImportFile(strippedFileName)) {
                        const implicitImport: ImplicitImport = {
                            isStubFile: fileName.endsWith('.pyi'),
                            name: strippedFileName,
                            path: filePath
                        };

                        // Always prefer stub files over non-stub files.
                        if (!implicitImportMap[implicitImport.name] ||
                                !implicitImportMap[implicitImport.name].isStubFile) {
                            implicitImportMap[implicitImport.name] = implicitImport;
                        }
                    }
                }
            }
        }

        // Add implicit directory-based modules.
        for (let dirName of entries.directories) {
            let pyFilePath = combinePaths(dirPath, dirName, '__init__.py');
            let pyiFilePath = pyFilePath + 'i';
            let isStubFile = false;
            let path = '';

            if (fs.existsSync(pyiFilePath) && isFile(pyiFilePath)) {
                isStubFile = true;
                path = pyiFilePath;
            } else if (fs.existsSync(pyFilePath) && isFile(pyFilePath)) {
                path = pyFilePath;
            }

            if (path) {
                if (shouldImportFile(dirName)) {
                    let implicitImport: ImplicitImport = {
                        isStubFile,
                        name: dirName,
                        path
                    };

                    implicitImportMap[implicitImport.name] = implicitImport;
                }
            }
        }

        return Object.keys(implicitImportMap).map(key => implicitImportMap[key]);
    }

    private _formatImportName(moduleDescriptor: ImportedModuleDescriptor) {
        let name = '';
        for (let i = 0; i < moduleDescriptor.leadingDots; i++) {
            name += '.';
        }

        return name + moduleDescriptor.nameParts.map(iden => iden).join('.');
    }
}
