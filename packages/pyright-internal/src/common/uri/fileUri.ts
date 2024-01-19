/*
 * fileUri.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * URI class that represents a file path. These URIs are always 'file' schemed.
 */

import { URI } from 'vscode-uri';
import { isArray } from '../core';
import {
    ensureTrailingDirectorySeparator,
    getDirectoryPath,
    getFileExtension,
    getFileName,
    getPathComponents,
    getPathSeparator,
    getRootLength,
    hasTrailingDirectorySeparator,
    isDiskPathRoot,
    normalizeSlashes,
    resolvePaths,
    stripFileExtension,
} from '../pathUtils';
import { BaseUri, JsonObjType } from './baseUri';
import { cacheMethodWithNoArgs, cacheProperty, cacheStaticFunc } from './memoization';
import { Uri } from './uri';

type SerializedType = [0, string, string, string, string | undefined, 1 | 0];

export class FileUri extends BaseUri {
    private _formattedString: string | undefined;
    private static _separator = getPathSeparator('');
    protected constructor(
        key: string,
        private readonly _filePath: string,
        private readonly _query: string,
        private readonly _fragment: string,
        private readonly _originalString: string | undefined,
        private readonly _isCaseSensitive: boolean
    ) {
        super(_isCaseSensitive ? key : key.toLowerCase());
    }

    override get scheme(): string {
        return 'file';
    }

    get fragment(): string {
        return this._fragment;
    }

    @cacheProperty()
    override get fileName(): string {
        return getFileName(this._filePath);
    }

    @cacheProperty()
    override get lastExtension(): string {
        return getFileExtension(this._filePath);
    }

    @cacheProperty()
    override get root(): Uri {
        const rootPath = this.getRootPath();
        if (rootPath !== this._filePath) {
            return FileUri.createFileUri(rootPath, '', '', undefined, this._isCaseSensitive);
        }
        return this;
    }

    get isCaseSensitive(): boolean {
        return this._isCaseSensitive;
    }

    @cacheStaticFunc()
    static createFileUri(
        filePath: string,
        query: string,
        fragment: string,
        originalString: string | undefined,
        isCaseSensitive: boolean
    ): FileUri {
        const key = FileUri._createKey(filePath, query, fragment);
        return new FileUri(key, filePath, query, fragment, originalString, isCaseSensitive);
    }

    static isFileUri(uri: any): uri is FileUri | SerializedType {
        if (isArray<SerializedType>(uri) && uri[0] === 0 && uri.length === 6) {
            return true;
        }

        return uri?._filePath !== undefined && uri?._key !== undefined;
    }

    static fromJsonObj(obj: FileUri | SerializedType) {
        if (isArray<SerializedType>(obj)) {
            return FileUri.createFileUri(obj[1], obj[2], obj[3], obj[4], obj[5] === 1 ? true : false);
        }

        return FileUri.createFileUri(
            obj._filePath,
            obj._query,
            obj._fragment,
            obj._originalString,
            obj._isCaseSensitive
        );
    }

    toJsonObj(): JsonObjType {
        const jsonObj: SerializedType = [
            0,
            this._filePath,
            this._query,
            this._fragment,
            this._originalString,
            this._isCaseSensitive ? 1 : 0,
        ];
        return jsonObj;
    }

    override matchesRegex(regex: RegExp): boolean {
        // Compare the regex to our path but normalize it for comparison.
        // The regex assumes it's comparing itself to a URI path.
        const path = this.normalizeSlashes(this._filePath);
        return regex.test(path);
    }

    override toString(): string {
        if (!this._formattedString) {
            this._formattedString =
                this._originalString ||
                URI.file(this._filePath).with({ query: this._query, fragment: this._fragment }).toString();
        }
        return this._formattedString;
    }

    override toUserVisibleString(): string {
        return this._filePath;
    }

    override addPath(extra: string): Uri {
        return FileUri.createFileUri(this._filePath + extra, '', '', undefined, this._isCaseSensitive);
    }

    override isRoot(): boolean {
        return isDiskPathRoot(this._filePath);
    }

    override isChild(parent: Uri): boolean {
        if (!FileUri.isFileUri(parent)) {
            return false;
        }

        return parent._filePath.length < this._filePath.length && this.startsWith(parent);
    }

    override isLocal(): boolean {
        return true;
    }

    override startsWith(other: Uri | undefined): boolean {
        if (other?.scheme !== this.scheme) {
            return false;
        }
        const otherFileUri = other as FileUri;
        if (this._filePath.length >= otherFileUri._filePath.length) {
            // Make sure the other ends with a / when comparing longer paths, otherwise we might
            // say that /a/food is a child of /a/foo.
            const otherPath =
                this._filePath.length > otherFileUri._filePath.length &&
                !hasTrailingDirectorySeparator(otherFileUri._filePath)
                    ? ensureTrailingDirectorySeparator(otherFileUri._filePath)
                    : otherFileUri._filePath;

            if (!this.isCaseSensitive) {
                return this._filePath.toLowerCase().startsWith(otherPath.toLowerCase());
            }
            return this._filePath.startsWith(otherPath);
        }
        return false;
    }
    override getPathLength(): number {
        return this._filePath.length;
    }
    override getPath(): string {
        return this.normalizeSlashes(this._filePath);
    }
    override getFilePath(): string {
        return this._filePath;
    }

    override resolvePaths(...paths: string[]): Uri {
        // Resolve and combine paths, never want URIs with '..' in the middle.
        let combined = resolvePaths(this._filePath, ...paths);

        // Make sure to remove any trailing directory chars.
        if (hasTrailingDirectorySeparator(combined) && combined.length > 1) {
            combined = combined.slice(0, combined.length - 1);
        }
        if (combined !== this._filePath) {
            return FileUri.createFileUri(combined, '', '', undefined, this._isCaseSensitive);
        }
        return this;
    }

    override combinePaths(...paths: string[]): Uri {
        if (paths.some((p) => p.includes('..') || p.includes(FileUri._separator) || p.includes('/') || p === '.')) {
            // This is a slow path that handles paths that contain '..' or '.'.
            return this.resolvePaths(...paths);
        }

        // Paths don't have any thing special that needs to be combined differently, so just
        // use the quick method.
        return this.combinePathsUnsafe(...paths);
    }

    override combinePathsUnsafe(...paths: string[]): Uri {
        // Combine paths using the quicker path implementation as we
        // assume all data is already normalized.
        const combined = BaseUri.combinePathElements(this._filePath, FileUri._separator, ...paths);
        if (combined !== this._filePath) {
            return FileUri.createFileUri(combined, '', '', undefined, this._isCaseSensitive);
        }
        return this;
    }

    @cacheMethodWithNoArgs()
    override getDirectory(): Uri {
        const filePath = this._filePath;
        let dir = getDirectoryPath(filePath);
        if (hasTrailingDirectorySeparator(dir) && dir.length > 1) {
            dir = dir.slice(0, -1);
        }
        if (dir !== filePath) {
            return FileUri.createFileUri(dir, '', '', undefined, this._isCaseSensitive);
        } else {
            return this;
        }
    }

    withFragment(fragment: string): Uri {
        return FileUri.createFileUri(this._filePath, this._query, fragment, undefined, this._isCaseSensitive);
    }

    override stripExtension(): Uri {
        const stripped = stripFileExtension(this._filePath);
        if (stripped !== this._filePath) {
            return FileUri.createFileUri(stripped, this._query, this._fragment, undefined, this._isCaseSensitive);
        }
        return this;
    }

    override stripAllExtensions(): Uri {
        const stripped = stripFileExtension(this._filePath, /* multiDotExtension */ true);
        if (stripped !== this._filePath) {
            return FileUri.createFileUri(stripped, this._query, this._fragment, undefined, this._isCaseSensitive);
        }
        return this;
    }

    protected override getPathComponentsImpl(): string[] {
        const components = getPathComponents(this._filePath);
        // Remove the first one if it's empty. The new algorithm doesn't
        // expect this to be there.
        if (components.length > 0 && components[0] === '') {
            components.shift();
        }
        return components.map((component) => this.normalizeSlashes(component));
    }

    protected override getRootPath(): string {
        return this._filePath.slice(0, getRootLength(this._filePath));
    }

    protected override getComparablePath(): string {
        return normalizeSlashes(this._filePath);
    }

    private static _createKey(filePath: string, query: string, fragment: string) {
        return `${filePath}${query ? '?' + query : ''}${fragment ? '#' + fragment : ''}`;
    }
}
