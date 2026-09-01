/*
 * readonlyAugmentedFileSystem.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * A file system that lets one to augment backing file system but not allow
 * modifying the backing file system.
 */

import type * as fs from 'fs';

import { FileSystem, MkDirOptions, Stats } from './common/fileSystem';
import { FileWatcher, FileWatcherEventHandler } from './common/fileWatcher';
import { Uri } from './common/uri/uri';
import { Disposable } from 'vscode-jsonrpc';
import { createFileSystemMapping, FileSystemMapping } from './fileSystemMapping';

export class ReadOnlyAugmentedFileSystem implements FileSystem {
    private readonly _mapping: FileSystemMapping;

    constructor(protected readonly realFS: FileSystem) {
        this._mapping = createFileSystemMapping(realFS);
    }

    existsSync(uri: Uri): boolean {
        return this._mapping.existsSync(uri);
    }

    mkdirSync(uri: Uri, options?: MkDirOptions): void {
        throw new Error('Operation is not allowed.');
    }

    chdir(uri: Uri): void {
        throw new Error('Operation is not allowed.');
    }

    readdirEntriesSync(uri: Uri): fs.Dirent[] {
        return this._mapping.readdirEntriesSync(uri);
    }

    readdirSync(uri: Uri): string[] {
        return this.readdirEntriesSync(uri).map((p) => p.name);
    }

    readFileSync(uri: Uri, encoding?: null): Buffer;
    readFileSync(uri: Uri, encoding: BufferEncoding): string;
    readFileSync(uri: Uri, encoding?: BufferEncoding | null): string | Buffer {
        // The branch narrows encoding so TypeScript selects the matching FileSystemMapping overload.
        return encoding === null || encoding === undefined
            ? this._mapping.readFileSync(uri, encoding)
            : this._mapping.readFileSync(uri, encoding);
    }

    writeFileSync(uri: Uri, data: string | Buffer, encoding: BufferEncoding | null): void {
        throw new Error('Operation is not allowed.');
    }

    statSync(uri: Uri): Stats {
        return this._mapping.statSync(uri);
    }

    rmdirSync(uri: Uri): void {
        throw new Error('Operation is not allowed.');
    }

    unlinkSync(uri: Uri): void {
        throw new Error('Operation is not allowed.');
    }

    realpathSync(uri: Uri): Uri {
        return this._mapping.realpathSync(uri);
    }

    getModulePath(): Uri {
        return this.realFS.getModulePath();
    }

    createFileSystemWatcher(paths: Uri[], listener: FileWatcherEventHandler): FileWatcher {
        return this.realFS.createFileSystemWatcher(paths, listener);
    }

    createReadStream(uri: Uri): fs.ReadStream {
        return this._mapping.createReadStream(uri);
    }

    createWriteStream(uri: Uri): fs.WriteStream {
        throw new Error('Operation is not allowed.');
    }

    copyFileSync(src: Uri, dst: Uri): void {
        throw new Error('Operation is not allowed.');
    }

    // Async I/O
    readFile(uri: Uri): Promise<Buffer> {
        return this._mapping.readFile(uri);
    }

    readFileText(uri: Uri, encoding?: BufferEncoding): Promise<string> {
        return this._mapping.readFileText(uri, encoding);
    }

    realCasePath(uri: Uri): Uri {
        return this.realFS.realCasePath(uri);
    }

    // See whether the file is mapped to another location.
    isMappedUri(fileUri: Uri): boolean {
        return this._mapping.isMappedUri(fileUri);
    }

    // Get original filepath if the given filepath is mapped.
    getOriginalUri(mappedFileUri: Uri) {
        return this._mapping.getOriginalUri(mappedFileUri);
    }

    // Get mapped filepath if the given filepath is mapped.
    getMappedUri(originalFileUri: Uri) {
        return this._mapping.getMappedUri(originalFileUri);
    }

    isInZip(uri: Uri): boolean {
        return this.realFS.isInZip(uri);
    }

    mapDirectory(mappedUri: Uri, originalUri: Uri, filter?: (originalUri: Uri, fs: FileSystem) => boolean): Disposable {
        return this._mapping.mapDirectory(mappedUri, originalUri, filter);
    }
}
