/*
 * uri.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * URI class for storing and manipulating URIs.
 */

import { platform } from 'process';
import { URI, Utils } from 'vscode-uri';
import { some } from './collectionUtils';
import {
    combinePaths,
    ensureTrailingDirectorySeparator,
    getDirectoryPath,
    getFileExtension,
    getFileName,
    getPathComponents,
    getRootLength,
    getShortenedFileName,
    hasTrailingDirectorySeparator,
    isDiskPathRoot,
    normalizeSlashes,
} from './pathUtils';

const EmptyKey = '<empty>';

export abstract class Uri {
    private static _counter = 0;
    private static _uniqueUris = new Set<string>();
    private static _countPerMethod = new Map<string, number>();
    protected constructor(private readonly _key: string, creationMethod: string) {
        Uri._counter++;
        Uri._uniqueUris.add(_key);
        const currentCount = Uri._countPerMethod.get(creationMethod) || 0;
        Uri._countPerMethod.set(creationMethod, currentCount + 1);
    }

    // Unique key for storing in maps.
    get key() {
        return this._key;
    }

    // Returns the scheme of the URI.
    abstract get scheme(): string;

    // Returns the last segment of the URI, similar to the UNIX basename command.
    abstract get basename(): string;

    // Returns the extension of the URI, similar to the UNIX extname command.
    abstract get extname(): string;

    // Returns a URI where the path just contains the root folder.
    abstract get root(): Uri;

    static count(): number {
        return Uri._counter;
    }

    static uniqueCount(): number {
        return Uri._uniqueUris.size;
    }

    static methods(): string[] {
        return Array.from(Uri._countPerMethod.keys());
    }

    static countPerMethod(method: string): number {
        return Uri._countPerMethod.get(method) ?? 0;
    }

    isEmpty(): boolean {
        return false;
    }

    abstract toString(): string;

    abstract toUserVisibleString(): string;

    abstract matchesRegex(regex: RegExp): boolean;

    abstract replaceExtension(ext: string): Uri;

    addExtension(ext: string): Uri {
        return this.addPath(ext);
    }

    abstract addPath(extra: string): Uri;

    // Returns a URI where the path is the directory name of the original URI, similar to the UNIX dirname command.
    abstract getDirectory(): Uri;

    getRootPathLength(): number {
        return this.getRootPath().length;
    }

    /**
     * Determines whether a path is an absolute disk path (e.g. starts with `/`, or a dos path
     * like `c:`, `c:\` or `c:/`).
     */
    isRootDiskPath(): boolean {
        return this.getRootPath().length > 0;
    }

    /**
     * Determines whether a path consists only of a path root.
     */
    abstract isDiskPathRoot(): boolean;

    // Determines whether a Uri is a child of some parent Uri.
    abstract isChild(parent: Uri, ignoreCase: boolean): boolean;

    isLocal(): boolean {
        return false;
    }

    isUntitled(): boolean {
        return this.scheme === 'untitled';
    }

    equals(other: Uri | undefined, ignoreCase = false): boolean {
        if (ignoreCase) {
            return this._key.toLowerCase() === other?._key.toLowerCase();
        }
        return this.key === other?.key;
    }

    abstract startsWith(other: Uri | undefined, ignoreCase: boolean): boolean;

    pathStartsWith(name: string): boolean {
        // ignore path separators.
        name = normalizeSlashes(name);
        return this.getComparablePath().startsWith(name);
    }

    pathEndsWith(name: string): boolean {
        // ignore path separators.
        name = normalizeSlashes(name);
        return this.getComparablePath().endsWith(name);
    }

    pathIncludes(include: string): boolean {
        // ignore path separators.
        include = normalizeSlashes(include);
        return this.getComparablePath().includes(include);
    }

    // How long the path for this Uri is.
    abstract getPathLength(): number;

    abstract combinePaths(...paths: string[]): Uri;

    getRelativePath(child: Uri): string | undefined {
        if (this.scheme !== child.scheme) {
            return undefined;
        }

        // Unlike getRelativePathComponents, this function should not return relative path
        // markers for non children.
        if (child.isChild(this, false)) {
            const relativeToComponents = this.getRelativePathComponents(child);
            if (relativeToComponents.length > 0) {
                return ['.', ...relativeToComponents].join('/');
            }
        }
        return undefined;
    }

    abstract getPathComponents(): string[];

    getRelativePathComponents(to: Uri): string[] {
        const fromComponents = this.getPathComponents();
        const toComponents = to.getPathComponents();

        let start: number;
        for (start = 0; start < fromComponents.length && start < toComponents.length; start++) {
            const fromComponent = fromComponents[start];
            const toComponent = toComponents[start];
            if (fromComponent !== toComponent) {
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
        return [...relative, ...components];
    }

    abstract getShortenedFileName(maxDirLength: number): string;

    abstract stripExtension(): Uri;

    stripAllExtensions(): Uri {
        const base = this.basename;
        const dir = this.getDirectory();
        const stripped = base.split('.')[0];
        return dir.combinePaths(stripped);
    }

    protected abstract getRootPath(): string;

    protected reducePathComponents(components: string[]): string[] {
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

    protected abstract getComparablePath(): string;
}

// Class that represents a URI that is a file path.
class FileUri extends Uri {
    private _formattedString: string | undefined;
    private _directory: FileUri | undefined;
    private static _cache = new Map<string, FileUri>();
    private constructor(
        private readonly _filePath: string,
        private _originalString: string | undefined,
        creationMethod: string
    ) {
        // Use the file path as the key.
        super(_filePath, creationMethod);
    }

    override get scheme(): string {
        return 'file';
    }
    override get basename(): string {
        return getFileName(this._filePath);
    }
    override get extname(): string {
        return getFileExtension(this._filePath);
    }
    override get root(): Uri {
        const rootPath = this.getRootPath();
        if (rootPath !== this._filePath) {
            return new FileUri(rootPath, undefined, 'root');
        }
        return this;
    }

    static create(filePath: string, originalString: string | undefined, creationMethod: string): FileUri {
        // Skip creating if we already have one. This is a perf optimization.
        if (!FileUri._cache.has(filePath)) {
            FileUri._cache.set(filePath, new FileUri(filePath, originalString, creationMethod));
        }
        return FileUri._cache.get(filePath)!;
    }

    static isFileUri(uri: Uri): uri is FileUri {
        return uri.scheme === 'file' && (uri as any)._filePath !== undefined;
    }
    override matchesRegex(regex: RegExp): boolean {
        // Compare the regex to our path but normalize it for comparison.
        // The regex assumes it's comparing itself to a URI path.
        const path = this._filePath.replace(/\\/g, '/');
        return regex.test(path);
    }

    override toString(): string {
        if (!this._formattedString) {
            this._formattedString = this._originalString || URI.file(this._filePath).toString();
        }
        return this._formattedString;
    }
    override toUserVisibleString(): string {
        return this._filePath;
    }
    override replaceExtension(ext: string): Uri {
        const dir = this.getDirectory();
        const base = this.basename;
        const newBase = base.slice(0, base.length - this.extname.length) + ext;
        return dir.combinePaths(newBase);
    }
    override addPath(extra: string): Uri {
        return FileUri.create(this._filePath + extra, undefined, 'addPath');
    }
    override getDirectory(): Uri {
        // Cache the directory as this gets called a lot.
        if (!this._directory) {
            // Remove the separator on the end if there is one.
            const filePath =
                hasTrailingDirectorySeparator(this._filePath) && this._filePath.length > 1
                    ? this._filePath.slice(0, -1)
                    : this._filePath;
            const dir = getDirectoryPath(filePath);
            if (dir !== filePath) {
                // Path has to not end with a separator.
                const normalized = hasTrailingDirectorySeparator(dir) && dir.length > 1 ? dir.slice(0, -1) : dir;
                this._directory = FileUri.create(normalized, undefined, 'getDirectory');
            } else {
                this._directory = this;
            }
        }
        return this._directory;
    }
    override isDiskPathRoot(): boolean {
        return isDiskPathRoot(this._filePath);
    }
    override isChild(parent: Uri, ignoreCase: boolean): boolean {
        if (!FileUri.isFileUri(parent)) {
            return false;
        }

        return this.startsWith(parent, ignoreCase) && parent._filePath.length < this._filePath.length;
    }
    override startsWith(other: Uri | undefined, ignoreCase: boolean): boolean {
        if (!other || !FileUri.isFileUri(other)) {
            return false;
        }
        if (other.isEmpty() !== this.isEmpty()) {
            return false;
        }
        if (this.scheme !== other.scheme) {
            return false;
        }
        if (this._filePath.length >= other._filePath.length) {
            // Make sure the other ends with a / when comparing longer paths, otherwise we might
            // say that /a/food is a child of /a/foo.
            const otherPath =
                this._filePath.length > other._filePath.length && !hasTrailingDirectorySeparator(other._filePath)
                    ? ensureTrailingDirectorySeparator(other._filePath)
                    : other._filePath;

            if (ignoreCase) {
                return this._filePath.toLowerCase().startsWith(otherPath.toLowerCase());
            }
            return this._filePath.startsWith(otherPath);
        }
        return false;
    }
    override getPathLength(): number {
        return this._filePath.length;
    }
    override combinePaths(...paths: string[]): Uri {
        const combined = combinePaths(this._filePath, ...paths);
        if (combined !== this._filePath) {
            return FileUri.create(combined, undefined, 'combinePaths');
        }
        return this;
    }
    override getPathComponents(): string[] {
        const components = getPathComponents(this._filePath);
        // Remove the first one if it's empty. The new algorithm doesn't
        // expect this to be there.
        if (components.length > 0 && components[0] === '') {
            components.shift();
        }
        return components;
    }
    override getShortenedFileName(maxDirLength: number): string {
        return getShortenedFileName(this._filePath, maxDirLength);
    }
    override stripExtension(): Uri {
        const dir = this.getDirectory();
        const base = this.basename;
        const stripped = base.split('.')[0];
        return dir.combinePaths(stripped);
    }
    protected override getRootPath(): string {
        return this._filePath.slice(0, getRootLength(this._filePath));
    }
    protected override getComparablePath(): string {
        return normalizeSlashes(this._filePath);
    }
}

// Class that represents a URI that is not a file path.
class WebUri extends Uri {
    private _formattedString: string | undefined;
    private _directory: WebUri | undefined;
    private static _cache = new Map<string, WebUri>();
    private constructor(
        private readonly _scheme: string,
        private readonly _authority: string,
        private readonly _path: string,
        private readonly _query: string,
        private readonly _fragment: string,
        private readonly _originalString: string | undefined,
        key: string,
        creationMethod: string
    ) {
        super(key, creationMethod);
    }

    override get scheme(): string {
        return this._scheme;
    }
    override get basename(): string {
        // Path should already be normalized, just get the last on a split of '/'.
        const components = this._path.split('/');
        return components[components.length - 1];
    }
    override get extname(): string {
        const basename = this.basename;
        const index = basename.lastIndexOf('.');
        if (index >= 0) {
            return basename.slice(index);
        }
        return '';
    }
    override get root(): Uri {
        const rootPath = this.getRootPath();
        if (rootPath !== this._path) {
            return WebUri.create(this._scheme, this._authority, rootPath, '', '', undefined, 'root');
        }
        return this;
    }
    static create(
        scheme: string,
        authority: string,
        path: string,
        query: string,
        fragment: string,
        originalString: string | undefined,
        creationMethod: string
    ): WebUri {
        const key = WebUri._createKey(scheme, authority, path, query, fragment);
        if (!WebUri._cache.has(key)) {
            WebUri._cache.set(
                key,
                new WebUri(scheme, authority, path, query, fragment, originalString, key, creationMethod)
            );
        }
        return WebUri._cache.get(key)!;
    }
    override toString(): string {
        throw new Error('Method not implemented.');
    }
    override toUserVisibleString(): string {
        throw new Error('Method not implemented.');
    }
    override matchesRegex(regex: RegExp): boolean {
        throw new Error('Method not implemented.');
    }
    override replaceExtension(ext: string): Uri {
        throw new Error('Method not implemented.');
    }
    override addPath(extra: string): Uri {
        throw new Error('Method not implemented.');
    }
    override getDirectory(): Uri {
        throw new Error('Method not implemented.');
    }
    override isDiskPathRoot(): boolean {
        throw new Error('Method not implemented.');
    }
    override isChild(parent: Uri, ignoreCase: boolean): boolean {
        throw new Error('Method not implemented.');
    }
    override startsWith(other: Uri | undefined, ignoreCase: boolean): boolean {
        throw new Error('Method not implemented.');
    }
    override getPathLength(): number {
        throw new Error('Method not implemented.');
    }
    override combinePaths(...paths: string[]): Uri {
        throw new Error('Method not implemented.');
    }
    override getPathComponents(): string[] {
        throw new Error('Method not implemented.');
    }
    override getShortenedFileName(maxDirLength: number): string {
        throw new Error('Method not implemented.');
    }
    override stripExtension(): Uri {
        throw new Error('Method not implemented.');
    }
    protected override getRootPath(): string {
        throw new Error('Method not implemented.');
    }
    protected override getComparablePath(): string {
        throw new Error('Method not implemented.');
    }

    private static _createKey(scheme: string, authority: string, path: string, query: string, fragment: string) {
        return `${scheme}://${authority}${path}${query ? '?' + query : ''}${fragment ? '#' + fragment : ''}`;
    }
}

class EmptyUri extends Uri {
    private static _instance = new EmptyUri();
    constructor() {
        super(EmptyKey, 'empty');
    }

    static get instance() {
        return EmptyUri._instance;
    }

    override get scheme(): string {
        throw new Error('Method not implemented.');
    }
    override get basename(): string {
        throw new Error('Method not implemented.');
    }
    override get extname(): string {
        throw new Error('Method not implemented.');
    }
    override get root(): Uri {
        throw new Error('Method not implemented.');
    }
    override toString(): string {
        throw new Error('Method not implemented.');
    }
    override toUserVisibleString(): string {
        throw new Error('Method not implemented.');
    }
    override matchesRegex(regex: RegExp): boolean {
        throw new Error('Method not implemented.');
    }
    override replaceExtension(ext: string): Uri {
        throw new Error('Method not implemented.');
    }
    override addPath(extra: string): Uri {
        throw new Error('Method not implemented.');
    }
    override getDirectory(): Uri {
        throw new Error('Method not implemented.');
    }
    override isDiskPathRoot(): boolean {
        throw new Error('Method not implemented.');
    }
    override isChild(parent: Uri, ignoreCase: boolean): boolean {
        throw new Error('Method not implemented.');
    }
    override startsWith(other: Uri | undefined, ignoreCase: boolean): boolean {
        throw new Error('Method not implemented.');
    }
    override getPathLength(): number {
        throw new Error('Method not implemented.');
    }
    override combinePaths(...paths: string[]): Uri {
        throw new Error('Method not implemented.');
    }
    override getPathComponents(): string[] {
        throw new Error('Method not implemented.');
    }
    override getShortenedFileName(maxDirLength: number): string {
        throw new Error('Method not implemented.');
    }
    override stripExtension(): Uri {
        throw new Error('Method not implemented.');
    }
    protected override getRootPath(): string {
        throw new Error('Method not implemented.');
    }
    protected override getComparablePath(): string {
        throw new Error('Method not implemented.');
    }
}

// Returns just the fsPath path portion of a vscode URI.
function getFilePath(uri: URI): string {
    let filePath: string | undefined;

    // Compute the file path ourselves. The vscode.URI class doesn't
    // treat UNC shares with a single slash as UNC paths.
    // https://github.com/microsoft/vscode-uri/blob/53e4ca6263f2e4ddc35f5360c62bc1b1d30f27dd/src/uri.ts#L567
    if (uri.authority && uri.path[0] === '/' && uri.path.length === 1) {
        filePath = `//${uri.authority}${uri.path}`;
    } else {
        // Otherwise use the vscode.URI version
        filePath = uri.fsPath;
    }

    // If this is a DOS-style path with a drive letter, remove
    // the leading slash.
    if (filePath.match(/^\/[a-zA-Z]:\//)) {
        filePath = filePath.slice(1);
    }

    // vscode.URI noralizes the path to use the correct path separators.
    // We need to do the same.
    if (platform === 'win32') {
        filePath = filePath.replace(/\//g, '\\');
    }

    return filePath;
}

// Function called to normalize input URIs. This gets rid of '..' and '.' in the path.
// It also removes any '/' on the end of the path.
// This is slow but should only be called when the URI is first created.
function normalizeUri(uri: string | URI): { uri: URI; str: string } {
    // Make sure the drive letter is lower case. This
    // is consistent with what VS code does for URIs.
    let originalString = URI.isUri(uri) ? uri.toString() : uri;
    const parsed = URI.isUri(uri) ? uri : URI.parse(uri);
    if (parsed.scheme === 'file') {
        // The Vscode.URI parser makes sure the drive is lower cased.
        originalString = parsed.toString();
    }

    // Original URI may not have resolved all the `..` in the path, so remove them.
    // Note: this also has the effect of removing any trailing slashes.
    const finalURI = Utils.resolvePath(parsed);
    const finalString = finalURI.path.length !== parsed.path.length ? finalURI.toString() : originalString;
    return { uri: finalURI, str: finalString };
}

export namespace Uri {
    export function file(path: string): Uri {
        // If this already starts with 'file:', then we can
        // parse it normally. It's actually a uri string. Otherwise parse it as a file path.
        const normalized = path.startsWith('file:') ? normalizeUri(path) : normalizeUri(URI.file(path));

        // Turn the path into a file URI.
        return new FileUri(getFilePath(normalized.uri), normalized.str, 'file');
    }

    export function empty(): Uri {
        return EmptyUri.instance;
    }

    export function parse(value: string | undefined): Uri {
        if (!value) {
            return Uri.empty();
        }

        // Normalize the value here. This gets rid of '..' and '.' in the path. It also removes any
        // '/' on the end of the path.
        const normalized = normalizeUri(value);
        if (normalized.uri.scheme === 'file') {
            return new FileUri(normalized.uri.fsPath, normalized.str, 'parse');
        }
        return new WebUri(
            normalized.uri.scheme,
            normalized.uri.authority,
            normalized.uri.path,
            normalized.uri.query,
            normalized.uri.fragment,
            normalized.str,
            'parse'
        );
    }

    export function fromKey(key: string): Uri {
        // Right now the key is the same as the original string. Just parse it.
        return Uri.parse(key);
    }

    export function isUri(thing: any): thing is Uri {
        return !!thing && typeof thing._key === 'string';
    }
}
