/*
 * pythonPathUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Utility routines used to resolve various paths in python.
 */

import { ConfigOptions } from '../common/configOptions';
import { compareComparableValues } from '../common/core';
import { FileSystem } from '../common/fileSystem';
import { Host } from '../common/host';
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

export interface PythonPathResult {
    paths: string[];
    prefix: string;
}

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
    host: Host,
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
    const pathResult = host.getPythonSearchPaths(configOptions.pythonPath, importFailureInfo);
    if (includeWatchPathsOnly && workspaceRoot) {
        const paths = pathResult.paths.filter(
            (p) => !containsPath(workspaceRoot, p, true) || containsPath(pathResult.prefix, p, true)
        );

        return paths;
    }

    return pathResult.paths;
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

    return undefined;
}

export function getPathsFromPthFiles(fs: FileSystem, parentDir: string): string[] {
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
