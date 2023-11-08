/*
 * uri.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * URI class for storing and manipulating URIs.
 */

import { URI, Utils } from 'vscode-uri';
import { some } from './collectionUtils';
import { getRootLength } from './pathUtils';

export class Uri {
    private readonly _string;
    private readonly _uri: URI;
    private readonly _key: string;
    private static _empty = new Uri(URI.parse(''), '<empty>');

    private constructor(uri: string | URI, key?: string) {
        // Make sure the drive letter is lower case. This
        // is consistent with what VS code does for URIs.
        const uriStr = URI.isUri(uri) ? uri.toString() : uri;
        let parsed = URI.parse(uriStr);
        if (parsed.scheme === 'file') {
            if (/^[a-zA-Z]:/.test(parsed.fsPath)) {
                parsed = parsed.with({ path: parsed.fsPath[0].toLowerCase() + parsed.fsPath.slice(1) });
            }
        }
        this._uri = parsed;
        this._string = parsed.toString();
        this._key = key ?? this._string;
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
        return new Uri(this._uri.with({ path: this._getRootPath(), query: '', fragment: '' }));
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
        return typeof thing._uri?.isUri === 'function' && thing._uri.isUri();
    }

    isEmpty(): boolean {
        return this === Uri._empty;
    }

    toString(): string {
        return this._string;
    }

    toUserVisibleString(): string {
        if (this._uri.scheme === 'file') {
            return this._uri.fsPath;
        }
        return this._uri.toString();
    }

    test(regex: RegExp): boolean {
        // Just test the path portion of the URI.
        return regex.test(this.getPath());
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
        const path = this.getPath();
        return new Uri(this._uri.with({ path: path + ext, fragment: '', query: '' }));
    }

    addPath(extra: string): Uri {
        const path = this.getPath();
        return new Uri(this._uri.with({ path: path + extra, fragment: '', query: '' }));
    }

    remove(fileOrDirName: string): Uri {
        const path = this.getPath();
        const index = path.lastIndexOf(fileOrDirName);
        if (index > 0) {
            return new Uri(this._uri.with({ path: path.slice(0, index) }));
        }
        return new Uri(this._uri);
    }

    // Returns just the fsPath path portion of the URI.
    getFilePath(): string {
        // Might want to assert this is a file scheme.
        return this._uri.fsPath;
    }

    // Returns just the path portion of the URI.
    getPath(): string {
        return this._uri.path;
    }

    // Returns a URI where the path is the directory name of the original URI, similar to the UNIX dirname command.
    getDirectory(): Uri {
        return new Uri(Utils.dirname(this._uri.with({ query: '', fragment: '' })));
    }

    getRootLength(): number {
        return this._getRootPath().length;
    }

    getAllExtensions(): string {
        const path = this.getPath();
        const index = path.lastIndexOf('.');
        if (index > 0) {
            return path.slice(index);
        }
        return '';
    }

    // Slice the path portion of the URI.
    slicePath(start: number, end?: number): string {
        return this.getPath().slice(start, end);
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
        return this._getRootPath().length === this.getPath().length && this._getRootPath().length > 0;
    }

    isChild(parent: Uri): boolean {
        if (this._uri.scheme !== parent._uri.scheme) {
            return false;
        }
        if (this._uri.authority !== parent._uri.authority) {
            return false;
        }
        return this.getPath().startsWith(parent.getPath()) && parent.getPath().length < this.getPath().length;
    }

    isLocal(): boolean {
        return this._uri.scheme === 'file';
    }

    isUntitled(): boolean {
        return this._uri.scheme === 'untitled';
    }

    equals(other: Uri | undefined): boolean {
        return this.key === other?.key;
    }

    startsWith(other: Uri): boolean {
        return this._uri.toString().startsWith(other._uri.toString());
    }

    pathStartsWith(name: string): boolean {
        return this.getPath().startsWith(name);
    }

    pathEndsWith(name: string): boolean {
        return this.getPath().endsWith(name);
    }

    pathIncludes(include: string): boolean {
        return this.getPath().includes(include);
    }

    // How long the path for this Uri is.
    pathLength(): number {
        return this.getPath().length;
    }

    combinePaths(...paths: string[]): Uri {
        // Make sure none of the paths are rooted. If so, use that as a file path
        // and combine the rest.
        const rooted = paths.findIndex((p) => getRootLength(p) > 0);
        if (rooted >= 0) {
            return new Uri(Utils.joinPath(URI.file(paths[rooted]), ...paths.slice(rooted)));
        }

        // Otherwise just join the paths.
        return new Uri(Utils.joinPath(this._uri.with({ fragment: '', query: '' }), ...paths));
    }

    getRelativePath(relativeTo: Uri): string | undefined {
        if (this._uri.scheme !== relativeTo._uri.scheme) {
            return undefined;
        }
        const pathComponents = this.getPathComponents();
        const relativeToComponents = relativeTo.getPathComponents();

        let relativePath = '.';
        for (let i = relativeToComponents.length; i < pathComponents.length; i++) {
            relativePath += `/${pathComponents[i]}`;
        }

        return relativePath;
    }

    getPathComponents(): string[] {
        return this._reducePathComponents(this.getPath().split('/'));
    }

    getRelativePathComponents(child: Uri): string[] {
        const childComponents = child.getPathComponents();
        const parentComponents = this.getPathComponents();

        if (childComponents.length < parentComponents.length) {
            return [];
        }

        for (let i = 0; i < parentComponents.length; i++) {
            if (parentComponents[i] !== childComponents[i]) {
                return [];
            }
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
        return this._uri.path.split('/')[0];
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

    private static _normalizeUriString(uri: string): string {
        // Make sure the drive letter is lower case.
        let parsed = URI.parse(uri);
        if (parsed.scheme === 'file') {
            if (/^[a-zA-Z]:/.test(parsed.fsPath)) {
                parsed = parsed.with({ path: parsed.fsPath[0].toLowerCase() + parsed.fsPath.slice(1) });
            }
        }
        return parsed.toString();
    }
}
