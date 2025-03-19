/*
 * readonlyAugmentedFileSystem.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * A file system that lets one to augment backing file system but not allow
 * modifying the backing file system.
 */

import type * as fs from 'fs';

import { FileSystem, MkDirOptions, Stats, VirtualDirent } from './common/fileSystem';
import { FileWatcher, FileWatcherEventHandler } from './common/fileWatcher';
import { Uri } from './common/uri/uri';
import { UriMap } from './common/uri/uriMap';
import { Disposable } from 'vscode-jsonrpc';

interface MappedEntry {
    mappedUri: Uri;
    originalUri: Uri;
    filter: (uri: Uri, fs: FileSystem) => boolean;
}

export class ReadOnlyAugmentedFileSystem implements FileSystem {
    // Mapped (fake location) directory to original directory map
    private readonly _entryMap = new UriMap<MappedEntry>();

    // Original directory to mapped (fake location) directory map
    private readonly _reverseEntryMap = new UriMap<MappedEntry>();

    constructor(protected realFS: FileSystem) {}

    existsSync(uri: Uri): boolean {
        if (this._isOriginalPath(uri)) {
            // Pretend original files don't exist anymore. They are only in their mapped location.
            return false;
        }

        return this.realFS.existsSync(this._getInternalOriginalUri(uri));
    }

    mkdirSync(uri: Uri, options?: MkDirOptions): void {
        throw new Error('Operation is not allowed.');
    }

    chdir(uri: Uri): void {
        throw new Error('Operation is not allowed.');
    }

    readdirEntriesSync(uri: Uri): fs.Dirent[] {
        // Stick all entries in a map by name to make sure we don't have duplicates.
        const entries = new Map<string, fs.Dirent>();

        // Handle the case where the directory has children that are remappings.
        // Example:
        // uri: /lib/site-packages
        // mapping: /lib/site-packages/foo -> /lib/site-packages/foo-stubs
        // We should show 'foo' as a directory in this case.
        for (const [key] of this._entryMap.entries()) {
            if (key.isChild(uri) && key.getRelativePathComponents(uri).length === 1) {
                entries.set(key.fileName, new VirtualDirent(key.fileName, false, uri.getFilePath()));
            }
        }

        // Handle the case where we're looking at a mapped directory (or a child).
        // Example:
        // uri: /lib/site-packages/foo/module
        // mapping: /lib/site-packages/foo -> /lib/site-packages/foo-stubs
        // We should list all of the children of /lib/site-packages/foo-stubs/module.
        const mappedEntry = this._getOriginalEntry(uri);
        if (mappedEntry) {
            const originalUri = this._getInternalOriginalUri(uri);
            const filteredEntries = this.realFS
                .readdirEntriesSync(originalUri)
                .filter((e) => mappedEntry.filter(originalUri.combinePaths(e.name), this.realFS))
                .map((e) => new VirtualDirent(e.name, e.isFile(), uri.getFilePath()));
            for (const entry of filteredEntries) {
                entries.set(entry.name, entry);
            }
        }

        if (this.realFS.existsSync(uri)) {
            // Get our real entries, but filter out entries that are mapped to a different location.
            // Example:
            // uri: /lib/site-packages/foo-stubs
            // mapping: /lib/site-packages/foo -> /lib/site-packages/foo-stubs
            // We should list all of the children of /lib/site-packages/foo-stubs but only if they don't match the filter
            const filteredEntries = this.realFS
                .readdirEntriesSync(uri)
                .filter((e) => !this._isOriginalPath(uri.combinePaths(e.name)));
            for (const entry of filteredEntries) {
                entries.set(entry.name, entry);
            }
        }

        return [...entries.values()];
    }

    readdirSync(uri: Uri): string[] {
        return this.readdirEntriesSync(uri).map((p) => p.name);
    }

    readFileSync(uri: Uri, encoding?: null): Buffer;
    readFileSync(uri: Uri, encoding: BufferEncoding): string;
    readFileSync(uri: Uri, encoding?: BufferEncoding | null): string | Buffer {
        return this.realFS.readFileSync(this._getInternalOriginalUri(uri), encoding);
    }

    writeFileSync(uri: Uri, data: string | Buffer, encoding: BufferEncoding | null): void {
        throw new Error('Operation is not allowed.');
    }

    statSync(uri: Uri): Stats {
        if (this._isOriginalPath(uri)) {
            // Pretend original files don't exist anymore. They are only in their mapped location.
            throw new Error('ENOENT: path does not exist');
        }
        return this.realFS.statSync(this._getInternalOriginalUri(uri));
    }

    rmdirSync(uri: Uri): void {
        throw new Error('Operation is not allowed.');
    }

    unlinkSync(uri: Uri): void {
        throw new Error('Operation is not allowed.');
    }

    realpathSync(uri: Uri): Uri {
        if (this._entryMap.has(uri)) {
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
        return this.realFS.createReadStream(this._getInternalOriginalUri(uri));
    }

    createWriteStream(uri: Uri): fs.WriteStream {
        throw new Error('Operation is not allowed.');
    }

    copyFileSync(src: Uri, dst: Uri): void {
        throw new Error('Operation is not allowed.');
    }

    // Async I/O
    readFile(uri: Uri): Promise<Buffer> {
        return this.realFS.readFile(this._getInternalOriginalUri(uri));
    }

    readFileText(uri: Uri, encoding?: BufferEncoding): Promise<string> {
        return this.realFS.readFileText(this._getInternalOriginalUri(uri), encoding);
    }

    realCasePath(uri: Uri): Uri {
        return this.realFS.realCasePath(uri);
    }

    // See whether the file is mapped to another location.
    isMappedUri(fileUri: Uri): boolean {
        if (this._getOriginalEntry(fileUri) !== undefined) {
            return true;
        }
        return this.realFS.isMappedUri(fileUri);
    }

    // Get original filepath if the given filepath is mapped.
    getOriginalUri(mappedFileUri: Uri) {
        const internalUri = this._getInternalOriginalUri(mappedFileUri);
        return this.realFS.getOriginalUri(internalUri);
    }

    // Get mapped filepath if the given filepath is mapped.
    getMappedUri(originalFileUri: Uri) {
        const entry = this._getMappedEntry(originalFileUri);
        if (!entry) {
            return this.realFS.getMappedUri(originalFileUri);
        }
        const relative = entry.originalUri.getRelativePathComponents(originalFileUri);
        return entry.mappedUri.combinePaths(...relative);
    }

    isInZip(uri: Uri): boolean {
        return this.realFS.isInZip(uri);
    }

    mapDirectory(mappedUri: Uri, originalUri: Uri, filter?: (originalUri: Uri, fs: FileSystem) => boolean): Disposable {
        const entry: MappedEntry = { originalUri, mappedUri, filter: filter ?? (() => true) };
        this._entryMap.set(mappedUri, entry);
        this._reverseEntryMap.set(originalUri, entry);
        return {
            dispose: () => {
                this._entryMap.delete(mappedUri);
                this._reverseEntryMap.delete(originalUri);
            },
        };
    }

    protected clear() {
        this._entryMap.clear();
        this._reverseEntryMap.clear();
    }

    private _findClosestMatch(uri: Uri, map: UriMap<MappedEntry>): MappedEntry | undefined {
        // Search through the map of directories to find the closest match. The
        // closest match is the longest path that is a parent of the uri.
        let entry = map.get(uri);
        if (!entry) {
            let foundKey = undefined;
            for (const [key, value] of map.entries()) {
                if (uri.isChild(key)) {
                    // Update the found key if it is a better match.
                    if (!foundKey || foundKey.getPathLength() < key.getPathLength()) {
                        foundKey = key;
                        entry = value;
                    }
                }
            }
        }
        return entry;
    }

    private _getOriginalEntry(uri: Uri): MappedEntry | undefined {
        return this._findClosestMatch(uri, this._entryMap);
    }

    // Returns the original uri if the given uri is a mapped uri in this file system's
    // internal mapping. getOriginalUri is different in that it will also ask the realFS
    // if it has a mapping too.
    private _getInternalOriginalUri(uri: Uri): Uri {
        const entry = this._getOriginalEntry(uri);
        if (!entry) {
            return uri;
        }
        const relative = entry.mappedUri.getRelativePathComponents(uri);
        const original = entry.originalUri.combinePaths(...relative);

        // Make sure this original URI passes the filter too.
        if (entry.filter(original, this.realFS)) {
            return original;
        }

        return uri;
    }

    private _getMappedEntry(uri: Uri): MappedEntry | undefined {
        const reverseMatch = this._findClosestMatch(uri, this._reverseEntryMap);

        // Uri in this case is an original Uri. It should also match the filter.
        if (reverseMatch && reverseMatch.filter(uri, this.realFS)) {
            return reverseMatch;
        }
        return undefined;
    }

    private _isOriginalPath(uri: Uri): boolean {
        // If the uri is a child of any reverse entry or equals a reversed entry, then it is an original entry.
        return this._getMappedEntry(uri) !== undefined;
    }
}
