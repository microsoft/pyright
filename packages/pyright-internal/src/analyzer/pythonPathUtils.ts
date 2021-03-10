/*
 * pythonPathUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Utility routines used to resolve various paths in python.
 */

import * as child_process from 'child_process';

import { ConfigOptions } from '../common/configOptions';
import { compareComparableValues } from '../common/core';
import { FileSystem } from '../common/fileSystem';
import * as pathConsts from '../common/pathConsts';
import {
    combinePaths,
    containsPath,
    ensureTrailingDirectorySeparator,
    getDirectoryPath,
    getFileSystemEntries,
    isDirectory,
    normalizePath,
    tryStat,
} from '../common/pathUtils';

interface PythonPathResult {
    paths: string[];
    prefix: string;
}

const cachedSearchPaths = new Map<string, PythonPathResult>();

const extractSys = [
    'import os, os.path, sys',
    'normalize = lambda p: os.path.normcase(os.path.normpath(p))',
    'cwd = normalize(os.getcwd())',
    'sys.path[:] = (p for p in sys.path if p != "" and normalize(p) != cwd)',
    'import json',
    'json.dump(dict(path=sys.path, prefix=sys.prefix), sys.stdout)',
].join('; ');

export const stdLibFolderName = 'stdlib';
export const thirdPartyFolderName = 'stubs';

export function getTypeShedFallbackPath(fs: FileSystem) {
    let moduleDirectory = fs.getModulePath();
    if (!moduleDirectory) {
        return undefined;
    }

    moduleDirectory = getDirectoryPath(ensureTrailingDirectorySeparator(normalizePath(moduleDirectory)));

    const typeshedPath = combinePaths(moduleDirectory, pathConsts.typeshedFallback);
    if (fs.existsSync(typeshedPath)) {
        return typeshedPath;
    }

    // In the debug version of Pyright, the code is one level
    // deeper, so we need to look one level up for the typeshed fallback.
    const debugTypeshedPath = combinePaths(getDirectoryPath(moduleDirectory), pathConsts.typeshedFallback);
    if (fs.existsSync(debugTypeshedPath)) {
        return debugTypeshedPath;
    }

    return undefined;
}

export function getTypeshedSubdirectory(typeshedPath: string, isStdLib: boolean) {
    return combinePaths(typeshedPath, isStdLib ? stdLibFolderName : thirdPartyFolderName);
}

export function findPythonSearchPaths(
    fs: FileSystem,
    configOptions: ConfigOptions,
    importFailureInfo: string[],
    includeWatchPathsOnly?: boolean | undefined,
    workspaceRoot?: string | undefined
): string[] | undefined {
    importFailureInfo.push('Finding python search paths');

    if (configOptions.venvPath !== undefined && configOptions.venv) {
        const venvDir = configOptions.venv;
        const venvPath = combinePaths(configOptions.venvPath, venvDir);

        const foundPaths: string[] = [];
        const sitePackagesPaths: string[] = [];

        [pathConsts.lib, pathConsts.lib64, pathConsts.libAlternate].forEach((libPath) => {
            const sitePackagesPath = findSitePackagesPath(fs, combinePaths(venvPath, libPath), importFailureInfo);
            if (sitePackagesPath) {
                addPathIfUnique(foundPaths, sitePackagesPath);
                sitePackagesPaths.push(sitePackagesPath);
            }
        });

        // Now add paths from ".pth" files located in each of the site packages folders.
        sitePackagesPaths.forEach((sitePackagesPath) => {
            const pthPaths = getPathsFromPthFiles(fs, sitePackagesPath);
            pthPaths.forEach((path) => {
                addPathIfUnique(foundPaths, path);
            });
        });

        if (foundPaths.length > 0) {
            importFailureInfo.push(`Found the following '${pathConsts.sitePackages}' dirs`);
            foundPaths.forEach((path) => {
                importFailureInfo.push(`  ${path}`);
            });
            return foundPaths;
        }

        importFailureInfo.push(
            `Did not find any '${pathConsts.sitePackages}' dirs. Falling back on python interpreter.`
        );
    }

    // Fall back on the python interpreter.
    const pathResult = getPythonPathFromPythonInterpreter(fs, configOptions.pythonPath, importFailureInfo);
    if (includeWatchPathsOnly && workspaceRoot) {
        const paths = pathResult.paths.filter(
            (p) => !containsPath(workspaceRoot, p, true) || containsPath(pathResult.prefix, p, true)
        );

        return paths;
    }

    return pathResult.paths;
}

export function getPythonPathFromPythonInterpreter(
    fs: FileSystem,
    interpreterPath: string | undefined,
    importFailureInfo: string[]
): PythonPathResult {
    const searchKey = interpreterPath || '';

    // If we've seen this request before, return the cached results.
    const cachedPath = cachedSearchPaths.get(searchKey);
    if (cachedPath) {
        return cachedPath;
    }

    let result: PythonPathResult | undefined;

    if (interpreterPath) {
        result = getPathResultFromInterpreter(fs, interpreterPath, importFailureInfo);
    } else {
        // On non-Windows platforms, always default to python3 first. We want to
        // avoid this on Windows because it might invoke a script that displays
        // a dialog box indicating that python can be downloaded from the app store.
        if (process.platform !== 'win32') {
            result = getPathResultFromInterpreter(fs, 'python3', importFailureInfo);
        }

        // On some platforms, 'python3' might not exist. Try 'python' instead.
        if (!result) {
            result = getPathResultFromInterpreter(fs, 'python', importFailureInfo);
        }
    }

    if (!result) {
        result = {
            paths: [],
            prefix: '',
        };
    }

    cachedSearchPaths.set(searchKey, result);
    importFailureInfo.push(`Received ${result.paths.length} paths from interpreter`);
    result.paths.forEach((path) => {
        importFailureInfo.push(`  ${path}`);
    });

    return result;
}

export function isPythonBinary(p: string): boolean {
    p = p.trim();
    return p === 'python' || p === 'python3';
}

function findSitePackagesPath(fs: FileSystem, libPath: string, importFailureInfo: string[]): string | undefined {
    if (fs.existsSync(libPath)) {
        importFailureInfo.push(`Found path '${libPath}'; looking for ${pathConsts.sitePackages}`);
    } else {
        importFailureInfo.push(`Did not find '${libPath}'`);
        return undefined;
    }

    const sitePackagesPath = combinePaths(libPath, pathConsts.sitePackages);
    if (fs.existsSync(sitePackagesPath)) {
        importFailureInfo.push(`Found path '${sitePackagesPath}'`);
        return sitePackagesPath;
    } else {
        importFailureInfo.push(`Did not find '${sitePackagesPath}', so looking for python subdirectory`);
    }

    // We didn't find a site-packages directory directly in the lib
    // directory. Scan for a "python*" directory instead.
    const entries = getFileSystemEntries(fs, libPath);
    for (let i = 0; i < entries.directories.length; i++) {
        const dirName = entries.directories[i];
        if (dirName.startsWith('python')) {
            const dirPath = combinePaths(libPath, dirName, pathConsts.sitePackages);
            if (fs.existsSync(dirPath)) {
                importFailureInfo.push(`Found path '${dirPath}'`);
                return dirPath;
            } else {
                importFailureInfo.push(`Path '${dirPath}' is not a valid directory`);
            }
        }
    }
}

function getPathResultFromInterpreter(
    fs: FileSystem,
    interpreter: string,
    importFailureInfo: string[]
): PythonPathResult | undefined {
    const result: PythonPathResult = {
        paths: [],
        prefix: '',
    };

    try {
        const commandLineArgs: string[] = ['-c', extractSys];

        importFailureInfo.push(`Executing interpreter: '${interpreter}'`);
        const execOutput = child_process.execFileSync(interpreter, commandLineArgs, { encoding: 'utf8' });

        // Parse the execOutput. It should be a JSON-encoded array of paths.
        try {
            const execSplit = JSON.parse(execOutput);
            for (let execSplitEntry of execSplit.path) {
                execSplitEntry = execSplitEntry.trim();
                if (execSplitEntry) {
                    const normalizedPath = normalizePath(execSplitEntry);
                    // Make sure the path exists and is a directory. We don't currently
                    // support zip files and other formats.
                    if (fs.existsSync(normalizedPath) && isDirectory(fs, normalizedPath)) {
                        result.paths.push(normalizedPath);
                    } else {
                        importFailureInfo.push(`Skipping '${normalizedPath}' because it is not a valid directory`);
                    }
                }
            }

            result.prefix = execSplit.prefix;

            if (result.paths.length === 0) {
                importFailureInfo.push(`Found no valid directories`);
            }
        } catch (err) {
            importFailureInfo.push(`Could not parse output: '${execOutput}'`);
            throw err;
        }
    } catch {
        return undefined;
    }

    return result;
}

function getPathsFromPthFiles(fs: FileSystem, parentDir: string): string[] {
    const searchPaths: string[] = [];

    // Get a list of all *.pth files within the specified directory.
    const pthFiles = fs
        .readdirEntriesSync(parentDir)
        .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith('.pth'))
        .sort((a, b) => compareComparableValues(a.name, b.name));

    pthFiles.forEach((pthFile) => {
        const filePath = combinePaths(parentDir, pthFile.name);
        const fileStats = tryStat(fs, filePath);

        // Skip all files that are much larger than expected.
        if (fileStats?.isFile() && fileStats.size > 0 && fileStats.size < 64 * 1024) {
            const data = fs.readFileSync(filePath, 'utf8');
            const lines = data.split(/\r?\n/);
            lines.forEach((line) => {
                const trimmedLine = line.trim();
                if (trimmedLine.length > 0 && !trimmedLine.startsWith('#') && !trimmedLine.match(/^import\s/)) {
                    const pthPath = combinePaths(parentDir, trimmedLine);
                    if (fs.existsSync(pthPath) && isDirectory(fs, pthPath)) {
                        searchPaths.push(pthPath);
                    }
                }
            });
        }
    });

    return searchPaths;
}

function addPathIfUnique(pathList: string[], pathToAdd: string) {
    if (!pathList.some((path) => path === pathToAdd)) {
        pathList.push(pathToAdd);
        return true;
    }

    return false;
}
