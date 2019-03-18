/*
* pathUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Pathname utility functions.
*/

import * as fs from 'fs';
import * as path from 'path';
import Char from 'typescript-char';

export function forEachAncestorDirectory(directory: string, callback: (directory: string) => string | undefined): string | undefined {
    while (true) {
        const result = callback(directory);
        if (result !== undefined) {
            return result;
        }

        const parentPath = getDirectoryPath(directory);
        if (parentPath === directory) {
            return undefined;
        }

        directory = parentPath;
    }
}

export function getDirectoryPath(pathString: string): string {
    return pathString.substr(0, Math.max(getRootLength(pathString), pathString.lastIndexOf(path.sep)));
}

export function getRootLength(pathString: string): number {
    if (pathString.charAt(0) === path.sep) {
        if (pathString.charAt(1) !== path.sep) { return 1; }
        let p1 = pathString.indexOf(path.sep, 2);
        if (p1 < 0) { return 2; }
        let p2 = pathString.indexOf(path.sep, p1 + 1);
        if (p2 < 0) { return p1 + 1; }
        return p2 + 1;
    }
    if (pathString.charAt(1) === ':') {
        if (pathString.charAt(2) === path.sep) { return 3; }
    }
    return 0;
}

export function normalizeSlashes(pathString: string): string {
    const backslashRegExp = /\\/g;
    return pathString.replace(backslashRegExp, path.sep);
}

export function combinePaths(pathString: string, ...paths: (string | undefined)[]): string {
    if (pathString) {
        pathString = normalizeSlashes(pathString);
    }

    for (let relativePath of paths) {
        if (!relativePath) {
            continue;
        }

        relativePath = normalizeSlashes(relativePath);

        if (!pathString || getRootLength(relativePath) !== 0) {
            pathString = relativePath;
        } else {
            pathString = ensureTrailingDirectorySeparator(pathString) + relativePath;
        }
    }

    return pathString;
}

export function ensureTrailingDirectorySeparator(pathString: string): string {
    if (!hasTrailingDirectorySeparator(pathString)) {
        return pathString + path.sep;
    }

    return pathString;
}

export function hasTrailingDirectorySeparator(pathString: string) {
    if (pathString.length === 0) {
        return false;
    }

    const ch = pathString.charCodeAt(pathString.length - 1);
    return ch === Char.Slash || ch === Char.Backslash;
}

export function stripTrailingDirectorySeparator(pathString: string) {
    if (!hasTrailingDirectorySeparator(pathString)) {
        return pathString;
    }
    return pathString.substr(0, pathString.length - 1);
}

export function getFileExtension(fileName: string) {
    return path.extname(fileName);
}

export function getFileName(pathString: string) {
    return path.basename(pathString);
}

export function stripFileExtension(fileName: string) {
    let ext = path.extname(fileName);
    return fileName.substr(0, fileName.length - ext.length);
}

export function normalizePath(pathString: string): string {
    return path.normalize(pathString);
}

export interface FileSystemEntries {
    files: string[];
    directories: string[];
}

export function isDirectory(path: string): boolean {
    let stat: any;
    try {
        stat = fs.statSync(path);
    } catch (e) {
        return false;
    }

    return stat.isDirectory();
}

export function isFile(path: string): boolean {
    let stat: any;
    try {
        stat = fs.statSync(path);
    } catch (e) {
        return false;
    }

    return stat.isFile();
}

export function getFileSystemEntries(path: string): FileSystemEntries {
    try {
        const entries = fs.readdirSync(path || '.').sort();
        const files: string[] = [];
        const directories: string[] = [];
        for (const entry of entries) {
            // This is necessary because on some file system node fails to exclude
            // "." and "..". See https://github.com/nodejs/node/issues/4002
            if (entry === '.' || entry === '..') {
                continue;
            }
            const name = combinePaths(path, entry);

            let stat: any;
            try {
                stat = fs.statSync(name);
            } catch (e) {
                continue;
            }

            if (stat.isFile()) {
                files.push(entry);
            } else if (stat.isDirectory()) {
                directories.push(entry);
            }
        }
        return { files, directories };
    } catch (e) {
        return { files: [], directories: [] };
    }
}
