/*
 * fileSystem.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * A "file system provider" abstraction that allows us to swap out a
 * real file system implementation for a virtual (mocked) implementation
 * for testing.
 */

// * NOTE * except tests, this should be only file that import "fs"
import type * as fs from 'fs';
import { FileWatcher, FileWatcherEventHandler } from './fileWatcher';
import { Uri } from './uri/uri';
import { Disposable } from 'vscode-jsonrpc';

export interface Stats {
    size: number;
    mtimeMs: number;
    ctimeMs: number;

    isFile(): boolean;
    isDirectory(): boolean;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isSymbolicLink(): boolean;
    isFIFO(): boolean;
    isSocket(): boolean;
    isZipDirectory?: () => boolean;
}

export interface MkDirOptions {
    recursive: boolean;
    // Not supported on Windows so commented out.
    // mode: string | number;
}

export interface ReadOnlyFileSystem {
    existsSync(uri: Uri): boolean;
    chdir(uri: Uri): void;
    readdirEntriesSync(uri: Uri): fs.Dirent[];
    readdirSync(uri: Uri): string[];
    readFileSync(uri: Uri, encoding?: null): Buffer;
    readFileSync(uri: Uri, encoding: BufferEncoding): string;
    readFileSync(uri: Uri, encoding?: BufferEncoding | null): string | Buffer;

    statSync(uri: Uri): Stats;
    realpathSync(uri: Uri): Uri;
    getModulePath(): Uri;
    // Async I/O
    readFile(uri: Uri): Promise<Buffer>;
    readFileText(uri: Uri, encoding?: BufferEncoding): Promise<string>;
    // Return path in casing on OS.
    realCasePath(uri: Uri): Uri;

    // See whether the file is mapped to another location.
    isMappedUri(uri: Uri): boolean;

    // Get original uri if the given uri is mapped.
    getOriginalUri(mappedUri: Uri): Uri;

    // Get mapped uri if the given uri is mapped.
    getMappedUri(originalUri: Uri): Uri;

    isInZip(uri: Uri): boolean;
}

export interface FileSystem extends ReadOnlyFileSystem {
    mkdirSync(uri: Uri, options?: MkDirOptions): void;
    writeFileSync(uri: Uri, data: string | Buffer, encoding: BufferEncoding | null): void;

    unlinkSync(uri: Uri): void;
    rmdirSync(uri: Uri): void;

    createFileSystemWatcher(uris: Uri[], listener: FileWatcherEventHandler): FileWatcher;
    createReadStream(uri: Uri): fs.ReadStream;
    createWriteStream(uri: Uri): fs.WriteStream;
    copyFileSync(uri: Uri, dst: Uri): void;

    mapDirectory(mappedUri: Uri, originalUri: Uri, filter?: (originalUri: Uri, fs: FileSystem) => boolean): Disposable;
}

export interface TmpfileOptions {
    postfix?: string;
    prefix?: string;
}

export interface TempFile {
    // The directory returned by tmpdir must exist and be the same each time tmpdir is called.
    tmpdir(): Uri;
    tmpfile(options?: TmpfileOptions): Uri;
}

export namespace FileSystem {
    export function is(value: any): value is FileSystem {
        return value.createFileSystemWatcher && value.createReadStream && value.createWriteStream && value.copyFileSync;
    }
}

export namespace TempFile {
    export function is(value: any): value is TempFile {
        return value.tmpdir && value.tmpfile;
    }
}

export class VirtualDirent implements fs.Dirent {
    parentPath: string;

    constructor(public name: string, private _file: boolean, parentPath: string) {
        this.parentPath = parentPath;
    }

    /**
     * Alias for `dirent.parentPath`.
     * @since v20.1.0
     * @deprecated Since v20.12.0
     */
    get path(): string {
        return this.parentPath;
    }

    isFile(): boolean {
        return this._file;
    }

    isDirectory(): boolean {
        return !this._file;
    }

    isBlockDevice(): boolean {
        return false;
    }

    isCharacterDevice(): boolean {
        return false;
    }

    isSymbolicLink(): boolean {
        return false;
    }

    isFIFO(): boolean {
        return false;
    }

    isSocket(): boolean {
        return false;
    }
}
