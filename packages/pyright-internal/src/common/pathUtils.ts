/*
 * pathUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Pathname utility functions.
 */

import * as path from 'path';

import { Char } from './charCodes';
import { some } from './collectionUtils';
import { identity } from './core';
import * as debug from './debug';
import { equateStringsCaseInsensitive, equateStringsCaseSensitive } from './stringUtils';

export type GetCanonicalFileName = (fileName: string) => string;

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
const _wildcardRootRegex = /[*?]/;

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

export function getDirectoryPath(pathString: string): string {
    return pathString.substr(0, Math.max(getRootLength(pathString), pathString.lastIndexOf(path.sep)));
}

/**
 * Returns length of the root part of a path or URL (i.e. length of "/", "x:/", "//server/").
 */
export function getRootLength(pathString: string, sep = path.sep): number {
    if (pathString.charAt(0) === sep) {
        if (pathString.charAt(1) !== sep) {
            return 1; // POSIX: "/" (or non-normalized "\")
        }
        const p1 = pathString.indexOf(sep, 2);
        if (p1 < 0) {
            return pathString.length; // UNC: "//server" or "\\server"
        }
        return p1 + 1; // UNC: "//server/" or "\\server\"
    }
    if (pathString.charAt(1) === ':') {
        if (pathString.charAt(2) === sep) {
            return 3; // DOS: "c:/" or "c:\"
        }
        if (pathString.length === 2) {
            return 2; // DOS: "c:" (but not "c:d")
        }
    }

    return 0;
}

export function getPathSeparator(pathString: string) {
    return path.sep;
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

const separatorRegExp = /[\\/]/g;
const getInvalidSeparator = (sep: string) => (sep === '/' ? '\\' : '/');
export function normalizeSlashes(pathString: string, sep = path.sep): string {
    if (pathString.includes(getInvalidSeparator(sep))) {
        return pathString.replace(separatorRegExp, sep);
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
    return pathString.slice(0, pathString.length - 1);
}

export function getFileExtension(fileName: string, multiDotExtension = false) {
    if (!multiDotExtension) {
        return path.extname(fileName);
    }

    fileName = getFileName(fileName);
    const firstDotIndex = fileName.indexOf('.');
    return fileName.slice(firstDotIndex);
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

export function normalizePath(pathString: string): string {
    return normalizeSlashes(path.normalize(pathString));
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
            if (component.match(_wildcardRootRegex)) {
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
