/*
 * pathUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Pathname utility functions.
 */

import path from 'path';
import { Char } from './charCodes';

/**
 * Returns length of the root part of a path (i.e. length of "/", "x:/", "//server/").
 */
export function getRootLength(pathString: string): number {
    if (pathString.charAt(0) === path.sep) {
        if (pathString.charAt(1) !== path.sep) {
            return 1; // POSIX: "/" (or non-normalized "\")
        }
        const p1 = pathString.indexOf(path.sep, 2);
        if (p1 < 0) {
            return pathString.length; // UNC: "//server" or "\\server"
        }
        return p1 + 1; // UNC: "//server/" or "\\server\"
    }
    if (pathString.charAt(1) === ':') {
        if (pathString.charAt(2) === path.sep) {
            return 3; // DOS: "c:/" or "c:\"
        }
        if (pathString.length === 2) {
            return 2; // DOS: "c:" (but not "c:d")
        }
    }

    return 0;
}

const getInvalidSeparator = (sep: string) => (sep === '/' ? '\\' : '/');
export function normalizeSlashes(pathString: string, sep = path.sep): string {
    if (pathString.includes(getInvalidSeparator(sep))) {
        const separatorRegExp = /[\\/]/g;
        return pathString.replace(separatorRegExp, sep);
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

export function normalizePath(pathString: string): string {
    return normalizeSlashes(path.normalize(pathString));
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

export function getRegexEscapedSeparator(pathSep: string = path.sep) {
    // we don't need to escape "/" in typescript regular expression
    return pathSep === '/' ? '/' : '\\\\';
}

export function deduplicateFolders(listOfFolders: string[][]): string[] {
    const foldersToWatch = new Set<string>();

    listOfFolders.forEach((folders) => {
        folders.forEach((p) => {
            if (foldersToWatch.has(p)) {
                // Bail out on exact match.
                return;
            }

            for (const existing of foldersToWatch) {
                // ex) p: "/user/test" existing: "/user"
                if (p.startsWith(existing)) {
                    // We already have the parent folder in the watch list
                    return;
                }

                // ex) p: "/user" folderToWatch: "/user/test"
                if (existing.startsWith(p)) {
                    // We found better one to watch. replace.
                    foldersToWatch.delete(existing);
                    foldersToWatch.add(p);
                    return;
                }
            }

            foldersToWatch.add(p);
        });
    });

    return [...foldersToWatch];
}
