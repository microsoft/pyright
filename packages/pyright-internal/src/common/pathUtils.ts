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
import Char from 'typescript-char';
import { URI } from 'vscode-uri';

import { some } from './collectionUtils';
import { compareValues, Comparison, GetCanonicalFileName, identity } from './core';
import { randomBytesHex } from './crypto';
import * as debug from './debug';
import { FileSystem, Stats } from './fileSystem';
import {
    compareStringsCaseInsensitive,
    compareStringsCaseSensitive,
    equateStringsCaseInsensitive,
    equateStringsCaseSensitive,
    getStringComparer,
} from './stringUtils';

let _fsCaseSensitivity: boolean | undefined = undefined;

export interface FileSpec {
    // File specs can contain wildcard characters (**, *, ?). This
    // specifies the first portion of the file spec that contains
    // no wildcards.
    wildcardRoot: string;

    // Regular expression that can be used to match against this
    // file spec.
    regExp: RegExp;
}

export namespace FileSpec {
    export function is(value: any): value is FileSpec {
        const candidate: FileSpec = value as FileSpec;
        return candidate && !!candidate.wildcardRoot && !!candidate.regExp;
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
    return pathString.substr(0, Math.max(getRootLength(pathString), pathString.lastIndexOf(path.sep)));
}

export function getRootLength(pathString: string): number {
    if (pathString.charAt(0) === path.sep) {
        if (pathString.charAt(1) !== path.sep) {
            return 1;
        }
        const p1 = pathString.indexOf(path.sep, 2);
        if (p1 < 0) {
            return 2;
        }
        const p2 = pathString.indexOf(path.sep, p1 + 1);
        if (p2 < 0) {
            return p1 + 1;
        }
        return p2 + 1;
    }
    if (pathString.charAt(1) === ':') {
        if (pathString.charAt(2) === path.sep) {
            return 3;
        }
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
    return normalizeSlashes(root + components.slice(1).join(path.sep));
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

export function getFileSize(fs: FileSystem, path: string) {
    const stat = tryStat(fs, path);
    if (stat?.isFile()) {
        return stat.size;
    }
    return 0;
}

export function fileExists(fs: FileSystem, path: string): boolean {
    return fileSystemEntryExists(fs, path, FileSystemEntryKind.File);
}

export function directoryExists(fs: FileSystem, path: string): boolean {
    return fileSystemEntryExists(fs, path, FileSystemEntryKind.Directory);
}

const invalidSeparator = path.sep === '/' ? '\\' : '/';
export function normalizeSlashes(pathString: string): string {
    if (pathString.includes(invalidSeparator)) {
        const separatorRegExp = /[\\/]/g;
        return pathString.replace(separatorRegExp, path.sep);
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

/**
 * Compare two paths using the provided case sensitivity.
 */
export function comparePaths(a: string, b: string, ignoreCase?: boolean): Comparison;
export function comparePaths(a: string, b: string, currentDirectory: string, ignoreCase?: boolean): Comparison;
export function comparePaths(a: string, b: string, currentDirectory?: string | boolean, ignoreCase?: boolean) {
    a = normalizePath(a);
    b = normalizePath(b);

    if (typeof currentDirectory === 'string') {
        a = combinePaths(currentDirectory, a);
        b = combinePaths(currentDirectory, b);
    } else if (typeof currentDirectory === 'boolean') {
        ignoreCase = currentDirectory;
    }
    return comparePathsWorker(a, b, getStringComparer(ignoreCase));
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
    const name = pathString.slice(Math.max(getRootLength(pathString), pathString.lastIndexOf(path.sep) + 1));
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

/**
 * Performs a case-sensitive comparison of two paths. Path roots are always compared case-insensitively.
 */
export function comparePathsCaseSensitive(a: string, b: string) {
    return comparePathsWorker(a, b, compareStringsCaseSensitive);
}

/**
 * Performs a case-insensitive comparison of two paths.
 */
export function comparePathsCaseInsensitive(a: string, b: string) {
    return comparePathsWorker(a, b, compareStringsCaseInsensitive);
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

export function stripFileExtension(fileName: string, multiDotExtension = false) {
    const ext = getFileExtension(fileName, multiDotExtension);
    return fileName.substr(0, fileName.length - ext.length);
}

export function normalizePath(pathString: string): string {
    return normalizeSlashes(path.normalize(pathString));
}

export function isDirectory(fs: FileSystem, path: string): boolean {
    return tryStat(fs, path)?.isDirectory() ?? false;
}

export function isFile(fs: FileSystem, path: string): boolean {
    return tryStat(fs, path)?.isFile() ?? false;
}

export function tryStat(fs: FileSystem, path: string): Stats | undefined {
    try {
        return fs.statSync(path);
    } catch (e: any) {
        return undefined;
    }
}

export function tryRealpath(fs: FileSystem, path: string): string | undefined {
    try {
        return fs.realpathSync(path);
    } catch (e: any) {
        return undefined;
    }
}

export function getFileSystemEntries(fs: FileSystem, path: string): FileSystemEntries {
    try {
        return getFileSystemEntriesFromDirEntries(fs.readdirEntriesSync(path || '.'), fs, path);
    } catch (e: any) {
        return { files: [], directories: [] };
    }
}

// Sorts the entires into files and directories, including any symbolic links.
export function getFileSystemEntriesFromDirEntries(
    dirEntries: Dirent[],
    fs: FileSystem,
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
    if (!absolutePath.endsWith('.py') && !absolutePath.endsWith('.pyi')) {
        absolutePath = ensureTrailingDirectorySeparator(absolutePath);
    }

    const pathComponents = getPathComponents(absolutePath);

    const escapedSeparator = getRegexEscapedSeparator();
    const doubleAsteriskRegexFragment = `(${escapedSeparator}[^${escapedSeparator}.][^${escapedSeparator}]*)*?`;
    const reservedCharacterPattern = new RegExp(`[^\\w\\s${escapedSeparator}]`, 'g');

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

    if (pathComponents.length === 1 && !pathComponents[0]) {
        return path.sep;
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
    const escapedSeparator = getRegexEscapedSeparator();
    regExPattern = `^(${regExPattern})($|${escapedSeparator})`;

    const regExp = new RegExp(regExPattern);
    const wildcardRoot = getWildcardRoot(rootPath, fileSpec);

    return {
        wildcardRoot,
        regExp,
    };
}

export function getRegexEscapedSeparator() {
    // we don't need to escape "/" in typescript regular expression
    return path.sep === '/' ? '/' : '\\\\';
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

//// Path Comparisons
function comparePathsWorker(a: string, b: string, componentComparer: (a: string, b: string) => Comparison) {
    if (a === b) {
        return Comparison.EqualTo;
    }
    if (a === undefined) {
        return Comparison.LessThan;
    }
    if (b === undefined) {
        return Comparison.GreaterThan;
    }

    // NOTE: Performance optimization - shortcut if the root segments differ as there would be no
    //       need to perform path reduction.
    const aRoot = a.substring(0, getRootLength(a));
    const bRoot = b.substring(0, getRootLength(b));
    const result = compareStringsCaseInsensitive(aRoot, bRoot);
    if (result !== Comparison.EqualTo) {
        return result;
    }

    // check path for these segments: '', '.'. '..'
    const escapedSeparator = getRegexEscapedSeparator();
    const relativePathSegmentRegExp = new RegExp(`(^|${escapedSeparator}).{0,2}($|${escapedSeparator})`);

    // NOTE: Performance optimization - shortcut if there are no relative path segments in
    //       the non-root portion of the path
    const aRest = a.substring(aRoot.length);
    const bRest = b.substring(bRoot.length);
    if (!relativePathSegmentRegExp.test(aRest) && !relativePathSegmentRegExp.test(bRest)) {
        return componentComparer(aRest, bRest);
    }

    // The path contains a relative path segment. Normalize the paths and perform a slower component
    // by component comparison.
    const aComponents = getPathComponents(a);
    const bComponents = getPathComponents(b);
    const sharedLength = Math.min(aComponents.length, bComponents.length);
    for (let i = 1; i < sharedLength; i++) {
        const result = componentComparer(aComponents[i], bComponents[i]);
        if (result !== Comparison.EqualTo) {
            return result;
        }
    }

    return compareValues(aComponents.length, bComponents.length);
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

function fileSystemEntryExists(fs: FileSystem, path: string, entryKind: FileSystemEntryKind): boolean {
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

export function convertUriToPath(fs: FileSystem, uriString: string): string {
    return fs.getMappedFilePath(extractPathFromUri(uriString));
}

export function extractPathFromUri(uriString: string) {
    const uri = URI.parse(uriString);
    let convertedPath = normalizePath(uri.path);

    // If this is a DOS-style path with a drive letter, remove
    // the leading slash.
    if (convertedPath.match(/^\\[a-zA-Z]:\\/)) {
        convertedPath = convertedPath.substr(1);
    }

    return convertedPath;
}

export function convertPathToUri(fs: FileSystem, path: string): string {
    return fs.getUri(fs.getOriginalFilePath(path));
}

// For file systems that are case-insensitive, returns a lowercase
// version of the path. For case-sensitive file systems, leaves the
// path as is.
export function normalizePathCase(fs: FileSystem, path: string) {
    if (isFileSystemCaseSensitive(fs)) {
        return path;
    }

    return path.toLowerCase();
}

export function isFileSystemCaseSensitive(fs: FileSystem) {
    if (_fsCaseSensitivity !== undefined) {
        return _fsCaseSensitivity;
    }

    _fsCaseSensitivity = isFileSystemCaseSensitiveInternal(fs);
    return _fsCaseSensitivity;
}

export function isFileSystemCaseSensitiveInternal(fs: FileSystem) {
    let filePath: string | undefined = undefined;
    try {
        // Make unique file name.
        let name: string;
        let mangledFilePath: string;
        do {
            name = `${randomBytesHex(21)}-a`;
            filePath = path.join(fs.tmpdir(), name);
            mangledFilePath = path.join(fs.tmpdir(), name.toUpperCase());
        } while (fs.existsSync(filePath) || fs.existsSync(mangledFilePath));

        fs.writeFileSync(filePath, '', 'utf8');

        // If file exists, then it is insensitive.
        return !fs.existsSync(mangledFilePath);
    } catch (e: any) {
        return false;
    } finally {
        if (filePath) {
            // remove temp file created
            fs.unlinkSync(filePath);
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
    fs: FileSystem,
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
