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

export interface Stats {
    size: number;
    mtimeMs: number;

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
    existsSync(path: string): boolean;
    chdir(path: string): void;
    readdirEntriesSync(path: string): fs.Dirent[];
    readdirSync(path: string): string[];
    readFileSync(path: string, encoding?: null): Buffer;
    readFileSync(path: string, encoding: BufferEncoding): string;
    readFileSync(path: string, encoding?: BufferEncoding | null): string | Buffer;

    statSync(path: string): Stats;
    realpathSync(path: string): string;
    getModulePath(): string;
    // Async I/O
    readFile(path: string): Promise<Buffer>;
    readFileText(path: string, encoding?: BufferEncoding): Promise<string>;
    // Return path in casing on OS.
    realCasePath(path: string): string;

    // See whether the file is mapped to another location.
    isMappedFilePath(filepath: string): boolean;

    // Get original filepath if the given filepath is mapped.
    getOriginalFilePath(mappedFilePath: string): string;

    // Get mapped filepath if the given filepath is mapped.
    getMappedFilePath(originalFilepath: string): string;

    getUri(path: string): string;

    isInZip(path: string): boolean;
}

export interface FileSystem extends ReadOnlyFileSystem {
    mkdirSync(path: string, options?: MkDirOptions): void;
    writeFileSync(path: string, data: string | Buffer, encoding: BufferEncoding | null): void;

    unlinkSync(path: string): void;
    rmdirSync(path: string): void;

    createFileSystemWatcher(paths: string[], listener: FileWatcherEventHandler): FileWatcher;
    createReadStream(path: string): fs.ReadStream;
    createWriteStream(path: string): fs.WriteStream;
    copyFileSync(src: string, dst: string): void;
}

export interface TmpfileOptions {
    postfix?: string;
    prefix?: string;
}

export interface TempFile {
    // The directory returned by tmpdir must exist and be the same each time tmpdir is called.
    tmpdir(): string;
    tmpfile(options?: TmpfileOptions): string;
    dispose(): void;
}

export namespace FileSystem {
    export function is(value: any): value is FileSystem {
        return value.createFileSystemWatcher && value.createReadStream && value.createWriteStream && value.copyFileSync;
    }
}

export namespace TempFile {
    export function is(value: any): value is TempFile {
        return value.tmpdir && value.tmpfile && value.dispose;
    }
}

export class VirtualDirent implements fs.Dirent {
    constructor(public name: string, private _file: boolean) {}

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
