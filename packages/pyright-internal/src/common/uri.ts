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
import { getPathComponents, getRootLength, hasTrailingDirectorySeparator, normalizeSlashes } from './pathUtils';

const EmptyKey = '<empty>';

class EmptyURI extends URI {
    constructor() {
        super({ scheme: '', authority: '', path: '', query: '', fragment: '' });
    }

    override toString(skipEncoding?: boolean | undefined): string {
        return '';
    }
}

export class Uri {
    private readonly _string;
    private readonly _uri: URI;
    private readonly _key: string;
    private static _empty = new Uri(new EmptyURI(), EmptyKey);

    private constructor(uri: string | URI, key?: string) {
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
        this._uri = key === EmptyKey ? parsed : Utils.resolvePath(parsed);
        this._string = this._uri.path.length !== parsed.path.length ? this._uri.toString() : originalString;
        this._key = key ?? Uri._computeKey(this._uri);
    }

    get key() {
        return this._key;
    }

    // Returns the last segment of the URI, similar to the UNIX basename command.
    get basename(): string {
        return Utils.basename(this._uri.with({ query: '', fragment: '' }));
    }

    // Returns the extension of the URI, similar to the UNIX extname command.
    get extname(): string {
        return Utils.extname(this._uri.with({ query: '', fragment: '' }));
    }

    // Returns a URI where the path just contains the root folder.
    get root(): Uri {
        const rootPath = this._getRootPath();
        if (this._uri.scheme === 'file' && rootPath !== this.getFilePath()) {
            return Uri.file(rootPath);
        } else if (rootPath !== this._uri.path) {
            return new Uri(this._uri.with({ path: rootPath, query: '', fragment: '' }));
        }
        // Root path was not different, make sure we return a copy of the same
        // uri. URI parsing can remove extra slashes, etc. so we need to make sure we
        // return the same thing.
        return new Uri(this._string);
    }

    static empty(): Uri {
        return Uri._empty;
    }

    static parse(value: string | undefined): Uri {
        if (!value) {
            return Uri.empty();
        }
        return new Uri(value);
    }

    static file(path: string): Uri {
        // If this already starts with 'file:', then we can
        // parse it normally. It's actually a uri string.
        if (path.startsWith('file:')) {
            return Uri.parse(path);
        }

        // Otherwise assume this is a file path.
        return new Uri(URI.file(path));
    }

    static fromKey(key: string): Uri {
        // Right now the key is the same as the original string. Just parse it.
        return Uri.parse(key);
    }

    static isUri(thing: any): thing is Uri {
        return !!thing && typeof thing._uri?.with === 'function';
    }

    isEmpty(): boolean {
        return this === Uri._empty;
    }

    toString(): string {
        return this._string;
    }

    toUserVisibleString(): string {
        if (this._uri.scheme === 'file') {
            return this.getFilePath();
        }
        return this._uri.toString();
    }

    matchesRegex(regex: RegExp): boolean {
        // Compare the regex to our path.
        let path = this.getPath();

        // Special case: If a file URI and we have a drive root, remove the '/' that could be
        // on the front.
        if (this._uri.scheme === 'file' && /^\/[a-zA-Z]:\//.test(path)) {
            path = path.slice(1);
        }

        return regex.test(path);
    }

    replaceExtension(ext: string): Uri {
        const path = this.getPath();
        const existing = this.extname;
        const index = path.lastIndexOf(existing);
        if (index > 0) {
            return new Uri(this._uri.with({ path: path.slice(0, index) + ext, fragment: '', query: '' }));
        }
        return new Uri(this._uri.with({ path: path + ext, fragment: '', query: '' }));
    }

    addExtension(ext: string): Uri {
        return this.addPath(ext);
    }

    addPath(extra: string): Uri {
        const path = this.getPath();
        return new Uri(this._uri.with({ path: path + extra, fragment: '', query: '' }));
    }

    remove(fileOrDirName: string): Uri {
        const path = this.getPath();
        const index = path.lastIndexOf(fileOrDirName);
        if (index > 0) {
            return new Uri(this._uri.with({ path: path.slice(0, index), fragment: '', query: '' }));
        }
        return new Uri(this._uri);
    }

    // Returns just the fsPath path portion of the URI.
    getFilePath(): string {
        let filePath: string | undefined;

        // Compute the file path ourselves. The vscode.URI class doesn't
        // treat UNC shares with a single slash as UNC paths.
        // https://github.com/microsoft/vscode-uri/blob/53e4ca6263f2e4ddc35f5360c62bc1b1d30f27dd/src/uri.ts#L567
        if (this._uri.authority && this._uri.path[0] === '/' && this._uri.path.length === 1) {
            filePath = `//${this._uri.authority}${this._uri.path}`;
        } else {
            // Otherwise use the vscode.URI version
            filePath = this._uri.fsPath;
        }

        // vscode.URI noralizes the path to use the correct path separators.
        // We need to do the same.
        if (platform === 'win32') {
            return filePath.replace(/\//g, '\\');
        }
        return filePath;
    }

    // Returns just the path portion of the URI.
    getPath(): string {
        return this._uri.path;
    }

    // Returns a URI where the path is the directory name of the original URI, similar to the UNIX dirname command.
    getDirectory(): Uri {
        return new Uri(Utils.dirname(this._uri.with({ query: '', fragment: '' })));
    }

    getRootPathLength(): number {
        return this._getRootPath().length;
    }

    /**
     * Determines whether a path is an absolute disk path (e.g. starts with `/`, or a dos path
     * like `c:`, `c:\` or `c:/`).
     */
    isRootDiskPath(): boolean {
        return this._getRootPath().length > 0;
    }

    /**
     * Determines whether a path consists only of a path root.
     */
    isDiskPathRoot(): boolean {
        const comparablePath = this._getComparablePath();
        return this._getRootPath().length === comparablePath.length && this._getRootPath().length > 0;
    }

    isChild(parent: Uri, ignoreCase = false): boolean {
        if (this._uri.scheme !== parent._uri.scheme) {
            return false;
        }
        if (this._uri.authority !== parent._uri.authority) {
            return false;
        }
        return this.startsWith(parent, ignoreCase) && parent.getPath().length < this.getPath().length;
    }

    isLocal(): boolean {
        return this._uri.scheme === 'file';
    }

    isUntitled(): boolean {
        return this._uri.scheme === 'untitled';
    }

    equals(other: Uri | undefined, ignoreCase = false): boolean {
        if (ignoreCase) {
            return this._key.toLowerCase() === other?._key.toLowerCase();
        }
        return this.key === other?.key;
    }

    startsWith(other: Uri | undefined, ignoreCase = false): boolean {
        if (!other) {
            return false;
        }
        if (other.isEmpty() !== this.isEmpty()) {
            return false;
        }
        if (this._uri.scheme !== other._uri.scheme) {
            return false;
        }
        if (this._uri.authority !== other._uri.authority) {
            return false;
        }
        if (this._uri.path.length >= other._uri.path.length) {
            // Fragment or query are not taken into consideration.

            // Make sure the other ends with a / when comparing longer paths, otherwise we might
            // say that /a/food is a child of /a/foo.
            const otherPath =
                this._uri.path.length > other._uri.path.length && !hasTrailingDirectorySeparator(other._uri.path)
                    ? `${other._uri.path}/`
                    : other._uri.path;

            if (ignoreCase) {
                return this._uri.path.toLowerCase().startsWith(otherPath.toLowerCase());
            }
            return this._uri.path.startsWith(otherPath);
        }
        return false;
    }

    pathStartsWith(name: string): boolean {
        // ignore path separators.
        name = normalizeSlashes(name);
        return this._getComparablePath().startsWith(name);
    }

    pathEndsWith(name: string): boolean {
        // ignore path separators.
        name = normalizeSlashes(name);
        return this._getComparablePath().endsWith(name);
    }

    pathIncludes(include: string): boolean {
        // ignore path separators.
        include = normalizeSlashes(include);
        return this._getComparablePath().includes(include);
    }

    // How long the path for this Uri is.
    getPathLength(): number {
        return this.getPath().length;
    }

    combinePaths(...paths: string[]): Uri {
        // Combining with empty always gives out empty.
        if (this.isEmpty()) {
            return Uri.empty();
        }
        // Make sure none of the paths are rooted. If so, use that as a file path
        // and combine the rest.
        const rooted = paths.findIndex((p) => getRootLength(p) > 0 || getRootLength(p, '/') > 0);
        if (rooted >= 0) {
            return new Uri(Utils.joinPath(URI.file(paths[rooted]), ...paths.slice(rooted + 1)));
        }

        // Otherwise just join the paths.
        return new Uri(Utils.joinPath(this._uri.with({ fragment: '', query: '' }), ...paths));
    }

    getRelativePath(child: Uri): string | undefined {
        if (this._uri.scheme !== child._uri.scheme) {
            return undefined;
        }
        const relativeToComponents = this.getRelativePathComponents(child);
        if (relativeToComponents.length > 0) {
            return ['.', ...relativeToComponents].join('/');
        }
        return undefined;
    }

    getPathComponents(): string[] {
        if (this.isEmpty()) {
            return [];
        }
        // Use the old algorithm for file paths.
        if (this._uri.scheme === 'file') {
            // But make sure to return '/' delimited paths because the return value
            // of this function is supposed to relate to the 'path' of the URI.
            return getPathComponents(this.getFilePath()).map((p) => p.replace(/\\/g, '/'));
        }

        // Otherwise get the root path and the rest of the path components.
        const rootPath = this._getRootPath();
        const otherPaths = this.getPath().slice(rootPath.length).split('/');
        return this._reducePathComponents([rootPath, ...otherPaths]);
    }

    getRelativePathComponents(child: Uri): string[] {
        if (!child.isChild(this)) {
            return [];
        }

        const childComponents = child.getPathComponents();
        const parentComponents = this.getPathComponents();

        if (childComponents.length < parentComponents.length) {
            return [];
        }

        return childComponents.slice(parentComponents.length);
    }

    getShortenedFileName(maxDirLength = 15) {
        const fileName = this.basename;
        const dirName = this.getDirectory().getPath();
        if (dirName.length > maxDirLength) {
            return `...${dirName.slice(dirName.length - maxDirLength)}/${fileName}`;
        }
        return this.getPath();
    }

    stripExtension(): Uri {
        const path = this.getPath();
        const index = path.lastIndexOf('.');
        if (index > 0) {
            return new Uri(this._uri.with({ path: path.slice(0, index), fragment: '', query: '' }));
        }
        return new Uri(this._uri);
    }

    stripAllExtensions(): Uri {
        const base = this.basename;
        const dir = this.getDirectory();
        const stripped = base.split('.')[0];
        return dir.combinePaths(stripped);
    }

    private _getRootPath(): string {
        if (this._uri.scheme === 'file') {
            const rootLength = getRootLength(this.getFilePath());
            return this.getFilePath().slice(0, rootLength);
        }

        const rootLength = getRootLength(this._uri.path, '/');
        return this._uri.path.slice(0, rootLength);
    }

    private _reducePathComponents(components: string[]): string[] {
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

    private _getComparablePath(): string {
        if (this._uri.scheme === 'file') {
            return normalizeSlashes(this.getFilePath());
        }
        return normalizeSlashes(this._uri.path);
    }

    private static _computeKey(uri: URI) {
        // To make sure that foo:///a/b/c and foo:///a/b/c/ compare the
        // same, remove any trailing slashes on the path.
        if (hasTrailingDirectorySeparator(uri.path)) {
            return uri.with({ path: uri.path.slice(0, -1) }).toString();
        }
        return uri.toString();
    }
}
