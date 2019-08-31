/*
* pythonPathUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Utility routines used to resolve various paths in python.
*/

import * as child_process from 'child_process';
import * as fs from 'fs';

import { ConfigOptions } from '../common/configOptions';
import { combinePaths, ensureTrailingDirectorySeparator, getDirectoryPath,
    getFileSystemEntries, isDirectory, normalizePath } from '../common/pathUtils';

const cachedSearchPaths: { [path: string]: string[] } = {};

export class PythonPathUtils {
    static getTypeShedFallbackPath() {
        // The entry point to the tool should have set the __rootDirectory
        // global variable to point to the directory that contains the
        // typeshed-fallback directory.
        let moduleDirectory = (global as any).__rootDirectory;
        if (moduleDirectory) {
            moduleDirectory = normalizePath(moduleDirectory);
            return combinePaths(getDirectoryPath(
                ensureTrailingDirectorySeparator(moduleDirectory)),
                'typeshed-fallback');
        }

        return undefined;
    }

    static getTypeshedSubdirectory(typeshedPath: string, isStdLib: boolean) {
        return combinePaths(typeshedPath, isStdLib ? 'stdlib' : 'third_party');
    }

    static findPythonSearchPaths(configOptions: ConfigOptions, venv: string | undefined,
            importFailureInfo: string[]): string[] | undefined {

        importFailureInfo.push('Finding python search paths');

        let venvPath: string | undefined;
        if (venv !== undefined) {
            if (configOptions.venvPath) {
                venvPath = combinePaths(configOptions.venvPath, venv);
            }
        } else if (configOptions.defaultVenv) {
            if (configOptions.venvPath) {
                venvPath = combinePaths(configOptions.venvPath, configOptions.defaultVenv);
            }
        }

        if (venvPath) {
            let libPath = combinePaths(venvPath, 'lib');
            if (fs.existsSync(libPath)) {
                importFailureInfo.push(`Found path '${ libPath }'; looking for site-packages`);
            } else {
                importFailureInfo.push(`Did not find '${ libPath }'; trying 'Lib' instead`);
                libPath = combinePaths(venvPath, 'Lib');
                if (fs.existsSync(libPath)) {
                    importFailureInfo.push(`Found path '${ libPath }'; looking for site-packages`);
                } else {
                    importFailureInfo.push(`Did not find '${ libPath }'`);
                    libPath = '';
                }
            }

            if (libPath) {
                const sitePackagesPath = combinePaths(libPath, 'site-packages');
                if (fs.existsSync(sitePackagesPath)) {
                    importFailureInfo.push(`Found path '${ sitePackagesPath }'`);
                    return [sitePackagesPath];
                } else {
                    importFailureInfo.push(`Did not find '${ sitePackagesPath }', so looking for python subdirectory`);
                }

                // We didn't find a site-packages directory directly in the lib
                // directory. Scan for a "python*" directory instead.
                const entries = getFileSystemEntries(libPath);
                for (let i = 0; i < entries.directories.length; i++) {
                    const dirName = entries.directories[i];
                    if (dirName.startsWith('python')) {
                        const dirPath = combinePaths(libPath, dirName, 'site-packages');
                        if (fs.existsSync(dirPath)) {
                            importFailureInfo.push(`Found path '${ dirPath }'`);
                            return [dirPath];
                        } else {
                            importFailureInfo.push(`Path '${ dirPath }' is not a valid directory`);
                        }
                    }
                }
            }

            importFailureInfo.push(`Did not find site-packages. Falling back on python interpreter.`);
        }

        // Fall back on the python interpreter.
        return this.getPythonPathFromPythonInterpreter(configOptions.pythonPath, importFailureInfo);
    }

    static getPythonPathFromPythonInterpreter(interpreterPath: string | undefined,
            importFailureInfo: string[]): string[] {

        const searchKey = interpreterPath || '';

        // If we've seen this request before, return the cached results.
        if (cachedSearchPaths[searchKey]) {
            return cachedSearchPaths[searchKey];
        }

        let pythonPaths: string[] = [];

        try {
            const commandLineArgs: string[] = ['-c', 'import sys; print(sys.path)'];
            let execOutput: string;

            if (interpreterPath) {
                importFailureInfo.push(`Executing interpreter at '${ interpreterPath }'`);
                execOutput = child_process.execFileSync(
                    interpreterPath, commandLineArgs, { encoding: 'utf8' });
            } else {
                importFailureInfo.push(`Executing python interpreter`);
                execOutput = child_process.execFileSync(
                    'python', commandLineArgs, { encoding: 'utf8' });
            }

            // Parse the execOutput. It should be an array of paths.
            execOutput = execOutput.trim();
            if (execOutput.startsWith('[') && execOutput.endsWith(']')) {
                execOutput = execOutput.substr(1, execOutput.length - 2);

                const execSplit = execOutput.split(',');

                for (let execSplitEntry of execSplit) {
                    execSplitEntry = execSplitEntry.trim();
                    if (execSplitEntry.length >= 2 && execSplitEntry.startsWith('\'') &&
                            execSplitEntry.endsWith('\'')) {
                        execSplitEntry = execSplitEntry.substr(1, execSplitEntry.length - 2);
                    }

                    if (execSplitEntry) {
                        const normalizedPath = normalizePath(execSplitEntry);
                        // Make sure the path exists and is a directory. We don't currently
                        // support zip files and other formats.
                        if (fs.existsSync(normalizedPath) && isDirectory(normalizedPath)) {
                            pythonPaths.push(normalizedPath);
                        } else {
                            importFailureInfo.push(`Skipping '${ normalizedPath }' because it is not a valid directory`);
                        }
                    }
                }

                if (pythonPaths.length === 0) {
                    importFailureInfo.push(`Found no valid directories`);
                }
            } else {
                importFailureInfo.push(`Could not parse output: '${ execOutput }'`);
            }
        } catch {
            pythonPaths = [];
        }

        cachedSearchPaths[searchKey] = pythonPaths;
        importFailureInfo.push(`Received ${ pythonPaths.length } paths from interpreter`);
        pythonPaths.forEach(path => {
            importFailureInfo.push(`  ${ path }`);
        });
        return pythonPaths;
    }
}
