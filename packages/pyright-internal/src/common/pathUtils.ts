/*
 * pathUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Pathname utility functions.
 */

import type { Dirent } from 'fs';
import * as path from 'path';
import { URI, Utils } from 'vscode-uri';

import { Char } from './charCodes';
import { some } from './collectionUtils';
import { GetCanonicalFileName, identity } from './core';
import { randomBytesHex } from './crypto';
import * as debug from './debug';
import { ServiceProvider } from './extensibility';
import { FileSystem, ReadOnlyFileSystem, Stats, TempFile } from './fileSystem';
import { ServiceKeys } from './serviceProviderExtensions';
import { equateStringsCaseInsensitive, equateStringsCaseSensitive } from './stringUtils';

let _fsCaseSensitivity: boolean | undefined = undefined;
let _underTest: boolean = false;

export interface FileSpec {
    // File specs can contain wildcard characters (**, *, ?). This
    // specifies the first portion of the file spec that contains
    // no wildcards.
    wildcardRoot: string;

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
    export function isInPath(path: string, paths: FileSpec[]) {
        return !!paths.find((p) => p.regExp.test(path));
    }

    export function matchesIncludeFileRegex(filePath: string, isFile = true) {
        return isFile ? _includeFileRegex.test(filePath) : true;
    }

    export function matchIncludeFileSpec(includeRegExp: RegExp, exclude: FileSpec[], filePath: string, isFile = true) {
        if (includeRegExp.test(filePath)) {
            if (!FileSpec.isInPath(filePath, exclude) && FileSpec.matchesIncludeFileRegex(filePath, isFile)) {
                return true;
            }
        }

        return false;
    }
}

export interface FileSystemEntries {
    files: string[];
    directories: string[];
}

export function forEachAncestorDirectory(
    directory: string,
    callback: (directory: string) => string | undefined
): string | undefined {
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
    if (isUri(pathString)) {
        return Utils.dirname(URI.parse(pathString).with({ fragment: '' })).toString();
    }
    return pathString.substr(0, Math.max(getRootLength(pathString), pathString.lastIndexOf(path.sep)));
}

export function isUri(pathString: string) {
    return pathString.indexOf(':') > 1;
}

/**
 * Returns length of the root part of a path or URL (i.e. length of "/", "x:/", "//server/").
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

    if (isUri(pathString)) {
        const uri = URI.parse(pathString);
        if (uri.authority) {
            return uri.scheme.length + 3; // URI: "file://"
        } else {
            return uri.scheme.length + 2; // URI: "untitled:/"
        }
    }

    return 0;
}

export function getPathSeparator(pathString: string) {
    return isUri(pathString) ? '/' : path.sep;
}

export function getPathComponents(pathString: string) {
    const normalizedPath = normalizeSlashes(pathString);
    const rootLength = getRootLength(normalizedPath);
    const root = normalizedPath.substring(0, rootLength);
    const sep = getPathSeparator(pathString);
    const rest = normalizedPath.substring(rootLength).split(sep);
    if (rest.length > 0 && !rest[rest.length - 1]) {
        rest.pop();
    }

    return reducePathComponents([root, ...rest]);
}

export function reducePathComponents(components: readonly string[]) {
    if (!some(components)) {
        return [];
    }

    // Reduce the path components by eliminating
    // any '.' or '..'.
    const reduced = [components[0]];
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

export function combinePathComponents(components: string[]): string {
    if (components.length === 0) {
        return '';
    }

    const root = components[0] && ensureTrailingDirectorySeparator(components[0]);
    const sep = getPathSeparator(root);
    return normalizeSlashes(root + components.slice(1).join(sep));
}

export function getRelativePath(dirPath: string, relativeTo: string) {
    if (!dirPath.startsWith(ensureTrailingDirectorySeparator(relativeTo))) {
        return undefined;
    }

    const pathComponents = getPathComponents(dirPath);
    const relativeToComponents = getPathComponents(relativeTo);
    const sep = getPathSeparator(dirPath);

    let relativePath = '.';
    for (let i = relativeToComponents.length; i < pathComponents.length; i++) {
        relativePath += sep + pathComponents[i];
    }

    return relativePath;
}

// Creates a directory hierarchy for a path, starting from some ancestor path.
export function makeDirectories(fs: FileSystem, dirPath: string, startingFromDirPath: string) {
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

export function getFileSize(fs: ReadOnlyFileSystem, path: string) {
    const stat = tryStat(fs, path);
    if (stat?.isFile()) {
        return stat.size;
    }
    return 0;
}

export function fileExists(fs: ReadOnlyFileSystem, path: string): boolean {
    return fileSystemEntryExists(fs, path, FileSystemEntryKind.File);
}

export function directoryExists(fs: ReadOnlyFileSystem, path: string): boolean {
    return fileSystemEntryExists(fs, path, FileSystemEntryKind.Directory);
}

const getInvalidSeparator = (sep: string) => (sep === '/' ? '\\' : '/');
export function normalizeSlashes(pathString: string, sep = path.sep): string {
    if (!isUri(pathString)) {
        if (pathString.includes(getInvalidSeparator(sep))) {
            const separatorRegExp = /[\\/]/g;
            return pathString.replace(separatorRegExp, sep);
        }
    }

    return pathString;
}

/**
 * Combines and resolves paths. If a path is absolute, it replaces any previous path. Any
 * `.` and `..` path components are resolved. Trailing directory separators are preserved.
 *
 * ```ts
 * resolvePath("/path", "to", "file.ext") === "path/to/file.ext"
 * resolvePath("/path", "to", "file.ext/") === "path/to/file.ext/"
 * resolvePath("/path", "dir", "..", "to", "file.ext") === "path/to/file.ext"
 * ```
 */
export function resolvePaths(path: string, ...paths: (string | undefined)[]): string {
    return normalizePath(some(paths) ? combinePaths(path, ...paths) : normalizeSlashes(path));
}

function combineFilePaths(pathString: string, ...paths: (string | undefined)[]): string {
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

export function combinePaths(pathString: string, ...paths: (string | undefined)[]): string {
    if (!isUri(pathString)) {
        // Not a URI, or a URI with a single letter scheme.
        return combineFilePaths(pathString, ...paths);
    }

    // Go through the paths to see if any are rooted. If so, treat as
    // a file path. On linux this might be wrong if a path starts with '/'.
    if (some(paths, (p) => !!p && getRootLength(p) !== 0)) {
        return combineFilePaths(pathString, ...paths);
    }

    // Otherwise this is a URI
    const nonEmptyPaths = paths.filter((p) => !!p) as string[];
    const uri = URI.parse(pathString);

    // Make sure we have a path to append to.
    if (uri.path === '' || uri.path === undefined) {
        nonEmptyPaths.unshift('/');
    }
    return Utils.joinPath(uri.with({ fragment: '' }), ...nonEmptyPaths).toString();
}

/**
 * Determines whether a `parent` path contains a `child` path using the provide case sensitivity.
 */
export function containsPath(parent: string, child: string, ignoreCase?: boolean): boolean;
export function containsPath(parent: string, child: string, currentDirectory: string, ignoreCase?: boolean): boolean;
export function containsPath(parent: string, child: string, currentDirectory?: string | boolean, ignoreCase?: boolean) {
    if (typeof currentDirectory === 'string') {
        parent = combinePaths(currentDirectory, parent);
        child = combinePaths(currentDirectory, child);
    } else if (typeof currentDirectory === 'boolean') {
        ignoreCase = currentDirectory;
    }

    if (parent === undefined || child === undefined) {
        return false;
    }
    if (parent === child) {
        return true;
    }

    const parentComponents = getPathComponents(parent);
    const childComponents = getPathComponents(child);

    if (childComponents.length < parentComponents.length) {
        return false;
    }

    const componentEqualityComparer = ignoreCase ? equateStringsCaseInsensitive : equateStringsCaseSensitive;
    for (let i = 0; i < parentComponents.length; i++) {
        const equalityComparer = i === 0 ? equateStringsCaseInsensitive : componentEqualityComparer;
        if (!equalityComparer(parentComponents[i], childComponents[i])) {
            return false;
        }
    }

    return true;
}

/**
 * Changes the extension of a path to the provided extension.
 *
 * ```ts
 * changeAnyExtension("/path/to/file.ext", ".js") === "/path/to/file.js"
 * ```
 */
export function changeAnyExtension(path: string, ext: string): string;

/**
 * Changes the extension of a path to the provided extension if it has one of the provided extensions.
 *
 * ```ts
 * changeAnyExtension("/path/to/file.ext", ".js", ".ext") === "/path/to/file.js"
 * changeAnyExtension("/path/to/file.ext", ".js", ".ts") === "/path/to/file.ext"
 * changeAnyExtension("/path/to/file.ext", ".js", [".ext", ".ts"]) === "/path/to/file.js"
 * ```
 */
export function changeAnyExtension(
    path: string,
    ext: string,
    extensions: string | readonly string[],
    ignoreCase: boolean
): string;
export function changeAnyExtension(
    path: string,
    ext: string,
    extensions?: string | readonly string[],
    ignoreCase?: boolean
): string {
    const pathExt =
        extensions !== undefined && ignoreCase !== undefined
            ? getAnyExtensionFromPath(path, extensions, ignoreCase)
            : getAnyExtensionFromPath(path);

    return pathExt ? path.slice(0, path.length - pathExt.length) + (ext.startsWith('.') ? ext : '.' + ext) : path;
}

/**
 * Gets the file extension for a path.
 *
 * ```ts
 * getAnyExtensionFromPath("/path/to/file.ext") === ".ext"
 * getAnyExtensionFromPath("/path/to/file.ext/") === ".ext"
 * getAnyExtensionFromPath("/path/to/file") === ""
 * getAnyExtensionFromPath("/path/to.ext/file") === ""
 * ```
 */
export function getAnyExtensionFromPath(path: string): string;
/**
 * Gets the file extension for a path, provided it is one of the provided extensions.
 *
 * ```ts
 * getAnyExtensionFromPath("/path/to/file.ext", ".ext", true) === ".ext"
 * getAnyExtensionFromPath("/path/to/file.js", ".ext", true) === ""
 * getAnyExtensionFromPath("/path/to/file.js", [".ext", ".js"], true) === ".js"
 * getAnyExtensionFromPath("/path/to/file.ext", ".EXT", false) === ""
 */
export function getAnyExtensionFromPath(
    path: string,
    extensions: string | readonly string[],
    ignoreCase: boolean
): string;
export function getAnyExtensionFromPath(
    path: string,
    extensions?: string | readonly string[],
    ignoreCase?: boolean
): string {
    // Retrieves any string from the final "." onwards from a base file name.
    // Unlike extensionFromPath, which throws an exception on unrecognized extensions.
    if (extensions) {
        return getAnyExtensionFromPathWorker(
            stripTrailingDirectorySeparator(path),
            extensions,
            ignoreCase ? equateStringsCaseInsensitive : equateStringsCaseSensitive
        );
    }
    const baseFileName = getBaseFileName(path);
    const extensionIndex = baseFileName.lastIndexOf('.');
    if (extensionIndex >= 0) {
        return baseFileName.substring(extensionIndex);
    }
    return '';
}

/**
 * Returns the path except for its containing directory name.
 * Semantics align with NodeJS's `path.basename` except that we support URLs as well.
 *
 * ```ts
 * // POSIX
 * getBaseFileName("/path/to/file.ext") === "file.ext"
 * getBaseFileName("/path/to/") === "to"
 * getBaseFileName("/") === ""
 * // DOS
 * getBaseFileName("c:/path/to/file.ext") === "file.ext"
 * getBaseFileName("c:/path/to/") === "to"
 * getBaseFileName("c:/") === ""
 * getBaseFileName("c:") === ""
 * ```
 */
export function getBaseFileName(pathString: string): string;
/**
 * Gets the portion of a path following the last (non-terminal) separator (`/`).
 * Semantics align with NodeJS's `path.basename` except that we support URLs as well.
 * If the base name has any one of the provided extensions, it is removed.
 *
 * ```ts
 * getBaseFileName("/path/to/file.ext", ".ext", true) === "file"
 * getBaseFileName("/path/to/file.js", ".ext", true) === "file.js"
 * getBaseFileName("/path/to/file.js", [".ext", ".js"], true) === "file"
 * getBaseFileName("/path/to/file.ext", ".EXT", false) === "file.ext"
 * ```
 */
export function getBaseFileName(
    pathString: string,
    extensions: string | readonly string[],
    ignoreCase: boolean
): string;
export function getBaseFileName(pathString: string, extensions?: string | readonly string[], ignoreCase?: boolean) {
    pathString = normalizeSlashes(pathString);

    // if the path provided is itself the root, then it has not file name.
    const rootLength = getRootLength(pathString);
    if (rootLength === pathString.length) {
        return '';
    }

    // return the trailing portion of the path starting after the last (non-terminal) directory
    // separator but not including any trailing directory separator.
    pathString = stripTrailingDirectorySeparator(pathString);
    const name = isUri(pathString)
        ? Utils.basename(URI.parse(pathString))
        : pathString.slice(Math.max(getRootLength(pathString), pathString.lastIndexOf(path.sep) + 1));
    const extension =
        extensions !== undefined && ignoreCase !== undefined
            ? getAnyExtensionFromPath(name, extensions, ignoreCase)
            : undefined;

    return extension ? name.slice(0, name.length - extension.length) : name;
}

/**
 * Gets a relative path that can be used to traverse between `from` and `to`.
 */
export function getRelativePathFromDirectory(from: string, to: string, ignoreCase: boolean): string;
/**
 * Gets a relative path that can be used to traverse between `from` and `to`.
 */
export function getRelativePathFromDirectory(
    fromDirectory: string,
    to: string,
    getCanonicalFileName: GetCanonicalFileName
): string;
export function getRelativePathFromDirectory(
    fromDirectory: string,
    to: string,
    getCanonicalFileNameOrIgnoreCase: GetCanonicalFileName | boolean
) {
    const pathComponents = getRelativePathComponentsFromDirectory(fromDirectory, to, getCanonicalFileNameOrIgnoreCase);
    return combinePathComponents(pathComponents);
}

export function getRelativePathComponentsFromDirectory(
    fromDirectory: string,
    to: string,
    getCanonicalFileNameOrIgnoreCase: GetCanonicalFileName | boolean
) {
    debug.assert(
        getRootLength(fromDirectory) > 0 === getRootLength(to) > 0,
        'Paths must either both be absolute or both be relative'
    );
    const getCanonicalFileName =
        typeof getCanonicalFileNameOrIgnoreCase === 'function' ? getCanonicalFileNameOrIgnoreCase : identity;
    const ignoreCase = typeof getCanonicalFileNameOrIgnoreCase === 'boolean' ? getCanonicalFileNameOrIgnoreCase : false;
    const pathComponents = getPathComponentsRelativeTo(
        fromDirectory,
        to,
        ignoreCase ? equateStringsCaseInsensitive : equateStringsCaseSensitive,
        getCanonicalFileName
    );

    return pathComponents;
}

export function ensureTrailingDirectorySeparator(pathString: string): string {
    const sep = getPathSeparator(pathString);
    if (!hasTrailingDirectorySeparator(pathString)) {
        return pathString + sep;
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

export function getFileExtension(fileName: string, multiDotExtension = false) {
    if (!multiDotExtension) {
        return path.extname(fileName);
    }

    fileName = getFileName(fileName);
    const firstDotIndex = fileName.indexOf('.');
    return fileName.substr(firstDotIndex);
}

export function getFileName(pathString: string) {
    return path.basename(pathString);
}

export function getShortenedFileName(pathString: string, maxDirLength = 15) {
    const fileName = getFileName(pathString);
    const dirName = getDirectoryPath(pathString);
    if (dirName.length > maxDirLength) {
        return `...${dirName.slice(dirName.length - maxDirLength)}${path.sep}${fileName}`;
    }
    return pathString;
}

export function stripFileExtension(fileName: string, multiDotExtension = false) {
    const ext = getFileExtension(fileName, multiDotExtension);
    return fileName.substr(0, fileName.length - ext.length);
}

export function realCasePath(pathString: string, fileSystem: ReadOnlyFileSystem): string {
    return isUri(pathString) ? pathString : fileSystem.realCasePath(pathString);
}

export function normalizePath(pathString: string): string {
    if (!isUri(pathString)) {
        return normalizeSlashes(path.normalize(pathString));
    }

    // Must be a URI, already normalized.
    return pathString;
}

export function isDirectory(fs: ReadOnlyFileSystem, path: string): boolean {
    return tryStat(fs, path)?.isDirectory() ?? false;
}

export function isFile(fs: ReadOnlyFileSystem, path: string, treatZipDirectoryAsFile = false): boolean {
    const stats = tryStat(fs, path);
    if (stats?.isFile()) {
        return true;
    }

    if (!treatZipDirectoryAsFile) {
        return false;
    }

    return stats?.isZipDirectory?.() ?? false;
}

export function tryStat(fs: ReadOnlyFileSystem, path: string): Stats | undefined {
    try {
        if (fs.existsSync(path)) {
            return fs.statSync(path);
        }
    } catch (e: any) {
        return undefined;
    }
    return undefined;
}

export function tryRealpath(fs: ReadOnlyFileSystem, path: string): string | undefined {
    try {
        return fs.realCasePath(path);
    } catch (e: any) {
        return undefined;
    }
}

export function getFileSystemEntries(fs: ReadOnlyFileSystem, path: string): FileSystemEntries {
    try {
        return getFileSystemEntriesFromDirEntries(fs.readdirEntriesSync(path || '.'), fs, path);
    } catch (e: any) {
        return { files: [], directories: [] };
    }
}

// Sorts the entires into files and directories, including any symbolic links.
export function getFileSystemEntriesFromDirEntries(
    dirEntries: Dirent[],
    fs: ReadOnlyFileSystem,
    path: string
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
    const files: string[] = [];
    const directories: string[] = [];
    for (const entry of entries) {
        // This is necessary because on some file system node fails to exclude
        // "." and "..". See https://github.com/nodejs/node/issues/4002
        if (entry.name === '.' || entry.name === '..') {
            continue;
        }

        if (entry.isFile()) {
            files.push(entry.name);
        } else if (entry.isDirectory()) {
            directories.push(entry.name);
        } else if (entry.isSymbolicLink()) {
            const entryPath = combinePaths(path, entry.name);
            const stat = tryStat(fs, entryPath);
            if (stat?.isFile()) {
                files.push(entry.name);
            } else if (stat?.isDirectory()) {
                directories.push(entry.name);
            }
        }
    }
    return { files, directories };
}

// Transforms a relative file spec (one that potentially contains
// escape characters **, * or ?) and returns a regular expression
// that can be used for matching against.
export function getWildcardRegexPattern(rootPath: string, fileSpec: string): string {
    let absolutePath = normalizePath(combinePaths(rootPath, fileSpec));
    if (!hasPythonExtension(absolutePath)) {
        absolutePath = ensureTrailingDirectorySeparator(absolutePath);
    }

    const pathComponents = getPathComponents(absolutePath);

    const escapedSeparator = getRegexEscapedSeparator(getPathSeparator(rootPath));
    const doubleAsteriskRegexFragment = `(${escapedSeparator}[^${escapedSeparator}][^${escapedSeparator}]*)*?`;
    const reservedCharacterPattern = new RegExp(`[^\\w\\s${escapedSeparator}]`, 'g');

    // Strip the directory separator from the root component.
    if (pathComponents.length > 0) {
        pathComponents[0] = stripTrailingDirectorySeparator(pathComponents[0]);

        if (pathComponents[0].startsWith('\\\\')) {
            pathComponents[0] = '\\\\' + pathComponents[0];
        }
    }

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

// Determines whether the file spec contains a directory wildcard pattern ("**").
export function isDirectoryWildcardPatternPresent(fileSpec: string): boolean {
    const path = normalizePath(fileSpec);
    const pathComponents = getPathComponents(path);

    for (const component of pathComponents) {
        if (component === '**') {
            return true;
        }
    }

    return false;
}

// Returns the topmost path that contains no wildcard characters.
export function getWildcardRoot(rootPath: string, fileSpec: string): string {
    let absolutePath = normalizePath(combinePaths(rootPath, fileSpec));
    if (!hasPythonExtension(absolutePath)) {
        absolutePath = ensureTrailingDirectorySeparator(absolutePath);
    }

    const pathComponents = getPathComponents(absolutePath);
    const sep = getPathSeparator(absolutePath);

    // Strip the directory separator from the root component.
    if (pathComponents.length > 0) {
        pathComponents[0] = stripTrailingDirectorySeparator(pathComponents[0]);
    }

    if (pathComponents.length === 1 && !pathComponents[0]) {
        return sep;
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
                component = sep + component;
            }

            wildcardRoot += component;
            firstComponent = false;
        }
    }

    return wildcardRoot;
}

export function hasPythonExtension(path: string) {
    return path.endsWith('.py') || path.endsWith('.pyi');
}

export function getFileSpec(sp: ServiceProvider, rootPath: string, fileSpec: string): FileSpec {
    let regExPattern = getWildcardRegexPattern(rootPath, fileSpec);
    const escapedSeparator = getRegexEscapedSeparator(getPathSeparator(rootPath));
    regExPattern = `^(${regExPattern})($|${escapedSeparator})`;

    const fs = sp.get(ServiceKeys.fs);
    const tmp = sp.tryGet(ServiceKeys.tempFile);

    const regExp = new RegExp(regExPattern, isFileSystemCaseSensitive(fs, tmp) ? undefined : 'i');
    const wildcardRoot = getWildcardRoot(rootPath, fileSpec);
    const hasDirectoryWildcard = isDirectoryWildcardPatternPresent(fileSpec);

    return {
        wildcardRoot,
        regExp,
        hasDirectoryWildcard,
    };
}

export function getRegexEscapedSeparator(pathSep: string = path.sep) {
    // we don't need to escape "/" in typescript regular expression
    return pathSep === '/' ? '/' : '\\\\';
}

/**
 * Determines whether a path is an absolute disk path (e.g. starts with `/`, or a dos path
 * like `c:`, `c:\` or `c:/`).
 */
export function isRootedDiskPath(path: string) {
    return getRootLength(path) > 0;
}

/**
 * Determines whether a path consists only of a path root.
 */
export function isDiskPathRoot(path: string) {
    const rootLength = getRootLength(path);
    return rootLength > 0 && rootLength === path.length;
}

function getAnyExtensionFromPathWorker(
    path: string,
    extensions: string | readonly string[],
    stringEqualityComparer: (a: string, b: string) => boolean
) {
    if (typeof extensions === 'string') {
        return tryGetExtensionFromPath(path, extensions, stringEqualityComparer) || '';
    }
    for (const extension of extensions) {
        const result = tryGetExtensionFromPath(path, extension, stringEqualityComparer);
        if (result) {
            return result;
        }
    }
    return '';
}

function tryGetExtensionFromPath(
    path: string,
    extension: string,
    stringEqualityComparer: (a: string, b: string) => boolean
) {
    if (!extension.startsWith('.')) {
        extension = '.' + extension;
    }
    if (path.length >= extension.length && path.charCodeAt(path.length - extension.length) === Char.Period) {
        const pathExtension = path.slice(path.length - extension.length);
        if (stringEqualityComparer(pathExtension, extension)) {
            return pathExtension;
        }
    }

    return undefined;
}

function getPathComponentsRelativeTo(
    from: string,
    to: string,
    stringEqualityComparer: (a: string, b: string) => boolean,
    getCanonicalFileName: GetCanonicalFileName
) {
    const fromComponents = getPathComponents(from);
    const toComponents = getPathComponents(to);

    let start: number;
    for (start = 0; start < fromComponents.length && start < toComponents.length; start++) {
        const fromComponent = getCanonicalFileName(fromComponents[start]);
        const toComponent = getCanonicalFileName(toComponents[start]);
        const comparer = start === 0 ? equateStringsCaseInsensitive : stringEqualityComparer;
        if (!comparer(fromComponent, toComponent)) {
            break;
        }
    }

    if (start === 0) {
        return toComponents;
    }

    const components = toComponents.slice(start);
    const relative: string[] = [];
    for (; start < fromComponents.length; start++) {
        relative.push('..');
    }
    return ['', ...relative, ...components];
}

const enum FileSystemEntryKind {
    File,
    Directory,
}

function fileSystemEntryExists(fs: ReadOnlyFileSystem, path: string, entryKind: FileSystemEntryKind): boolean {
    try {
        const stat = fs.statSync(path);
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

export function convertUriToPath(fs: ReadOnlyFileSystem, uriString: string): string {
    return realCasePath(fs.getMappedFilePath(extractPathFromUri(uriString)), fs);
}

export function extractPathFromUri(uriString: string) {
    const uri = URI.parse(uriString);

    // Only for file scheme do we actually modify anything. All other uri strings
    // maintain the same value they started with.
    if (uri.scheme === 'file' && !uri.fragment) {
        // When schema is "file", we use fsPath so that we can handle things like UNC paths.
        let convertedPath = normalizePath(uri.fsPath);

        // If this is a DOS-style path with a drive letter, remove
        // the leading slash.
        if (convertedPath.match(/^\\[a-zA-Z]:\\/)) {
            convertedPath = convertedPath.slice(1);
        }

        return convertedPath;
    }

    return uriString;
}

export function convertPathToUri(fs: ReadOnlyFileSystem, path: string): string {
    return fs.getUri(fs.getOriginalFilePath(path));
}

export function setTestingMode(underTest: boolean) {
    _underTest = underTest;
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
    let filePath: string | undefined = undefined;
    try {
        // Make unique file name.
        let name: string;
        let mangledFilePath: string;
        do {
            name = `${randomBytesHex(21)}-a`;
            filePath = path.join(tmp.tmpdir(), name);
            mangledFilePath = path.join(tmp.tmpdir(), name.toUpperCase());
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

export function getLibraryPathWithoutExtension(libraryFilePath: string) {
    let filePathWithoutExtension = stripFileExtension(libraryFilePath);

    // Strip off the '/__init__' if it's present.
    if (filePathWithoutExtension.endsWith('__init__')) {
        filePathWithoutExtension = filePathWithoutExtension.substr(0, filePathWithoutExtension.length - 9);
    }

    return filePathWithoutExtension;
}

export function getDirectoryChangeKind(
    fs: ReadOnlyFileSystem,
    oldDirectory: string,
    newDirectory: string
): 'Same' | 'Renamed' | 'Moved' {
    if (fs.realCasePath(oldDirectory) === fs.realCasePath(newDirectory)) {
        return 'Same';
    }

    const relativePaths = getRelativePathComponentsFromDirectory(oldDirectory, newDirectory, (f) => fs.realCasePath(f));

    // 3 means only last folder name has changed.
    if (relativePaths.length === 3 && relativePaths[1] === '..' && relativePaths[2] !== '..') {
        return 'Renamed';
    }

    return 'Moved';
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
