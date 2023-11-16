/*
 * uri.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * URI class that represents a file path. These URIs are always 'file' schemed.
 */

import { URI } from 'vscode-uri';
import {
    combinePaths,
    ensureTrailingDirectorySeparator,
    getDirectoryPath,
    getFileExtension,
    getFileName,
    getPathComponents,
    getRootLength,
    hasTrailingDirectorySeparator,
    isDiskPathRoot,
    normalizeSlashes,
} from '../pathUtils';
import { BaseUri } from './baseUri';
import { Uri } from './uri';

export class FileUri extends BaseUri {
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
    override isChild(parent: Uri, ignoreCase?: boolean): boolean {
        if (!FileUri.isFileUri(parent)) {
            return false;
        }

        return this.startsWith(parent, ignoreCase) && parent._filePath.length < this._filePath.length;
    }
    override isLocal(): boolean {
        return true;
    }
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
    override getPath(): string {
        return this._filePath;
    }
    override getFilePath(): string {
        return this._filePath;
    }
    protected override getRootPath(): string {
        return this._filePath.slice(0, getRootLength(this._filePath));
    }
    protected override getComparablePath(): string {
        return normalizeSlashes(this._filePath);
    }
}
