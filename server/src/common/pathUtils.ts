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
import { URI } from 'vscode-uri';

export interface FileSpec {
    // File specs can contain wildcard characters (**, *, ?). This
    // specifies the first portion of the file spec that contains
    // no wildcards.
    wildcardRoot: string;

    // Regular expression that can be used to match against this
    // file spec.
    regExp: RegExp;
}

export interface FileSystemEntries {
    files: string[];
    directories: string[];
}

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
        const p1 = pathString.indexOf(path.sep, 2);
        if (p1 < 0) { return 2; }
        const p2 = pathString.indexOf(path.sep, p1 + 1);
        if (p2 < 0) { return p1 + 1; }
        return p2 + 1;
    }
    if (pathString.charAt(1) === ':') {
        if (pathString.charAt(2) === path.sep) { return 3; }
    }
    return 0;
}

export function getPathComponents(pathString: string) {
    const normalizedPath = normalizeSlashes(pathString);
    const rootLength = getRootLength(normalizedPath);
    const root = normalizedPath.substring(0, rootLength);
    const rest = normalizedPath.substring(rootLength).split(path.sep);
    if (rest.length > 0 && !rest[rest.length - 1]) {
        rest.pop();
    }

    const components = [root, ...rest];
    const reduced = [components[0]];

    // Reduce the path components by eliminating
    // any '.' or '..'.
    for (let i = 1; i < components.length; i++) {
        const component = components[i];
        if (!component || component === '.') {
            continue;
        }

        if (component === '..') {
            if (reduced.length > 1) {
                if (reduced[reduced.length - 1] !== '..') {
                    reduced.pop();
                    continue;
                }
            } else if (reduced[0]) {
                continue;
            }
        }
        reduced.push(component);
    }

    return reduced;
}

export function getRelativePath(dirPath: string, relativeTo: string) {
    if (!dirPath.startsWith(ensureTrailingDirectorySeparator(relativeTo))) {
        return undefined;
    }

    const pathComponents = getPathComponents(dirPath);
    const relativeToComponents = getPathComponents(relativeTo);

    let relativePath = '.';
    for (let i = relativeToComponents.length; i < pathComponents.length; i++) {
        relativePath += path.sep + pathComponents[i];
    }

    return relativePath;
}

// Creates a directory hierarchy for a path, starting from some ancestor path.
export function makeDirectories(dirPath: string, startingFromDirPath: string) {
    if (!dirPath.startsWith(startingFromDirPath)) {
        return;
    }

    const pathComponents = getPathComponents(dirPath);
    const relativeToComponents = getPathComponents(startingFromDirPath);
    let curPath = startingFromDirPath;

    for (let i = relativeToComponents.length; i < pathComponents.length; i++) {
        curPath = combinePaths(curPath, pathComponents[i]);
        if (!fs.existsSync(curPath)) {
            fs.mkdirSync(curPath);
        }
    }
}

export function normalizeSlashes(pathString: string): string {
    const separatorRegExp = /[\\/]/g;
    return pathString.replace(separatorRegExp, path.sep);
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
    const ext = path.extname(fileName);
    return fileName.substr(0, fileName.length - ext.length);
}

export function normalizePath(pathString: string): string {
    return normalizeSlashes(path.normalize(pathString));
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

// Transforms a relative file spec (one that potentially contains
// escape characters **, * or ?) and returns a regular expression
// that can be used for matching against.
export function getWildcardRegexPattern(rootPath: string, fileSpec: string): string {
    let absolutePath = normalizePath(combinePaths(rootPath, fileSpec));
    if (!absolutePath.endsWith('.py') && !absolutePath.endsWith('.pyi')) {
        absolutePath = ensureTrailingDirectorySeparator(absolutePath);
    }

    const pathComponents = getPathComponents(absolutePath);
    const doubleAsteriskRegexFragment = `(/[^/.][^/]*)*?`;
    const reservedCharacterPattern = /[^\w\s/]/g;

    // Strip the directory separator from the root component.
    if (pathComponents.length > 0) {
        pathComponents[0] = stripTrailingDirectorySeparator(pathComponents[0]);
    }
    let regExPattern = '';
    let firstComponent = true;

    for (let component of pathComponents) {
        if (component === '**') {
            regExPattern += doubleAsteriskRegexFragment;
        } else {
            if (!firstComponent) {
                component = path.sep + component;
            }

            regExPattern += component.replace(
                reservedCharacterPattern, match => {
                    if (match === '*') {
                        return '[^/]*';
                    } else if (match === '?') {
                        return '[^/]';
                    } else {
                        return '\\' + match;
                    }
                });

            firstComponent = false;
        }
    }

    return regExPattern;
}

// Returns the topmost path that contains no wildcard characters.
export function getWildcardRoot(rootPath: string, fileSpec: string): string {
    let absolutePath = normalizePath(combinePaths(rootPath, fileSpec));
    if (!absolutePath.endsWith('.py') && !absolutePath.endsWith('.pyi')) {
        absolutePath = ensureTrailingDirectorySeparator(absolutePath);
    }

    const pathComponents = getPathComponents(absolutePath);

    // Strip the directory separator from the root component.
    if (pathComponents.length > 0) {
        pathComponents[0] = stripTrailingDirectorySeparator(pathComponents[0]);
    }

    let wildcardRoot = '';
    let firstComponent = true;

    for (let component of pathComponents) {
        if (component === '**') {
            break;
        } else {
            if (component.match(/[*?]/)) {
                break;
            }

            if (!firstComponent) {
                component = path.sep + component;
            }

            wildcardRoot += component;
            firstComponent = false;
        }
    }

    return wildcardRoot;
}

export function getFileSpec(rootPath: string, fileSpec: string): FileSpec {
    let regExPattern = getWildcardRegexPattern(rootPath, fileSpec);
    const escapedSeparator = path.sep === '/' ? '/' : '\\\\';
    regExPattern = `^(${ regExPattern })($|${ escapedSeparator })`;

    const regExp = new RegExp(regExPattern);
    const wildcardRoot = getWildcardRoot(rootPath, fileSpec);

    return {
        wildcardRoot,
        regExp
    };
}

export function convertUriToPath(uriString: string): string {
    const uri = URI.parse(uriString);
    let convertedPath = normalizePath(uri.path);
    // If this is a DOS-style path with a drive letter, remove
    // the leading slash.
    if (convertedPath.match(/^\\[a-zA-Z]:\\/)) {
        convertedPath = convertedPath.substr(1);
    }
    return convertedPath;
}

export function convertPathToUri(path: string): string {
  return URI.file(path).toString();
}
