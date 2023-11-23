/*
 * uri.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * URI class that represents a file path. These URIs are always 'file' schemed.
 */

import { URI } from 'vscode-uri';
import {
    ensureTrailingDirectorySeparator,
    getDirectoryPath,
    getFileExtension,
    getFileName,
    getPathComponents,
    getRootLength,
    hasTrailingDirectorySeparator,
    isDiskPathRoot,
    normalizeSlashes,
    resolvePaths,
} from '../pathUtils';
import { BaseUri } from './baseUri';
import { cacheMethodWithArgs, cacheMethodWithNoArgs, cacheStaticFunc } from './memoization_instrumented';
import { Uri } from './uri';

export class FileUri extends BaseUri {
    private _formattedString: string | undefined;
    private constructor(
        key: string,
        private readonly _filePath: string,
        private readonly _query: string,
        private readonly _fragment: string,
        private _originalString: string | undefined
    ) {
        super(key);
    }

    override get scheme(): string {
        return 'file';
    }

    @cacheStaticFunc()
    static createFileUri(
        filePath: string,
        query: string,
        fragment: string,
        originalString: string | undefined
    ): FileUri {
        const key = FileUri._createKey(filePath, query, fragment);
        return new FileUri(key, filePath, query, fragment, originalString);
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
        return FileUri.createFileUri(this._filePath + extra, '', '', undefined);
    }

    @cacheMethodWithNoArgs()
    override isRoot(): boolean {
        return isDiskPathRoot(this._filePath);
    }

    @cacheMethodWithArgs()
    override isChild(parent: Uri, ignoreCase?: boolean): boolean {
        if (!FileUri.isFileUri(parent)) {
            return false;
        }

        return this.startsWith(parent, ignoreCase) && parent._filePath.length < this._filePath.length;
    }
    override isLocal(): boolean {
        return true;
    }

    @cacheMethodWithArgs()
    override startsWith(other: Uri | undefined, ignoreCase?: boolean): boolean {
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
    override getPath(): string {
        return this._filePath.replace(/\\/g, '/');
    }
    override getFilePath(): string {
        return this._filePath;
    }

    protected override combinePathsImpl(...paths: string[]): Uri {
        // Resolve and combine paths, never want URIs with '..' in the middle.
        let combined = resolvePaths(this._filePath, ...paths);

        // Make sure to remove any trailing directory chars.
        if (hasTrailingDirectorySeparator(combined) && combined.length > 1) {
            combined = combined.slice(0, combined.length - 1);
        }
        if (combined !== this._filePath) {
            return FileUri.createFileUri(combined, '', '', undefined);
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
        return components.map((component) => component.replace(/\\/g, '/'));
    }
    protected override getRootPath(): string {
        return this._filePath.slice(0, getRootLength(this._filePath));
    }
    protected override getComparablePathImpl(): string {
        return normalizeSlashes(this._filePath);
    }
    protected override getDirectoryImpl(): Uri {
        const filePath = this._filePath;
        let dir = getDirectoryPath(filePath);
        if (hasTrailingDirectorySeparator(dir) && dir.length > 1) {
            dir = dir.slice(0, -1);
        }
        if (dir !== filePath) {
            return FileUri.createFileUri(dir, '', '', undefined);
        } else {
            return this;
        }
    }

    protected override getRootImpl(): Uri {
        const rootPath = this.getRootPath();
        if (rootPath !== this._filePath) {
            return FileUri.createFileUri(rootPath, '', '', undefined);
        }
        return this;
    }
    protected override getBasenameImpl(): string {
        return getFileName(this._filePath);
    }
    protected override getExtnameImpl(): string {
        return getFileExtension(this._filePath);
    }

    private static _createKey(filePath: string, query: string, fragment: string) {
        return `${filePath}${query ? '?' + query : ''}${fragment ? '#' + fragment : ''}`;
    }
}
