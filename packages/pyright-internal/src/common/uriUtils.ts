/*
 * uriUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Utility functions for manipulating URIs.
 */

import type { Dirent } from 'fs';

import { randomBytesHex } from './crypto';
import { ServiceProvider } from './extensibility';
import { FileSystem, ReadOnlyFileSystem, Stats, TempFile } from './fileSystem';
import { getRegexEscapedSeparator, isDirectoryWildcardPatternPresent } from './pathUtils';
import { ServiceKeys } from './serviceProviderExtensions';
import { Uri } from './uri';

let _fsCaseSensitivity: boolean | undefined = undefined;
let _underTest: boolean = false;

export interface FileSpec {
    // File specs can contain wildcard characters (**, *, ?). This
    // specifies the first portion of the file spec that contains
    // no wildcards.
    wildcardRoot: Uri;

    // Regular expression that can be used to match against this
    // file spec.
    regExp: RegExp;

    // Indicates whether the file spec has a directory wildcard (**).
    // When present, the search cannot terminate without exploring to
    // an arbitrary depth.
    hasDirectoryWildcard: boolean;
}

const _includeFileRegex = /\.pyi?$/;

export namespace FileSpec {
    export function is(value: any): value is FileSpec {
        const candidate: FileSpec = value as FileSpec;
        return candidate && !!candidate.wildcardRoot && !!candidate.regExp;
    }
    export function isInPath(uri: Uri, paths: FileSpec[]) {
        return !!paths.find((p) => uri.matchesRegex(p.regExp));
    }

    export function matchesIncludeFileRegex(uri: Uri, isFile = true) {
        return isFile ? uri.matchesRegex(_includeFileRegex) : true;
    }

    export function matchIncludeFileSpec(includeRegExp: RegExp, exclude: FileSpec[], uri: Uri, isFile = true) {
        if (uri.matchesRegex(includeRegExp)) {
            if (!FileSpec.isInPath(uri, exclude) && FileSpec.matchesIncludeFileRegex(uri, isFile)) {
                return true;
            }
        }

        return false;
    }
}

export interface FileSystemEntries {
    files: Uri[];
    directories: Uri[];
}

export function forEachAncestorDirectory(
    directory: Uri,
    callback: (directory: Uri) => Uri | undefined
): Uri | undefined {
    while (true) {
        const result = callback(directory);
        if (result !== undefined) {
            return result;
        }

        const parentPath = directory.getDirectory();
        if (parentPath === directory) {
            return undefined;
        }

        directory = parentPath;
    }
}

// Creates a directory hierarchy for a path, starting from some ancestor path.
export function makeDirectories(fs: FileSystem, dir: Uri, startingFrom: Uri) {
    if (!dir.startsWith(startingFrom)) {
        return;
    }

    const pathComponents = dir.getPathComponents();
    const relativeToComponents = startingFrom.getPathComponents();
    let curPath = startingFrom;

    for (let i = relativeToComponents.length; i < pathComponents.length; i++) {
        curPath = curPath.combinePaths(pathComponents[i]);
        if (!fs.existsSync(curPath)) {
            fs.mkdirSync(curPath);
        }
    }
}

export function getFileSize(fs: ReadOnlyFileSystem, uri: Uri) {
    const stat = tryStat(fs, uri);
    if (stat?.isFile()) {
        return stat.size;
    }
    return 0;
}

export function fileExists(fs: ReadOnlyFileSystem, uri: Uri): boolean {
    return fileSystemEntryExists(fs, uri, FileSystemEntryKind.File);
}

export function directoryExists(fs: ReadOnlyFileSystem, uri: Uri): boolean {
    return fileSystemEntryExists(fs, uri, FileSystemEntryKind.Directory);
}

export function isDirectory(fs: ReadOnlyFileSystem, uri: Uri): boolean {
    return tryStat(fs, uri)?.isDirectory() ?? false;
}

export function isFile(fs: ReadOnlyFileSystem, uri: Uri, treatZipDirectoryAsFile = false): boolean {
    const stats = tryStat(fs, uri);
    if (stats?.isFile()) {
        return true;
    }

    if (!treatZipDirectoryAsFile) {
        return false;
    }

    return stats?.isZipDirectory?.() ?? false;
}

export function tryStat(fs: ReadOnlyFileSystem, uri: Uri): Stats | undefined {
    try {
        if (fs.existsSync(uri)) {
            return fs.statSync(uri);
        }
    } catch (e: any) {
        return undefined;
    }
    return undefined;
}

export function tryRealpath(fs: ReadOnlyFileSystem, uri: Uri): Uri | undefined {
    try {
        return fs.realCasePath(uri);
    } catch (e: any) {
        return undefined;
    }
}

export function getFileSystemEntries(fs: ReadOnlyFileSystem, uri: Uri): FileSystemEntries {
    try {
        return getFileSystemEntriesFromDirEntries(fs.readdirEntriesSync(uri), fs, uri);
    } catch (e: any) {
        return { files: [], directories: [] };
    }
}

// Sorts the entires into files and directories, including any symbolic links.
export function getFileSystemEntriesFromDirEntries(
    dirEntries: Dirent[],
    fs: ReadOnlyFileSystem,
    uri: Uri
): FileSystemEntries {
    const entries = dirEntries.sort((a, b) => {
        if (a.name < b.name) {
            return -1;
        } else if (a.name > b.name) {
            return 1;
        } else {
            return 0;
        }
    });
    const files: Uri[] = [];
    const directories: Uri[] = [];
    for (const entry of entries) {
        // This is necessary because on some file system node fails to exclude
        // "." and "..". See https://github.com/nodejs/node/issues/4002
        if (entry.name === '.' || entry.name === '..') {
            continue;
        }

        const entryUri = uri.combinePaths(entry.name);
        if (entry.isFile()) {
            files.push(entryUri);
        } else if (entry.isDirectory()) {
            directories.push(entryUri);
        } else if (entry.isSymbolicLink()) {
            const stat = tryStat(fs, entryUri);
            if (stat?.isFile()) {
                files.push(entryUri);
            } else if (stat?.isDirectory()) {
                directories.push(entryUri);
            }
        }
    }
    return { files, directories };
}

export function setTestingMode(underTest: boolean) {
    _underTest = underTest;
}

// Transforms a relative file spec (one that potentially contains
// escape characters **, * or ?) and returns a regular expression
// that can be used for matching against.
export function getWildcardRegexPattern(root: Uri, fileSpec: string): string {
    let absolutePath = root.combinePaths(fileSpec);
    if (!hasPythonExtension(absolutePath)) {
        absolutePath = absolutePath.combinePaths('/');
    }

    const pathComponents = absolutePath.getPathComponents();
    const escapedSeparator = getRegexEscapedSeparator('/');
    const doubleAsteriskRegexFragment = `(${escapedSeparator}[^${escapedSeparator}][^${escapedSeparator}]*)*?`;
    const reservedCharacterPattern = new RegExp(`[^\\w\\s${escapedSeparator}]`, 'g');

    let regExPattern = '';
    let firstComponent = true;

    for (let component of pathComponents) {
        if (component === '**') {
            regExPattern += doubleAsteriskRegexFragment;
        } else {
            if (!firstComponent) {
                component = escapedSeparator + component;
            }

            regExPattern += component.replace(reservedCharacterPattern, (match) => {
                if (match === '*') {
                    return `[^${escapedSeparator}]*`;
                } else if (match === '?') {
                    return `[^${escapedSeparator}]`;
                } else {
                    // escaping anything that is not reserved characters - word/space/separator
                    return '\\' + match;
                }
            });

            firstComponent = false;
        }
    }

    return regExPattern;
}

// Returns the topmost path that contains no wildcard characters.
export function getWildcardRoot(root: Uri, fileSpec: string): Uri {
    let absolutePath = root.combinePaths(fileSpec);
    if (!hasPythonExtension(absolutePath)) {
        absolutePath = absolutePath.combinePaths('/');
    }

    const pathComponents = absolutePath.getPathComponents();
    let wildcardRoot = absolutePath.root;

    if (pathComponents.length === 1 && !pathComponents[0]) {
        return wildcardRoot;
    }

    let firstComponent = true;

    for (let component of pathComponents) {
        if (component === '**') {
            break;
        } else {
            if (/[*?]/.test(component)) {
                break;
            }

            if (!firstComponent) {
                component = '/' + component;
            }

            wildcardRoot = wildcardRoot.combinePaths(component);
            firstComponent = false;
        }
    }

    return wildcardRoot;
}

export function hasPythonExtension(uri: Uri) {
    return uri.extname === '.py' || uri.extname === '.pyi';
}

export function getFileSpec(sp: ServiceProvider, root: Uri, fileSpec: string): FileSpec {
    let regExPattern = getWildcardRegexPattern(root, fileSpec);
    const escapedSeparator = getRegexEscapedSeparator('/');
    regExPattern = `^(${regExPattern})($|${escapedSeparator})`;

    const fs = sp.get(ServiceKeys.fs);
    const tmp = sp.tryGet(ServiceKeys.tempFile);

    const regExp = new RegExp(regExPattern, isFileSystemCaseSensitive(fs, tmp) ? undefined : 'i');
    const wildcardRoot = getWildcardRoot(root, fileSpec);
    const hasDirectoryWildcard = isDirectoryWildcardPatternPresent(fileSpec);

    return {
        wildcardRoot,
        regExp,
        hasDirectoryWildcard,
    };
}

const enum FileSystemEntryKind {
    File,
    Directory,
}

function fileSystemEntryExists(fs: ReadOnlyFileSystem, uri: Uri, entryKind: FileSystemEntryKind): boolean {
    try {
        const stat = fs.statSync(uri);
        switch (entryKind) {
            case FileSystemEntryKind.File:
                return stat.isFile();
            case FileSystemEntryKind.Directory:
                return stat.isDirectory();
            default:
                return false;
        }
    } catch (e: any) {
        return false;
    }
}

const isFileSystemCaseSensitiveMap = new WeakMap<FileSystem, boolean>();

export function isFileSystemCaseSensitive(fs: FileSystem, tmp?: TempFile) {
    if (!tmp) {
        return false;
    }

    if (!_underTest && _fsCaseSensitivity !== undefined) {
        return _fsCaseSensitivity;
    }

    if (!isFileSystemCaseSensitiveMap.has(fs)) {
        _fsCaseSensitivity = isFileSystemCaseSensitiveInternal(fs, tmp);
        isFileSystemCaseSensitiveMap.set(fs, _fsCaseSensitivity);
    }
    return !!isFileSystemCaseSensitiveMap.get(fs);
}

export function isFileSystemCaseSensitiveInternal(fs: FileSystem, tmp: TempFile) {
    let filePath: Uri | undefined = undefined;
    try {
        // Make unique file name.
        let name: string;
        let mangledFilePath: Uri;
        do {
            name = `${randomBytesHex(21)}-a`;
            filePath = tmp.tmpdir().combinePaths(name);
            mangledFilePath = tmp.tmpdir().combinePaths(name.toUpperCase());
        } while (fs.existsSync(filePath) || fs.existsSync(mangledFilePath));

        fs.writeFileSync(filePath, '', 'utf8');

        // If file exists, then it is insensitive.
        return !fs.existsSync(mangledFilePath);
    } catch (e: any) {
        return false;
    } finally {
        if (filePath) {
            // remove temp file created
            try {
                fs.unlinkSync(filePath);
            } catch (e: any) {
                /* ignored */
            }
        }
    }
}

export function getLibraryPathWithoutExtension(libraryUri: Uri) {
    const filePathWithoutExtension = libraryUri.stripExtension();

    // Strip off the '/__init__' if it's present.
    return filePathWithoutExtension.remove('__init__');
}

export function deduplicateFolders(listOfFolders: Uri[][]): Uri[] {
    const foldersToWatch = new Map<string, Uri>();

    listOfFolders.forEach((folders) => {
        folders.forEach((p) => {
            if (foldersToWatch.has(p.key)) {
                // Bail out on exact match.
                return;
            }

            for (const existing of foldersToWatch) {
                // ex) p: "/user/test" existing: "/user"
                if (p.startsWith(existing[1])) {
                    // We already have the parent folder in the watch list
                    return;
                }

                // ex) p: "/user" folderToWatch: "/user/test"
                if (existing[1].startsWith(p)) {
                    // We found better one to watch. replace.
                    foldersToWatch.delete(existing[0]);
                    foldersToWatch.set(p.key, p);
                    return;
                }
            }

            foldersToWatch.set(p.key, p);
        });
    });

    return [...foldersToWatch.values()];
}
