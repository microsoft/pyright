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

import { getRootLength, hasTrailingDirectorySeparator, normalizeSlashes, resolvePaths } from '../pathUtils';
import { BaseUri } from './baseUri';
import { cacheMethodWithNoArgs, cacheProperty, cacheStaticFunc } from './memoization';
import { Uri } from './uri';

export class WebUri extends BaseUri {
    private constructor(
        key: string,
        private readonly _scheme: string,
        private readonly _authority: string,
        private readonly _path: string,
        private readonly _query: string,
        private readonly _fragment: string,
        private readonly _originalString: string | undefined
    ) {
        super(key);
    }

    override get scheme(): string {
        return this._scheme;
    }

    get isCaseSensitive(): boolean {
        // Web URIs are always case sensitive
        return true;
    }

    @cacheProperty()
    override get root(): Uri {
        const rootPath = this.getRootPath();
        if (rootPath !== this._path) {
            return WebUri.createWebUri(this._scheme, this._authority, rootPath, '', '', undefined);
        }
        return this;
    }

    @cacheProperty()
    override get fileName(): string {
        // Path should already be normalized, just get the last on a split of '/'.
        const components = this._path.split('/');
        return components[components.length - 1];
    }

    @cacheProperty()
    override get lastExtension(): string {
        const basename = this.fileName;
        const index = basename.lastIndexOf('.');
        if (index >= 0) {
            return basename.slice(index);
        }
        return '';
    }

    @cacheStaticFunc()
    static createWebUri(
        scheme: string,
        authority: string,
        path: string,
        query: string,
        fragment: string,
        originalString: string | undefined
    ): WebUri {
        const key = WebUri._createKey(scheme, authority, path, query, fragment);
        return new WebUri(key, scheme, authority, path, query, fragment, originalString);
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

    static isWebUri(uri: any): uri is WebUri {
        return uri?._scheme !== undefined && uri?._key !== undefined;
    }

    static fromJsonObj(obj: WebUri) {
        return WebUri.createWebUri(
            obj._scheme,
            obj._authority,
            obj._path,
            obj._query,
            obj._fragment,
            obj._originalString
        );
    }

    override matchesRegex(regex: RegExp): boolean {
        return regex.test(this._path);
    }

    override addPath(extra: string): Uri {
        const newPath = this._path + extra;
        return WebUri.createWebUri(this._scheme, this._authority, newPath, this._query, this._fragment, undefined);
    }

    override isRoot(): boolean {
        return this._path === this.getRootPath() && this._path.length > 0;
    }

    override isChild(parent: Uri): boolean {
        if (!WebUri.isWebUri(parent)) {
            return false;
        }

        return parent._path.length < this._path.length && this.startsWith(parent);
    }

    override isLocal(): boolean {
        return false;
    }

    override startsWith(other: Uri | undefined): boolean {
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

            return this._path.startsWith(otherPath);
        }
        return false;
    }
    override getPathLength(): number {
        return this._path.length;
    }

    override getPath(): string {
        return this._path;
    }

    override getFilePath(): string {
        return '';
    }

    override combinePaths(...paths: string[]): Uri {
        // Resolve and combine paths, never want URIs with '..' in the middle.
        let combined = this.normalizeSlashes(resolvePaths(this._path, ...paths));

        // Make sure to remove any trailing directory chars.
        if (hasTrailingDirectorySeparator(combined) && combined.length > 1) {
            combined = combined.slice(0, combined.length - 1);
        }
        if (combined !== this._path) {
            return WebUri.createWebUri(this._scheme, this._authority, combined, '', '', undefined);
        }
        return this;
    }

    @cacheMethodWithNoArgs()
    override getDirectory(): Uri {
        const index = this._path.lastIndexOf('/');
        if (index > 0) {
            return WebUri.createWebUri(
                this._scheme,
                this._authority,
                this._path.slice(0, index),
                this._query,
                this._fragment,
                undefined
            );
        } else {
            return this;
        }
    }

    protected override getPathComponentsImpl(): string[] {
        // Get the root path and the rest of the path components.
        const rootPath = this.getRootPath();
        const otherPaths = this._path.slice(rootPath.length).split('/');
        return this.reducePathComponents([rootPath, ...otherPaths]).map((component) =>
            this.normalizeSlashes(component)
        );
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
