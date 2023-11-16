/*
 * webUri.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * URI class that represents a URI that isn't 'file' schemed.
 * This can be URIs like:
 * - http://www.microsoft.com/file.txt
 * - untitled:Untitled-1
 * - vscode:extension/ms-python.python
 * - vscode-vfs://github.com/microsoft/debugpy/debugpy/launcher/debugAdapter.py
 */

import * as debug from '../debug';
import { combinePaths, getRootLength, hasTrailingDirectorySeparator, normalizeSlashes } from '../pathUtils';
import { Uri } from './uri';

export class WebUri extends Uri {
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
        if (!this._originalString) {
            return `${this._scheme}://${this._authority}${this._path}${this._query ? '?' + this._query : ''}${
                this._fragment ? '#' + this._fragment : ''
            }`;
        }
        return this._originalString;
    }
    override toUserVisibleString(): string {
        return this.toString();
    }
    static isWebUri(uri: Uri): uri is WebUri {
        return uri.scheme !== 'file' && (uri as any)._scheme !== undefined;
    }

    override matchesRegex(regex: RegExp): boolean {
        return regex.test(this._path);
    }
    override addPath(extra: string): Uri {
        const newPath = this._path + extra;
        return WebUri.create(this._scheme, this._authority, newPath, this._query, this._fragment, undefined, 'addPath');
    }
    override getDirectory(): Uri {
        if (!this._directory) {
            const index = this._path.lastIndexOf('/');
            if (index > 0) {
                this._directory = WebUri.create(
                    this._scheme,
                    this._authority,
                    this._path.slice(0, index),
                    this._query,
                    this._fragment,
                    undefined,
                    'getDirectory'
                );
            } else {
                this._directory = this;
            }
        }
        return this._directory;
    }
    override isDiskPathRoot(): boolean {
        // Always false because not a disk path.
        return false;
    }
    override isChild(parent: Uri, ignoreCase?: boolean): boolean {
        if (!WebUri.isWebUri(parent)) {
            return false;
        }

        return this.startsWith(parent, ignoreCase) && parent._path.length < this._path.length;
    }
    override isLocal(): boolean {
        return false;
    }
    override startsWith(other: Uri | undefined, ignoreCase?: boolean): boolean {
        if (!other || !WebUri.isWebUri(other)) {
            return false;
        }
        if (other.isEmpty() !== this.isEmpty()) {
            return false;
        }
        if (this.scheme !== other.scheme) {
            return false;
        }
        if (this._path.length >= other._path.length) {
            // Make sure the other ends with a / when comparing longer paths, otherwise we might
            // say that /a/food is a child of /a/foo.
            const otherPath =
                this._path.length > other._path.length && !hasTrailingDirectorySeparator(other._path)
                    ? `${other._path}/`
                    : other._path;

            if (ignoreCase) {
                return this._path.toLowerCase().startsWith(otherPath.toLowerCase());
            }
            return this._path.startsWith(otherPath);
        }
        return false;
    }
    override getPathLength(): number {
        return this._path.length;
    }
    override combinePaths(...paths: string[]): Uri {
        const combined = combinePaths(this._path, ...paths).replace(/\\/g, '/');
        if (combined !== this._path) {
            return WebUri.create(this._scheme, this._authority, combined, '', '', undefined, 'combinePaths');
        }
        return this;
    }
    override getPathComponents(): string[] {
        // Get the root path and the rest of the path components.
        const rootPath = this.getRootPath();
        const otherPaths = this._path.slice(rootPath.length).split('/');
        return this.reducePathComponents([rootPath, ...otherPaths]);
    }
    override getPath(): string {
        return this._path;
    }
    override getFilePath(): string {
        debug.fail(`${this} is not a file based URI.`);
    }

    protected override getRootPath(): string {
        const rootLength = getRootLength(this._path, '/');
        return this._path.slice(0, rootLength);
    }
    protected override getComparablePath(): string {
        return normalizeSlashes(this._path);
    }

    private static _createKey(scheme: string, authority: string, path: string, query: string, fragment: string) {
        return `${scheme}://${authority}${path}${query ? '?' + query : ''}${fragment ? '#' + fragment : ''}`;
    }
}
