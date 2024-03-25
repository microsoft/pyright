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
import { FileSystem, MkDirOptions, Stats, VirtualDirent } from './common/fileSystem';
import { FileWatcher, FileWatcherEventHandler } from './common/fileWatcher';
import { Uri } from './common/uri/uri';

export class ReadOnlyAugmentedFileSystem implements FileSystem {
    // Mapped file to original file map
    private readonly _entryMap = new Map<string, Uri>();

    // Original file to mapped file map
    private readonly _reverseEntryMap = new Map<string, Uri>();

    // Mapped files per a containing folder map
    private readonly _folderMap = new Map<string, { name: string; isFile: boolean }[]>();

    constructor(protected realFS: FileSystem) {}

    existsSync(uri: Uri): boolean {
        if (this.isMovedEntry(uri)) {
            // Pretend partial stub folder and its files not exist
            return false;
        }

        return this.realFS.existsSync(this.getOriginalPath(uri));
    }

    mkdirSync(uri: Uri, options?: MkDirOptions): void {
        throw new Error('Operation is not allowed.');
    }

    chdir(uri: Uri): void {
        throw new Error('Operation is not allowed.');
    }

    readdirEntriesSync(uri: Uri): fs.Dirent[] {
        const entries: fs.Dirent[] = [];
        const movedEntries = this._folderMap.get(uri.key);
        if (!movedEntries || this.realFS.existsSync(uri)) {
            appendArray(
                entries,
                this.realFS.readdirEntriesSync(uri).filter((item) => {
                    // Filter out the stub package directory and any
                    // entries that will be overwritten by stub package
                    // virtual items.
                    return (
                        !this.isMovedEntry(uri.combinePaths(item.name)) &&
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

    readdirSync(uri: Uri): string[] {
        return this.readdirEntriesSync(uri).map((p) => p.name);
    }

    readFileSync(uri: Uri, encoding?: null): Buffer;
    readFileSync(uri: Uri, encoding: BufferEncoding): string;
    readFileSync(uri: Uri, encoding?: BufferEncoding | null): string | Buffer {
        return this.realFS.readFileSync(this.getOriginalPath(uri), encoding);
    }

    writeFileSync(uri: Uri, data: string | Buffer, encoding: BufferEncoding | null): void {
        throw new Error('Operation is not allowed.');
    }

    statSync(uri: Uri): Stats {
        return this.realFS.statSync(this.getOriginalPath(uri));
    }

    rmdirSync(uri: Uri): void {
        throw new Error('Operation is not allowed.');
    }

    unlinkSync(uri: Uri): void {
        throw new Error('Operation is not allowed.');
    }

    realpathSync(uri: Uri): Uri {
        if (this._entryMap.has(uri.key)) {
            return uri;
        }

        return this.realFS.realpathSync(uri);
    }

    getModulePath(): Uri {
        return this.realFS.getModulePath();
    }

    createFileSystemWatcher(paths: Uri[], listener: FileWatcherEventHandler): FileWatcher {
        return this.realFS.createFileSystemWatcher(paths, listener);
    }

    createReadStream(uri: Uri): fs.ReadStream {
        return this.realFS.createReadStream(this.getOriginalPath(uri));
    }

    createWriteStream(uri: Uri): fs.WriteStream {
        throw new Error('Operation is not allowed.');
    }

    copyFileSync(src: Uri, dst: Uri): void {
        throw new Error('Operation is not allowed.');
    }

    // Async I/O
    readFile(uri: Uri): Promise<Buffer> {
        return this.realFS.readFile(this.getOriginalPath(uri));
    }

    readFileText(uri: Uri, encoding?: BufferEncoding): Promise<string> {
        return this.realFS.readFileText(this.getOriginalPath(uri), encoding);
    }

    realCasePath(uri: Uri): Uri {
        return this.realFS.realCasePath(uri);
    }

    // See whether the file is mapped to another location.
    isMappedUri(fileUri: Uri): boolean {
        return this._entryMap.has(fileUri.key) || this.realFS.isMappedUri(fileUri);
    }

    // Get original filepath if the given filepath is mapped.
    getOriginalUri(mappedFileUri: Uri) {
        return this.realFS.getOriginalUri(this.getOriginalPath(mappedFileUri));
    }

    // Get mapped filepath if the given filepath is mapped.
    getMappedUri(originalFileUri: Uri) {
        const mappedFileUri = this.realFS.getMappedUri(originalFileUri);
        return this._reverseEntryMap.get(mappedFileUri.key) ?? mappedFileUri;
    }

    isInZip(uri: Uri): boolean {
        return this.realFS.isInZip(uri);
    }

    protected recordMovedEntry(mappedUri: Uri, originalUri: Uri, rootPath: Uri) {
        this._entryMap.set(mappedUri.key, originalUri);
        this._reverseEntryMap.set(originalUri.key, mappedUri);

        const directory = mappedUri.getDirectory();
        const folderInfo = getOrAdd(this._folderMap, directory.key, () => []);

        const name = mappedUri.fileName;
        if (!folderInfo.some((entry) => entry.name === name)) {
            folderInfo.push({ name, isFile: true });
        }

        // Add the directory entries for the sub paths as well.
        const subPathEntries = rootPath.getRelativePathComponents(directory);
        for (let i = 0; i < subPathEntries.length; i++) {
            const subdir = rootPath.combinePaths(...subPathEntries.slice(0, i + 1));
            const parent = subdir.getDirectory().key;
            const dirInfo = getOrAdd(this._folderMap, parent, () => []);
            const dirName = subdir.fileName;
            if (!dirInfo.some((entry) => entry.name === dirName)) {
                dirInfo.push({ name: dirName, isFile: false });
            }
        }
    }

    protected getOriginalPath(mappedFileUri: Uri) {
        return this._entryMap.get(mappedFileUri.key) ?? mappedFileUri;
    }

    protected isMovedEntry(uri: Uri) {
        return this._reverseEntryMap.has(uri.key);
    }

    protected clear() {
        this._entryMap.clear();
        this._reverseEntryMap.clear();
        this._folderMap.clear();
    }
}
