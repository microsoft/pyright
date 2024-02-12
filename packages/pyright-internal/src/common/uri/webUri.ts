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

import { getRootLength, hasTrailingDirectorySeparator, resolvePaths } from '../pathUtils';
import { BaseUri, JsonObjType } from './baseUri';
import { cacheMethodWithNoArgs, cacheProperty, cacheStaticFunc } from './memoization';
import { Uri } from './uri';
import { URI } from 'vscode-uri';

export class WebUri extends BaseUri {
    private constructor(
        key: string,
        private readonly _scheme: string,
        private readonly _authority: string,
        private readonly _path: string,
        private readonly _query: string,
        private readonly _fragment: string,
        private _originalString: string | undefined
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

    get fragment(): string {
        return this._fragment;
    }

    get query(): string {
        return this._query;
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
            const vscodeUri = URI.revive({
                scheme: this._scheme,
                authority: this._authority,
                path: this._path,
                query: this._query,
                fragment: this._fragment,
            });
            this._originalString = vscodeUri.toString();
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

    toJsonObj(): JsonObjType {
        return {
            _scheme: this._scheme,
            _authority: this._authority,
            _path: this._path,
            _query: this._query,
            _fragment: this._fragment,
            _originalString: this._originalString,
            _key: this.key,
        };
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
        if (other?.scheme !== this.scheme) {
            return false;
        }
        const otherWebUri = other as WebUri;
        if (this._path.length >= otherWebUri._path.length) {
            // Make sure the other ends with a / when comparing longer paths, otherwise we might
            // say that /a/food is a child of /a/foo.
            const otherPath =
                this._path.length > otherWebUri._path.length && !hasTrailingDirectorySeparator(otherWebUri._path)
                    ? `${otherWebUri._path}/`
                    : otherWebUri._path;

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
        return ''; // Web URIs don't have file paths so this is always empty.
    }

    override resolvePaths(...paths: string[]): Uri {
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
    override combinePaths(...paths: string[]): Uri {
        if (paths.some((p) => p.includes('..') || p.includes('/') || p === '.')) {
            // This is a slow path that handles paths that contain '..' or '.'.
            return this.resolvePaths(...paths);
        }

        // Paths don't have any thing special that needs to be combined differently, so just
        // use the quick method.
        return this.combinePathsUnsafe(...paths);
    }

    override combinePathsUnsafe(...paths: string[]): Uri {
        // Combine paths using the quick path implementation.
        const combined = BaseUri.combinePathElements(this._path, '/', ...paths);
        if (combined !== this._path) {
            return WebUri.createWebUri(this._scheme, this._authority, combined, '', '', undefined);
        }
        return this;
    }

    @cacheMethodWithNoArgs()
    override getDirectory(): Uri {
        if (this._path.length === 0) {
            return this;
        }

        const index = this._path.lastIndexOf('/');
        const newPath = index > 0 ? this._path.slice(0, index) : index === 0 ? '/' : '';

        return WebUri.createWebUri(this._scheme, this._authority, newPath, this._query, this._fragment, undefined);
    }

    withFragment(fragment: string): Uri {
        return WebUri.createWebUri(this._scheme, this._authority, this._path, this._query, fragment, undefined);
    }

    withQuery(query: string): Uri {
        return WebUri.createWebUri(this._scheme, this._authority, this._path, query, this._fragment, undefined);
    }

    override stripExtension(): Uri {
        const path = this._path;
        const index = path.lastIndexOf('.');
        if (index > 0) {
            return WebUri.createWebUri(
                this._scheme,
                this._authority,
                path.slice(0, index),
                this._query,
                this._fragment,
                undefined
            );
        }
        return this;
    }

    override stripAllExtensions(): Uri {
        const path = this._path;
        const sepIndex = path.lastIndexOf('/');
        const index = path.indexOf('.', sepIndex > 0 ? sepIndex : 0);
        if (index > 0) {
            return WebUri.createWebUri(
                this._scheme,
                this._authority,
                path.slice(0, index),
                this._query,
                this._fragment,
                undefined
            );
        }
        return this;
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
        return this._path; // Should already have the correct '/'
    }

    private static _createKey(scheme: string, authority: string, path: string, query: string, fragment: string) {
        return `${scheme}:${authority}${path}${query ? '?' + query : ''}${fragment ? '#' + fragment : ''}`;
    }
}
