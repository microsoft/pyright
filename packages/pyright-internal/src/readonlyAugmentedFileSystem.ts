/*
 * readonlyAugmentedFileSystem.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * A file system that lets one to augment backing file system but not allow
 * modifying the backing file system.
 */

import type * as fs from 'fs';

import { appendArray, getOrAdd } from './common/collectionUtils';
import { FileSystem, MkDirOptions, Stats, TmpfileOptions, VirtualDirent } from './common/fileSystem';
import { combinePaths, ensureTrailingDirectorySeparator, getDirectoryPath, getFileName } from './common/pathUtils';
import { FileWatcher, FileWatcherEventHandler } from './common/fileWatcher';

export class ReadOnlyAugmentedFileSystem implements FileSystem {
    // Mapped file to original file map
    private readonly _entryMap = new Map<string, string>();

    // Original file to mapped file map
    private readonly _reverseEntryMap = new Map<string, string>();

    // Mapped files per a containing folder map
    private readonly _folderMap = new Map<string, { name: string; isFile: boolean }[]>();

    constructor(protected realFS: FileSystem) {}

    existsSync(path: string): boolean {
        if (this.isMovedEntry(path)) {
            // Pretend partial stub folder and its files not exist
            return false;
        }

        return this.realFS.existsSync(this.getOriginalPath(path));
    }

    mkdirSync(path: string, options?: MkDirOptions): void {
        throw new Error('Operation is not allowed.');
    }

    chdir(path: string): void {
        throw new Error('Operation is not allowed.');
    }

    readdirEntriesSync(path: string): fs.Dirent[] {
        const maybeDirectory = ensureTrailingDirectorySeparator(path);

        const entries: fs.Dirent[] = [];
        const movedEntries = this._folderMap.get(maybeDirectory);
        if (!movedEntries || this.realFS.existsSync(path)) {
            appendArray(
                entries,
                this.realFS.readdirEntriesSync(path).filter((item) => {
                    // Filter out the stub package directory and any
                    // entries that will be overwritten by stub package
                    // virtual items.
                    return (
                        !this.isMovedEntry(combinePaths(path, item.name)) &&
                        !movedEntries?.some((movedEntry) => movedEntry.name === item.name)
                    );
                })
            );
        }

        if (!movedEntries) {
            return entries;
        }

        return entries.concat(movedEntries.map((e) => new VirtualDirent(e.name, e.isFile)));
    }

    readdirSync(path: string): string[] {
        return this.readdirEntriesSync(path).map((p) => p.name);
    }

    readFileSync(path: string, encoding?: null): Buffer;
    readFileSync(path: string, encoding: BufferEncoding): string;
    readFileSync(path: string, encoding?: BufferEncoding | null): string | Buffer {
        return this.realFS.readFileSync(this.getOriginalPath(path), encoding);
    }

    writeFileSync(path: string, data: string | Buffer, encoding: BufferEncoding | null): void {
        throw new Error('Operation is not allowed.');
    }

    statSync(path: string): Stats {
        return this.realFS.statSync(this.getOriginalPath(path));
    }

    rmdirSync(path: string): void {
        throw new Error('Operation is not allowed.');
    }

    unlinkSync(path: string): void {
        throw new Error('Operation is not allowed.');
    }

    realpathSync(path: string): string {
        if (this._entryMap.has(path)) {
            return path;
        }

        return this.realFS.realpathSync(path);
    }

    getModulePath(): string {
        return this.realFS.getModulePath();
    }

    createFileSystemWatcher(paths: string[], listener: FileWatcherEventHandler): FileWatcher {
        return this.realFS.createFileSystemWatcher(paths, listener);
    }

    createReadStream(path: string): fs.ReadStream {
        return this.realFS.createReadStream(this.getOriginalPath(path));
    }

    createWriteStream(path: string): fs.WriteStream {
        throw new Error('Operation is not allowed.');
    }

    copyFileSync(src: string, dst: string): void {
        throw new Error('Operation is not allowed.');
    }

    // Async I/O
    readFile(path: string): Promise<Buffer> {
        return this.realFS.readFile(this.getOriginalPath(path));
    }

    readFileText(path: string, encoding?: BufferEncoding): Promise<string> {
        return this.realFS.readFileText(this.getOriginalPath(path), encoding);
    }

    // The directory returned by tmpdir must exist and be the same each time tmpdir is called.
    tmpdir(): string {
        return this.realFS.tmpdir();
    }

    tmpfile(options?: TmpfileOptions): string {
        return this.realFS.tmpfile(options);
    }

    realCasePath(path: string): string {
        return this.realFS.realCasePath(path);
    }

    getUri(originalPath: string): string {
        return this.realFS.getUri(originalPath);
    }

    // See whether the file is mapped to another location.
    isMappedFilePath(filepath: string): boolean {
        return this._entryMap.has(filepath) || this.realFS.isMappedFilePath(filepath);
    }

    // Get original filepath if the given filepath is mapped.
    getOriginalFilePath(mappedFilePath: string) {
        return this.realFS.getOriginalFilePath(this.getOriginalPath(mappedFilePath));
    }

    // Get mapped filepath if the given filepath is mapped.
    getMappedFilePath(originalFilepath: string) {
        const mappedFilePath = this.realFS.getMappedFilePath(originalFilepath);
        return this._reverseEntryMap.get(mappedFilePath) ?? mappedFilePath;
    }

    isInZipOrEgg(path: string): boolean {
        return this.realFS.isInZipOrEgg(path);
    }

    dispose(): void {
        this.realFS.dispose();
    }

    protected recordMovedEntry(mappedPath: string, originalPath: string, reversible = true, isFile = true) {
        this._entryMap.set(mappedPath, originalPath);

        if (reversible) {
            this._reverseEntryMap.set(originalPath, mappedPath);
        }

        const directory = ensureTrailingDirectorySeparator(getDirectoryPath(mappedPath));
        const folderInfo = getOrAdd(this._folderMap, directory, () => []);

        const name = getFileName(mappedPath);
        if (!folderInfo.some((entry) => entry.name === name)) {
            folderInfo.push({ name, isFile });
        }
    }

    protected getOriginalPath(mappedFilePath: string) {
        return this._entryMap.get(mappedFilePath) ?? mappedFilePath;
    }

    protected isMovedEntry(path: string) {
        return this._reverseEntryMap.has(path);
    }

    protected clear() {
        this._entryMap.clear();
        this._reverseEntryMap.clear();
        this._folderMap.clear();
    }
}
