/*
* utils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
*/

import * as path from 'path'
import * as debug from '../../common/debug';
import Char from 'typescript-char';
import { binarySearch, insertAt, addRange, append, contains, every, map, emptyArray, flatten, cloneAndSort } from "../../common/collectionUtils";
import { identity, GetCanonicalFileName, toLowerCase, isArray } from "../../common/core";
import { normalizePath, combinePaths, getPathComponents, stripTrailingDirectorySeparator, isRootedDiskPath, getDirectoryPath, getBaseFileName, containsPath, FileSystemEntries } from '../../common/pathUtils';
import { getStringComparer, compareStringsCaseSensitive } from '../../common/stringUtils';


/** Splits the given string on \r\n, or on only \n if that fails, or on only \r if *that* fails. */
export function splitContentByNewlines(content: string) {
    // Split up the input file by line
    // Note: IE JS engine incorrectly handles consecutive delimiters here when using RegExp split, so
    // we have to use string-based splitting instead and try to figure out the delimiting chars
    let lines = content.split("\r\n");
    if (lines.length === 1) {
        lines = content.split("\n");

        if (lines.length === 1) {
            lines = content.split("\r");
        }
    }
    return lines;
}

export function computeLineStarts(text: string): number[] {
    const maxAsciiCharacter = 0x7F;

    const result: number[] = new Array();
    let pos = 0;
    let lineStart = 0;
    while (pos < text.length) {
        const ch = text.charCodeAt(pos);
        pos++;
        switch (ch) {
            case Char.CarriageReturn:
                if (text.charCodeAt(pos) === Char.LineFeed) {
                    pos++;
                }
            // falls through
            case Char.LineFeed:
                result.push(lineStart);
                lineStart = pos;
                break;
            default:
                if (ch > maxAsciiCharacter && isLineBreak(ch)) {
                    result.push(lineStart);
                    lineStart = pos;
                }
                break;
        }
    }
    result.push(lineStart);
    return result;
}

function isLineBreak(ch: number): boolean {
    return ch === Char.LineFeed || ch === Char.CarriageReturn;
}

export interface SortOptions<T> {
    comparer: (a: T, b: T) => number;
    sort: "insertion" | "comparison";
}

export class SortedMap<K, V> {
    private _comparer: (a: K, b: K) => number;
    private _keys: K[] = [];
    private _values: V[] = [];
    private _order: number[] | undefined;
    private _version = 0;
    private _copyOnWrite = false;

    constructor(comparer: ((a: K, b: K) => number) | SortOptions<K>, iterable?: Iterable<[K, V]>) {
        this._comparer = typeof comparer === "object" ? comparer.comparer : comparer;
        this._order = typeof comparer === "object" && comparer.sort === "insertion" ? [] : undefined;
        if (iterable) {
            const iterator = getIterator(iterable);
            try {
                for (let i = nextResult(iterator); i; i = nextResult(iterator)) {
                    const [key, value] = i.value;
                    this.set(key, value);
                }
            }
            finally {
                closeIterator(iterator);
            }
        }
    }

    public get size() {
        return this._keys.length;
    }

    public get comparer() {
        return this._comparer;
    }

    public get [Symbol.toStringTag]() {
        return "SortedMap";
    }

    public has(key: K) {
        return binarySearch(this._keys, key, identity, this._comparer) >= 0;
    }

    public get(key: K) {
        const index = binarySearch(this._keys, key, identity, this._comparer);
        return index >= 0 ? this._values[index] : undefined;
    }

    public set(key: K, value: V) {
        const index = binarySearch(this._keys, key, identity, this._comparer);
        if (index >= 0) {
            this._values[index] = value;
        }
        else {
            this.writePreamble();
            insertAt(this._keys, ~index, key);
            insertAt(this._values, ~index, value);
            if (this._order) insertAt(this._order, ~index, this._version);
            this.writePostScript();
        }
        return this;
    }

    public delete(key: K) {
        const index = binarySearch(this._keys, key, identity, this._comparer);
        if (index >= 0) {
            this.writePreamble();
            this.orderedRemoveItemAt(this._keys, index);
            this.orderedRemoveItemAt(this._values, index);
            if (this._order) this.orderedRemoveItemAt(this._order, index);
            this.writePostScript();
            return true;
        }
        return false;
    }

    public clear() {
        if (this.size > 0) {
            this.writePreamble();
            this._keys.length = 0;
            this._values.length = 0;
            if (this._order) this._order.length = 0;
            this.writePostScript();
        }
    }

    public forEach(callback: (value: V, key: K, collection: this) => void, thisArg?: any) {
        const keys = this._keys;
        const values = this._values;
        const indices = this.getIterationOrder();
        const version = this._version;
        this._copyOnWrite = true;
        try {
            if (indices) {
                for (const i of indices) {
                    callback.call(thisArg, values[i], keys[i], this);
                }
            }
            else {
                for (let i = 0; i < keys.length; i++) {
                    callback.call(thisArg, values[i], keys[i], this);
                }
            }
        }
        finally {
            if (version === this._version) {
                this._copyOnWrite = false;
            }
        }
    }

    public * keys() {
        const keys = this._keys;
        const indices = this.getIterationOrder();
        const version = this._version;
        this._copyOnWrite = true;
        try {
            if (indices) {
                for (const i of indices) {
                    yield keys[i];
                }
            }
            else {
                yield* keys;
            }
        }
        finally {
            if (version === this._version) {
                this._copyOnWrite = false;
            }
        }
    }

    public * values() {
        const values = this._values;
        const indices = this.getIterationOrder();
        const version = this._version;
        this._copyOnWrite = true;
        try {
            if (indices) {
                for (const i of indices) {
                    yield values[i];
                }
            }
            else {
                yield* values;
            }
        }
        finally {
            if (version === this._version) {
                this._copyOnWrite = false;
            }
        }
    }

    public * entries() {
        const keys = this._keys;
        const values = this._values;
        const indices = this.getIterationOrder();
        const version = this._version;
        this._copyOnWrite = true;
        try {
            if (indices) {
                for (const i of indices) {
                    yield [keys[i], values[i]] as [K, V];
                }
            }
            else {
                for (let i = 0; i < keys.length; i++) {
                    yield [keys[i], values[i]] as [K, V];
                }
            }
        }
        finally {
            if (version === this._version) {
                this._copyOnWrite = false;
            }
        }
    }

    public [Symbol.iterator]() {
        return this.entries();
    }

    private writePreamble() {
        if (this._copyOnWrite) {
            this._keys = this._keys.slice();
            this._values = this._values.slice();
            if (this._order) this._order = this._order.slice();
            this._copyOnWrite = false;
        }
    }

    private writePostScript() {
        this._version++;
    }

    private getIterationOrder() {
        if (this._order) {
            const order = this._order;
            return this._order
                .map((_, i) => i)
                .sort((x, y) => order[x] - order[y]);
        }
        return undefined;
    }

    /** Remove an item by index from an array, moving everything to its right one space left. */
    private orderedRemoveItemAt<T>(array: T[], index: number): void {
        // This seems to be faster than either `array.splice(i, 1)` or `array.copyWithin(i, i+ 1)`.
        for (let i = index; i < array.length - 1; i++) {
            array[i] = array[i + 1];
        }
        array.pop();
    }
}

export function getIterator<T>(iterable: Iterable<T>): Iterator<T> {
    return iterable[Symbol.iterator]();
}

export function nextResult<T>(iterator: Iterator<T>): IteratorResult<T> | undefined {
    const result = iterator.next();
    return result.done ? undefined : result;
}

export function closeIterator<T>(iterator: Iterator<T>) {
    const fn = iterator.return;
    if (typeof fn === "function") fn.call(iterator);
}

/**
 * A collection of metadata that supports inheritance.
 */
export class Metadata {
    private static readonly _undefinedValue = {};
    private _parent: Metadata | undefined;
    private _map: { [key: string]: any };
    private _version = 0;
    private _size = -1;
    private _parentVersion: number | undefined;

    constructor(parent?: Metadata) {
        this._parent = parent;
        this._map = Object.create(parent ? parent._map : null); // eslint-disable-line no-null/no-null
    }

    public get size(): number {
        if (this._size === -1 || (this._parent && this._parent._version !== this._parentVersion)) {
            let size = 0;
            for (const _ in this._map) size++;
            this._size = size;
            if (this._parent) {
                this._parentVersion = this._parent._version;
            }
        }
        return this._size;
    }

    public get parent() {
        return this._parent;
    }

    public has(key: string): boolean {
        return this._map[Metadata._escapeKey(key)] !== undefined;
    }

    public get(key: string): any {
        const value = this._map[Metadata._escapeKey(key)];
        return value === Metadata._undefinedValue ? undefined : value;
    }

    public set(key: string, value: any): this {
        this._map[Metadata._escapeKey(key)] = value === undefined ? Metadata._undefinedValue : value;
        this._size = -1;
        this._version++;
        return this;
    }

    public delete(key: string): boolean {
        const escapedKey = Metadata._escapeKey(key);
        if (this._map[escapedKey] !== undefined) {
            delete this._map[escapedKey];
            this._size = -1;
            this._version++;
            return true;
        }
        return false;
    }

    public clear(): void {
        this._map = Object.create(this._parent ? this._parent._map : null); // eslint-disable-line no-null/no-null
        this._size = -1;
        this._version++;
    }

    public forEach(callback: (value: any, key: string, map: this) => void) {
        for (const key in this._map) {
            callback(this._map[key], Metadata._unescapeKey(key), this);
        }
    }

    private static _escapeKey(text: string) {
        return (text.length >= 2 && text.charAt(0) === "_" && text.charAt(1) === "_" ? "_" + text : text);
    }

    private static _unescapeKey(text: string) {
        return (text.length >= 3 && text.charAt(0) === "_" && text.charAt(1) === "_" && text.charAt(2) === "_" ? text.slice(1) : text);
    }
}

////////////////////////////////
// matchFiles and any lib used by it might not needed at the end. but for now, ported since I wasn't sure.
export function matchFiles(
    path: string,
    extensions: readonly string[] | undefined,
    excludes: readonly string[] | undefined,
    includes: readonly string[] | undefined,
    useCaseSensitiveFileNames: boolean,
    currentDirectory: string,
    depth: number | undefined,
    getFileSystemEntries: (path: string) => FileSystemEntries,
    realpath: (path: string) => string): string[] {

    path = normalizePath(path);
    currentDirectory = normalizePath(currentDirectory);

    const patterns = getFileMatcherPatterns(path, excludes, includes, useCaseSensitiveFileNames, currentDirectory);

    const includeFileRegexes = patterns.includeFilePatterns && patterns.includeFilePatterns.map(pattern => getRegexFromPattern(pattern, useCaseSensitiveFileNames));
    const includeDirectoryRegex = patterns.includeDirectoryPattern && getRegexFromPattern(patterns.includeDirectoryPattern, useCaseSensitiveFileNames);
    const excludeRegex = patterns.excludePattern && getRegexFromPattern(patterns.excludePattern, useCaseSensitiveFileNames);

    // Associate an array of results with each include regex. This keeps results in order of the "include" order.
    // If there are no "includes", then just put everything in results[0].
    const results: string[][] = includeFileRegexes ? includeFileRegexes.map(() => []) : [[]];
    const visited = createMap<true>();
    const toCanonical = createGetCanonicalFileName(useCaseSensitiveFileNames);
    for (const basePath of patterns.basePaths) {
        visitDirectory(basePath, combinePaths(currentDirectory, basePath), depth);
    }

    return flatten(results);

    function visitDirectory(path: string, absolutePath: string, depth: number | undefined) {
        const canonicalPath = toCanonical(realpath(absolutePath));
        if (visited.has(canonicalPath)) return;
        visited.set(canonicalPath, true);
        const { files, directories } = getFileSystemEntries(path);

        for (const current of cloneAndSort<string>(files, compareStringsCaseSensitive)) {
            const name = combinePaths(path, current);
            const absoluteName = combinePaths(absolutePath, current);
            if (extensions && !fileExtensionIsOneOf(name, extensions)) continue;
            if (excludeRegex && excludeRegex.test(absoluteName)) continue;
            if (!includeFileRegexes) {
                results[0].push(name);
            }
            else {
                const includeIndex = findIndex(includeFileRegexes, re => re.test(absoluteName));
                if (includeIndex !== -1) {
                    results[includeIndex].push(name);
                }
            }
        }

        if (depth !== undefined) {
            depth--;
            if (depth === 0) {
                return;
            }
        }

        for (const current of cloneAndSort<string>(directories, compareStringsCaseSensitive)) {
            const name = combinePaths(path, current);
            const absoluteName = combinePaths(absolutePath, current);
            if ((!includeDirectoryRegex || includeDirectoryRegex.test(absoluteName)) &&
                (!excludeRegex || !excludeRegex.test(absoluteName))) {
                visitDirectory(name, absoluteName, depth);
            }
        }
    }
}

function findIndex<T>(array: readonly T[], predicate: (element: T, index: number) => boolean, startIndex?: number): number {
    for (let i = startIndex || 0; i < array.length; i++) {
        if (predicate(array[i], i)) {
            return i;
        }
    }
    return -1;
}

function fileExtensionIs(path: string, extension: string): boolean {
    return path.length > extension.length && path.endsWith(extension);
}

function fileExtensionIsOneOf(path: string, extensions: readonly string[]): boolean {
    for (const extension of extensions) {
        if (fileExtensionIs(path, extension)) {
            return true;
        }
    }

    return false;
}

function createGetCanonicalFileName(useCaseSensitiveFileNames: boolean): GetCanonicalFileName {
    return useCaseSensitiveFileNames ? identity : toLowerCase;
}

interface FileMatcherPatterns {
    /** One pattern for each "include" spec. */
    includeFilePatterns: readonly string[] | undefined;
    /** One pattern matching one of any of the "include" specs. */
    includeFilePattern: string | undefined;
    includeDirectoryPattern: string | undefined;
    excludePattern: string | undefined;
    basePaths: readonly string[];
}

interface WildcardMatcher {
    singleAsteriskRegexFragment: string;
    doubleAsteriskRegexFragment: string;
    replaceWildcardCharacter: (match: string) => string;
}

function getRegexFromPattern(pattern: string, useCaseSensitiveFileNames: boolean): RegExp {
    return new RegExp(pattern, useCaseSensitiveFileNames ? "" : "i");
}

function createMap<T>() {
    return new Map<string, T>();
}

/**
 * Computes the unique non-wildcard base paths amongst the provided include patterns.
 */
function getBasePaths(path: string, includes: readonly string[] | undefined, useCaseSensitiveFileNames: boolean): string[] {
    // Storage for our results in the form of literal paths (e.g. the paths as written by the user).
    const basePaths: string[] = [path];

    if (includes) {
        // Storage for literal base paths amongst the include patterns.
        const includeBasePaths: string[] = [];
        for (const include of includes) {
            // We also need to check the relative paths by converting them to absolute and normalizing
            // in case they escape the base path (e.g "..\somedirectory")
            const absolute: string = isRootedDiskPath(include) ? include : normalizePath(combinePaths(path, include));
            // Append the literal and canonical candidate base paths.
            includeBasePaths.push(getIncludeBasePath(absolute));
        }

        // Sort the offsets array using either the literal or canonical path representations.
        includeBasePaths.sort(getStringComparer(!useCaseSensitiveFileNames));

        // Iterate over each include base path and include unique base paths that are not a
        // subpath of an existing base path
        for (const includeBasePath of includeBasePaths) {
            if (every(basePaths, basePath => !containsPath(basePath, includeBasePath, path, !useCaseSensitiveFileNames))) {
                basePaths.push(includeBasePath);
            }
        }
    }

    return basePaths;
}

function getIncludeBasePath(absolute: string): string {
    const wildcardOffset = indexOfAnyCharCode(absolute, wildcardCharCodes);
    if (wildcardOffset < 0) {
        // No "*" or "?" in the path
        return !hasExtension(absolute)
            ? absolute
            : stripTrailingDirectorySeparator(getDirectoryPath(absolute));
    }
    return absolute.substring(0, absolute.lastIndexOf(path.sep, wildcardOffset));
}

function hasExtension(fileName: string): boolean {
    return stringContains(getBaseFileName(fileName), ".");
}

function stringContains(str: string, substring: string): boolean {
    return str.indexOf(substring) !== -1;
}

function getFileMatcherPatterns(path: string, excludes: readonly string[] | undefined, includes: readonly string[] | undefined, useCaseSensitiveFileNames: boolean, currentDirectory: string): FileMatcherPatterns {
    path = normalizePath(path);
    currentDirectory = normalizePath(currentDirectory);
    const absolutePath = combinePaths(currentDirectory, path);

    return {
        includeFilePatterns: map(getRegularExpressionsForWildcards(includes, absolutePath, "files"), pattern => `^${pattern}$`),
        includeFilePattern: getRegularExpressionForWildcard(includes, absolutePath, "files"),
        includeDirectoryPattern: getRegularExpressionForWildcard(includes, absolutePath, "directories"),
        excludePattern: getRegularExpressionForWildcard(excludes, absolutePath, "exclude"),
        basePaths: getBasePaths(path, includes, useCaseSensitiveFileNames)
    };
}

function getRegularExpressionForWildcard(specs: readonly string[] | undefined, basePath: string, usage: "files" | "directories" | "exclude"): string | undefined {
    const patterns = getRegularExpressionsForWildcards(specs, basePath, usage);
    if (!patterns || !patterns.length) {
        return undefined;
    }

    const pattern = patterns.map(pattern => `(${pattern})`).join("|");
    // If excluding, match "foo/bar/baz...", but if including, only allow "foo".
    const terminator = usage === "exclude" ? "($|/)" : "$";
    return `^(${pattern})${terminator}`;
}

function getRegularExpressionsForWildcards(specs: readonly string[] | undefined, basePath: string, usage: "files" | "directories" | "exclude"): readonly string[] | undefined {
    if (specs === undefined || specs.length === 0) {
        return undefined;
    }

    return flatMap(specs, spec =>
        spec && getSubPatternFromSpec(spec, basePath, usage, wildcardMatchers[usage]));
}

function last<T>(array: readonly T[]): T {
    debug.assert(array.length !== 0);
    return array[array.length - 1];
}

function isImplicitGlob(lastPathComponent: string): boolean {
    return !/[.*?]/.test(lastPathComponent);
}

function indexOfAnyCharCode(text: string, charCodes: readonly number[], start?: number): number {
    for (let i = start || 0; i < text.length; i++) {
        if (contains(charCodes, text.charCodeAt(i))) {
            return i;
        }
    }
    return -1;
}

const wildcardCharCodes = [Char.Asterisk, Char.QuestionMark];
const commonPackageFolders: readonly string[] = ["node_modules", "bower_components", "jspm_packages"];
const implicitExcludePathRegexPattern = `(?!(${commonPackageFolders.join("|")})(/|$))`;

// Reserved characters, forces escaping of any non-word (or digit), non-whitespace character.
// It may be inefficient (we could just match (/[-[\]{}()*+?.,\\^$|#\s]/g), but this is future
// proof.
const reservedCharacterPattern = /[^\w\s\/]/g;

const filesMatcher: WildcardMatcher = {
    /**
     * Matches any single directory segment unless it is the last segment and a .min.js file
     * Breakdown:
     *  [^./]                   # matches everything up to the first . character (excluding directory separators)
     *  (\\.(?!min\\.js$))?     # matches . characters but not if they are part of the .min.js file extension
     */
    singleAsteriskRegexFragment: "([^./]|(\\.(?!min\\.js$))?)*",
    /**
     * Regex for the ** wildcard. Matches any number of subdirectories. When used for including
     * files or directories, does not match subdirectories that start with a . character
     */
    doubleAsteriskRegexFragment: `(/${implicitExcludePathRegexPattern}[^/.][^/]*)*?`,
    replaceWildcardCharacter: match => replaceWildcardCharacter(match, filesMatcher.singleAsteriskRegexFragment)
};

const directoriesMatcher: WildcardMatcher = {
    singleAsteriskRegexFragment: "[^/]*",
    /**
     * Regex for the ** wildcard. Matches any number of subdirectories. When used for including
     * files or directories, does not match subdirectories that start with a . character
     */
    doubleAsteriskRegexFragment: `(/${implicitExcludePathRegexPattern}[^/.][^/]*)*?`,
    replaceWildcardCharacter: match => replaceWildcardCharacter(match, directoriesMatcher.singleAsteriskRegexFragment)
};

const excludeMatcher: WildcardMatcher = {
    singleAsteriskRegexFragment: "[^/]*",
    doubleAsteriskRegexFragment: "(/.+?)?",
    replaceWildcardCharacter: match => replaceWildcardCharacter(match, excludeMatcher.singleAsteriskRegexFragment)
};

const wildcardMatchers = {
    files: filesMatcher,
    directories: directoriesMatcher,
    exclude: excludeMatcher
};

function replaceWildcardCharacter(match: string, singleAsteriskRegexFragment: string) {
    return match === "*" ? singleAsteriskRegexFragment : match === "?" ? "[^/]" : "\\" + match;
}

function getSubPatternFromSpec(spec: string, basePath: string, usage: "files" | "directories" | "exclude", { singleAsteriskRegexFragment, doubleAsteriskRegexFragment, replaceWildcardCharacter }: WildcardMatcher): string | undefined {
    let subpattern = "";
    let hasWrittenComponent = false;
    const components = getPathComponents(combinePaths(basePath, spec));
    const lastComponent = last(components);
    if (usage !== "exclude" && lastComponent === "**") {
        return undefined;
    }

    // getNormalizedPathComponents includes the separator for the root component.
    // We need to remove to create our regex correctly.
    components[0] = stripTrailingDirectorySeparator(components[0]);

    if (isImplicitGlob(lastComponent)) {
        components.push("**", "*");
    }

    let optionalCount = 0;
    for (let component of components) {
        if (component === "**") {
            subpattern += doubleAsteriskRegexFragment;
        }
        else {
            if (usage === "directories") {
                subpattern += "(";
                optionalCount++;
            }

            if (hasWrittenComponent) {
                subpattern += path.sep;
            }

            if (usage !== "exclude") {
                let componentPattern = "";
                // The * and ? wildcards should not match directories or files that start with . if they
                // appear first in a component. Dotted directories and files can be included explicitly
                // like so: **/.*/.*
                if (component.charCodeAt(0) === Char.Asterisk) {
                    componentPattern += "([^./]" + singleAsteriskRegexFragment + ")?";
                    component = component.substr(1);
                }
                else if (component.charCodeAt(0) === Char.QuestionMark) {
                    componentPattern += "[^./]";
                    component = component.substr(1);
                }

                componentPattern += component.replace(reservedCharacterPattern, replaceWildcardCharacter);

                // Patterns should not include subfolders like node_modules unless they are
                // explicitly included as part of the path.
                //
                // As an optimization, if the component pattern is the same as the component,
                // then there definitely were no wildcard characters and we do not need to
                // add the exclusion pattern.
                if (componentPattern !== component) {
                    subpattern += implicitExcludePathRegexPattern;
                }

                subpattern += componentPattern;
            }
            else {
                subpattern += component.replace(reservedCharacterPattern, replaceWildcardCharacter);
            }
        }

        hasWrittenComponent = true;
    }

    while (optionalCount > 0) {
        subpattern += ")?";
        optionalCount--;
    }

    return subpattern;
}

function flatMap<T, U>(array: readonly T[] | undefined, mapfn: (x: T, i: number) => U | readonly U[] | undefined): readonly U[] {
    let result: U[] | undefined;
    if (array) {
        for (let i = 0; i < array.length; i++) {
            const v = mapfn(array[i], i);
            if (v) {
                if (isArray(v)) {
                    result = addRange(result, v);
                }
                else {
                    result = append(result, v);
                }
            }
        }
    }
    return result || emptyArray;
}
////////////////////////////////