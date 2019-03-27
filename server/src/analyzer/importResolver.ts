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
import { combinePaths, getDirectoryPath, getFileSystemEntries, isDirectory,
    isFile, stripFileExtension, stripTrailingDirectorySeparator } from '../common/pathUtils';
import { is3x, versionToString } from '../common/pythonVersion';
import { ImplicitImport, ImportResult, ImportType } from './importResult';

export interface ImportedModuleName {
    leadingDots: number;
    nameParts: string[];
}

export class ImportResolver {
    private _sourceFilePath: string;
    private _configOptions: ConfigOptions;
    private _executionEnvironment: ExecutionEnvironment;
    private _cachedSitePackagePath: string | undefined;

    constructor(sourceFilePath: string, configOptions: ConfigOptions, execEnv: ExecutionEnvironment) {
        this._sourceFilePath = sourceFilePath;
        this._configOptions = configOptions;
        this._executionEnvironment = execEnv;
    }

    // Resolves the import and returns the path if it exists, otherwise
    // returns undefined.
    resolveImport(moduleName: ImportedModuleName): ImportResult {
        let importName = this._formatImportName(moduleName);

        // Find the site packages for the configured virtual environment.
        if (this._cachedSitePackagePath === undefined) {
            this._cachedSitePackagePath = this._findSitePackagePath();
        }

        // Is it a built-in path?
        if (moduleName.leadingDots === 0 && moduleName.nameParts.length > 0) {
            // First check for a typeshed file.
            let builtInImport = this._findTypeshedPath(moduleName, importName, true);
            if (builtInImport) {
                builtInImport.isTypeshedFile = true;
                return builtInImport;
            }
        }

        // Is it a relative import?
        if (moduleName.leadingDots > 0) {
            let relativeImport = this._resolveRelativeImport(moduleName, importName);
            if (relativeImport) {
                return relativeImport;
            }
        } else {
            let bestResultSoFar: ImportResult | undefined;

            // Look for it in the root directory of the execution environment.
            let localImport = this._resolveAbsoluteImport(
                this._executionEnvironment.root, moduleName, importName);
            if (localImport && localImport.importFound) {
                return localImport;
            }
            bestResultSoFar = localImport;

            for (let i = 0; i < this._executionEnvironment.extraPaths.length; i++) {
                let extraPath = this._executionEnvironment.extraPaths[i];
                localImport = this._resolveAbsoluteImport(extraPath, moduleName, importName);
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
                    this._configOptions.typingsPath, moduleName, importName);
                if (typingsImport && typingsImport.importFound) {
                    return typingsImport;
                }
            }

            // Check for a typeshed file.
            let typeshedImport = this._findTypeshedPath(moduleName, importName, false);
            if (typeshedImport) {
                typeshedImport.isTypeshedFile = true;
                return typeshedImport;
            }

            // Look for the import in the list of third-party packages.
            if (this._cachedSitePackagePath) {
                // Allow partial resolution because some third-party packages
                // use tricks to populate their package namespaces.
                let thirdPartyImport = this._resolveAbsoluteImport(
                    this._cachedSitePackagePath, moduleName, importName, true);
                if (thirdPartyImport) {
                    thirdPartyImport.importType = ImportType.ThirdParty;
                    return thirdPartyImport;
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

    private _getTypeShedFallbackPath() {
        // Assume that the 'typeshed-fallback' directory is up one level
        // from this javascript file.
        const moduleDirectory = (global as any).__rootDirectory;
        if (moduleDirectory) {
            return combinePaths(getDirectoryPath(moduleDirectory), 'typeshed-fallback');
        }

        return undefined;
    }

    private _findTypeshedPath(moduleName: ImportedModuleName, importName: string,
            isStdLib: boolean): ImportResult | undefined {

        let typeshedPath = '';

        // Did the user specify a typeshed path? If not, we'll look in the
        // default virtual environment, then in the typeshed-fallback directory.
        if (this._configOptions.typeshedPath) {
            typeshedPath = this._configOptions.typeshedPath;
            if (!fs.existsSync(typeshedPath) || !isDirectory(typeshedPath)) {
                typeshedPath = '';
            }
        } else if (this._cachedSitePackagePath) {
            typeshedPath = combinePaths(this._cachedSitePackagePath, 'typeshed');
            if (!fs.existsSync(typeshedPath) || !isDirectory(typeshedPath)) {
                typeshedPath = '';
            }
        }

        // Should we apply the fallback?
        if (!typeshedPath) {
            typeshedPath = this._getTypeShedFallbackPath() || '';
        }

        typeshedPath = combinePaths(typeshedPath, isStdLib ? 'stdlib' : 'third_party');

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
                let importInfo = this._resolveAbsoluteImport(testPath, moduleName, importName);
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

    private _resolveRelativeImport(moduleName: ImportedModuleName, importName: string): ImportResult | undefined {
        // Determine which search path this file is part of.
        let curDir = getDirectoryPath(this._sourceFilePath);
        for (let i = 1; i < moduleName.leadingDots; i++) {
            // Make sure we don't walk out of the root directory.
            if (!curDir.startsWith(this._executionEnvironment.root)) {
                return undefined;
            }

            curDir = getDirectoryPath(curDir);
        }

        // Now try to match the module parts from the current directory location.
        return this._resolveAbsoluteImport(curDir, moduleName, importName);
    }

    // Follows import resolution algorithm defined in PEP-420:
    // https://www.python.org/dev/peps/pep-0420/
    private _resolveAbsoluteImport(rootPath: string, moduleName: ImportedModuleName,
            importName: string, allowPartial = false): ImportResult | undefined {

        // Starting at the specified path, walk the file system to find the
        // specified module.
        let resolvedPaths: string[] = [];
        let dirPath = rootPath;
        let isNamespacePackage = false;
        let isStubFile = false;
        let implicitImports: ImplicitImport[] = [];

        for (let i = 0; i < moduleName.nameParts.length; i++) {
            dirPath = combinePaths(dirPath, moduleName.nameParts[i]);
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
                if (i === moduleName.nameParts.length - 1) {
                    isNamespacePackage = true;
                }
            }

            if (i === moduleName.nameParts.length - 1) {
                implicitImports = this._findImplicitImports(
                    dirPath, [pyFilePath, pyiFilePath]);
            }
        }

        let importFound: boolean;
        if (allowPartial) {
            importFound = resolvedPaths.length > 0;
        } else {
            importFound = resolvedPaths.length === moduleName.nameParts.length;

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

    private _findImplicitImports(dirPath: string, exclusions: string[]): ImplicitImport[] {
        let implicitImportMap: { [name: string]: ImplicitImport } = {};

        let entries = getFileSystemEntries(dirPath);
        for (let fileName of entries.files) {
            if (fileName.endsWith('.py') || fileName.endsWith('.pyi')) {
                let filePath = combinePaths(dirPath, fileName);

                if (!exclusions.find(exclusion => exclusion === filePath)) {
                    let implicitImport: ImplicitImport = {
                        isStubFile: fileName.endsWith('.pyi'),
                        name: stripFileExtension(fileName),
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
                let implicitImport: ImplicitImport = {
                    isStubFile,
                    name: dirName,
                    path
                };

                implicitImportMap[implicitImport.name] = implicitImport;
            }
        }

        return Object.keys(implicitImportMap).map(key => implicitImportMap[key]);
    }

    private _findSitePackagePath(): string | undefined {
        let pythonPath: string | undefined;
        if (this._executionEnvironment.venv) {
            if (this._configOptions.venvPath) {
                pythonPath = combinePaths(this._configOptions.venvPath, this._executionEnvironment.venv);
            }
        } else if (this._configOptions.defaultVenv) {
            if (this._configOptions.venvPath) {
                pythonPath = combinePaths(this._configOptions.venvPath, this._configOptions.defaultVenv);
            }
        } else {
            pythonPath = this._configOptions.pythonPath;
        }

        if (!pythonPath) {
            return undefined;
        }

        let libPath = combinePaths(pythonPath, 'lib');
        let sitePackagesPath = combinePaths(libPath, 'site-packages');
        if (fs.existsSync(sitePackagesPath)) {
            return sitePackagesPath;
        }

        // We didn't find a site-packages directory directly in the lib
        // directory. Scan for a "python*" directory instead.
        let entries = getFileSystemEntries(libPath);
        for (let i = 0; i < entries.directories.length; i++) {
            let dirName = entries.directories[i];
            if (dirName.startsWith('python')) {
                let dirPath = combinePaths(libPath, dirName, 'site-packages');
                if (fs.existsSync(dirPath)) {
                    return dirPath;
                }
            }
        }

        return undefined;
    }

    private _formatImportName(moduleName: ImportedModuleName) {
        let name = '';
        for (let i = 0; i < moduleName.leadingDots; i++) {
            name += '.';
        }

        return name + moduleName.nameParts.map(iden => iden).join('.');
    }
}
