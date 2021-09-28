/*
 * readonlyAugmentedFileSystem.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * A file system that lets one to augment backing file system but not allow
 * modifying the backing file system.
 */

import type * as fs from 'fs';

import {
    FileSystem,
    FileWatcher,
    FileWatcherEventHandler,
    MkDirOptions,
    Stats,
    TmpfileOptions,
    VirtualDirent,
} from './common/fileSystem';
import { combinePaths, ensureTrailingDirectorySeparator, getDirectoryPath, getFileName } from './common/pathUtils';

export class ReadOnlyAugmentedFileSystem implements FileSystem {
    // Mapped file to original file map
    private readonly _fileMap = new Map<string, string>();

    // Original file to mapped file map
    private readonly _reverseFileMap = new Map<string, string>();

    // Mapped files per a containing folder map
    private readonly _folderMap = new Map<string, string[]>();

    constructor(protected _realFS: FileSystem) {}

    existsSync(path: string): boolean {
        if (this._isMovedEntry(path)) {
            // Pretend partial stub folder and its files not exist
            return false;
        }

        return this._realFS.existsSync(this._getOriginalPath(path));
    }

    mkdirSync(path: string, options?: MkDirOptions): void {
        throw new Error('Operation is not allowed.');
    }

    chdir(path: string): void {
        throw new Error('Operation is not allowed.');
    }

    readdirEntriesSync(path: string): fs.Dirent[] {
        const entries = this._realFS.readdirEntriesSync(path).filter((item) => {
            // Filter out the stub package directory.
            return !this._isMovedEntry(combinePaths(path, item.name));
        });

        const partialStubs = this._folderMap.get(ensureTrailingDirectorySeparator(path));
        if (!partialStubs) {
            return entries;
        }

        return entries.concat(partialStubs.map((f) => new VirtualDirent(f, /* file */ true)));
    }

    readdirSync(path: string): string[] {
        const entries = this._realFS.readdirSync(path).filter((item) => {
            // Filter out the stub package directory.
            return !this._isMovedEntry(combinePaths(path, item));
        });

        const partialStubs = this._folderMap.get(ensureTrailingDirectorySeparator(path));
        if (!partialStubs) {
            return entries;
        }

        return entries.concat(partialStubs);
    }

    readFileSync(path: string, encoding?: null): Buffer;
    readFileSync(path: string, encoding: BufferEncoding): string;
    readFileSync(path: string, encoding?: BufferEncoding | null): string | Buffer {
        return this._realFS.readFileSync(this._getOriginalPath(path), encoding);
    }

    writeFileSync(path: string, data: string | Buffer, encoding: BufferEncoding | null): void {
        throw new Error('Operation is not allowed.');
    }

    statSync(path: string): Stats {
        return this._realFS.statSync(this._getOriginalPath(path));
    }

    unlinkSync(path: string): void {
        throw new Error('Operation is not allowed.');
    }

    realpathSync(path: string): string {
        return this._realFS.realpathSync(path);
    }

    getModulePath(): string {
        return this._realFS.getModulePath();
    }

    createFileSystemWatcher(paths: string[], listener: FileWatcherEventHandler): FileWatcher {
        return this._realFS.createFileSystemWatcher(paths, listener);
    }

    createReadStream(path: string): fs.ReadStream {
        return this._realFS.createReadStream(this._getOriginalPath(path));
    }

    createWriteStream(path: string): fs.WriteStream {
        throw new Error('Operation is not allowed.');
    }

    copyFileSync(src: string, dst: string): void {
        throw new Error('Operation is not allowed.');
    }

    // Async I/O
    readFile(path: string): Promise<Buffer> {
        return this._realFS.readFile(this._getOriginalPath(path));
    }

    readFileText(path: string, encoding?: BufferEncoding): Promise<string> {
        return this._realFS.readFileText(this._getOriginalPath(path), encoding);
    }

    // The directory returned by tmpdir must exist and be the same each time tmpdir is called.
    tmpdir(): string {
        return this._realFS.tmpdir();
    }

    tmpfile(options?: TmpfileOptions): string {
        return this._realFS.tmpfile(options);
    }

    realCasePath(path: string): string {
        return this._realFS.realCasePath(path);
    }

    getUri(originalPath: string): string {
        return this._realFS.getUri(originalPath);
    }

    // See whether the file is mapped to another location.
    isMappedFilePath(filepath: string): boolean {
        return this._fileMap.has(filepath) || this._realFS.isMappedFilePath(filepath);
    }

    // Get original filepath if the given filepath is mapped.
    getOriginalFilePath(mappedFilePath: string) {
        return this._realFS.getOriginalFilePath(this._getOriginalPath(mappedFilePath));
    }

    // Get mapped filepath if the given filepath is mapped.
    getMappedFilePath(originalFilepath: string) {
        const mappedFilePath = this._realFS.getMappedFilePath(originalFilepath);
        return this._reverseFileMap.get(mappedFilePath) ?? mappedFilePath;
    }

    isInZipOrEgg(path: string): boolean {
        return this._realFS.isInZipOrEgg(path);
    }

    protected _recordMovedEntry(mappedFile: string, originalFile: string, reversible = true) {
        this._fileMap.set(mappedFile, originalFile);

        if (reversible) {
            this._reverseFileMap.set(originalFile, mappedFile);
        }

        const directory = ensureTrailingDirectorySeparator(getDirectoryPath(mappedFile));
        let folderInfo = this._folderMap.get(directory);
        if (!folderInfo) {
            folderInfo = [];
            this._folderMap.set(directory, folderInfo);
        }

        const fileName = getFileName(mappedFile);
        if (!folderInfo.some((entry) => entry === fileName)) {
            folderInfo.push(fileName);
        }
    }

    protected _getOriginalPath(mappedFilePath: string) {
        return this._fileMap.get(mappedFilePath) ?? mappedFilePath;
    }

    protected _isMovedEntry(path: string) {
        return this._reverseFileMap.has(path);
    }

    protected _clear() {
        this._fileMap.clear();
        this._reverseFileMap.clear();
        this._folderMap.clear();
    }
}
