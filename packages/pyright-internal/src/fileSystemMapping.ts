/*
 * fileSystemMapping.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import type * as fs from 'fs';
import { Disposable } from 'vscode-jsonrpc';

import { FileSystem, Stats, VirtualDirent } from './common/fileSystem';
import { Uri } from './common/uri/uri';
import { UriMap } from './common/uri/uriMap';
import { tryStat } from './common/uri/uriUtils';

type FileSystemMappingMethodName =
    | 'existsSync'
    | 'readdirEntriesSync'
    | 'readFileSync'
    | 'statSync'
    | 'realpathSync'
    | 'createReadStream'
    | 'readFile'
    | 'readFileText'
    | 'isMappedUri'
    | 'getOriginalUri'
    | 'getMappedUri'
    | 'mapDirectory';

export interface FileSystemMapping extends Pick<FileSystem, FileSystemMappingMethodName> {}

export interface FileSystemMappingState {
    bind(fileSystem: FileSystem): FileSystemMapping;
}

export function createFileSystemMapping(realFS: FileSystem): FileSystemMapping {
    return createFileSystemMappingState().bind(realFS);
}

export function createFileSystemMappingState(): FileSystemMappingState {
    return new FileSystemMappingStateImpl();
}

interface MappedEntry {
    mappedUri: Uri;
    originalUri: Uri;
    filter: (uri: Uri, fs: FileSystem) => boolean;
}

interface MappingData {
    readonly entryMap: UriMap<MappedEntry>;
    readonly reverseEntryMap: UriMap<MappedEntry>;
    originalUriCache: WeakMap<Uri, CachedOriginalUriResolution>;
}

interface OriginalUriResolution {
    readonly entry: MappedEntry;
    readonly originalUri: Uri;
}

const noOriginalUriResolution = Symbol();
type CachedOriginalUriResolution = OriginalUriResolution | typeof noOriginalUriResolution;

class FileSystemMappingStateImpl implements FileSystemMappingState {
    private readonly _data: MappingData = {
        entryMap: new UriMap<MappedEntry>(),
        reverseEntryMap: new UriMap<MappedEntry>(),
        originalUriCache: new WeakMap(),
    };

    bind(fileSystem: FileSystem): FileSystemMapping {
        return new FileSystemMappingImpl(this._data, fileSystem);
    }
}

class FileSystemMappingImpl implements FileSystemMapping {
    constructor(private readonly _data: MappingData, private readonly _realFS: FileSystem) {}

    existsSync(uri: Uri): boolean {
        if (this._isOriginalPath(uri)) {
            return false;
        }

        return this._realFS.existsSync(this._getInternalOriginalUri(uri));
    }

    readdirEntriesSync(uri: Uri): fs.Dirent[] {
        const entries = new Map<string, fs.Dirent>();

        for (const [key] of this._data.entryMap.entries()) {
            if (key.isChild(uri) && key.getRelativePathComponents(uri).length === 1) {
                entries.set(key.fileName, new VirtualDirent(key.fileName, false, uri.getFilePath()));
            }
        }

        const mappedEntry = this._getOriginalEntry(uri);
        if (mappedEntry) {
            const originalUri = this._getInternalOriginalUri(uri);
            for (const entry of this._realFS.readdirEntriesSync(originalUri)) {
                const originalEntryUri = originalUri.combinePaths(entry.name);
                if (!mappedEntry.filter(originalEntryUri, this._realFS)) {
                    continue;
                }

                const target = entry.isFile() || entry.isDirectory() ? entry : tryStat(this._realFS, originalEntryUri);
                if (!target || (!target.isFile() && !target.isDirectory())) {
                    continue;
                }

                entries.set(entry.name, new VirtualDirent(entry.name, target.isFile(), uri.getFilePath()));
            }
        }

        if (this._realFS.existsSync(uri)) {
            const filteredEntries = this._realFS
                .readdirEntriesSync(uri)
                .filter((entry) => !this._isOriginalPath(uri.combinePaths(entry.name)));
            for (const entry of filteredEntries) {
                entries.set(entry.name, entry);
            }
        }

        return [...entries.values()];
    }

    readFileSync(uri: Uri, encoding?: null): Buffer;
    readFileSync(uri: Uri, encoding: BufferEncoding): string;
    readFileSync(uri: Uri, encoding?: BufferEncoding | null): string | Buffer {
        return this._realFS.readFileSync(this._getInternalOriginalUri(uri), encoding);
    }

    statSync(uri: Uri): Stats {
        if (this._isOriginalPath(uri)) {
            throw new Error('ENOENT: path does not exist');
        }
        return this._realFS.statSync(this._getInternalOriginalUri(uri));
    }

    realpathSync(uri: Uri): Uri {
        if (this._data.entryMap.has(uri)) {
            return uri;
        }

        return this._realFS.realpathSync(uri);
    }

    createReadStream(uri: Uri): fs.ReadStream {
        return this._realFS.createReadStream(this._getInternalOriginalUri(uri));
    }

    readFile(uri: Uri): Promise<Buffer> {
        return this._realFS.readFile(this._getInternalOriginalUri(uri));
    }

    readFileText(uri: Uri, encoding?: BufferEncoding): Promise<string> {
        return this._realFS.readFileText(this._getInternalOriginalUri(uri), encoding);
    }

    isMappedUri(uri: Uri): boolean {
        if (this._getOriginalEntry(uri) !== undefined) {
            return true;
        }
        return this._realFS.isMappedUri(uri);
    }

    getOriginalUri(mappedUri: Uri): Uri {
        return this._realFS.getOriginalUri(this._getInternalOriginalUri(mappedUri));
    }

    getMappedUri(originalUri: Uri): Uri {
        const entry = this._getMappedEntry(originalUri);
        if (!entry) {
            return this._realFS.getMappedUri(originalUri);
        }
        const relative = entry.originalUri.getRelativePathComponents(originalUri);
        return entry.mappedUri.combinePaths(...relative);
    }

    mapDirectory(mappedUri: Uri, originalUri: Uri, filter?: (originalUri: Uri, fs: FileSystem) => boolean): Disposable {
        const entry: MappedEntry = { originalUri, mappedUri, filter: filter ?? (() => true) };
        this._data.entryMap.set(mappedUri, entry);
        this._data.reverseEntryMap.set(originalUri, entry);
        this._data.originalUriCache = new WeakMap();
        return {
            dispose: () => {
                this._data.entryMap.delete(mappedUri);
                this._data.reverseEntryMap.delete(originalUri);
                this._data.originalUriCache = new WeakMap();
            },
        };
    }

    private _findClosestMatch(uri: Uri, map: UriMap<MappedEntry>): MappedEntry | undefined {
        while (true) {
            const entry = map.get(uri);
            if (entry) {
                return entry;
            }

            const parent = uri.getDirectory();
            if (parent.equals(uri)) {
                return undefined;
            }

            uri = parent;
        }
    }

    private _getOriginalEntry(uri: Uri): MappedEntry | undefined {
        return this._findClosestMatch(uri, this._data.entryMap);
    }

    private _getInternalOriginalUri(uri: Uri): Uri {
        let resolution: CachedOriginalUriResolution | undefined = this._data.originalUriCache.get(uri);
        if (resolution === undefined) {
            const entry = this._getOriginalEntry(uri);
            if (!entry) {
                this._data.originalUriCache.set(uri, noOriginalUriResolution);
                return uri;
            }

            const relative = entry.mappedUri.getRelativePathComponents(uri);
            resolution = { entry, originalUri: entry.originalUri.combinePaths(...relative) };
            this._data.originalUriCache.set(uri, resolution);
        }

        if (resolution === noOriginalUriResolution) {
            return uri;
        }

        if (resolution.entry.filter(resolution.originalUri, this._realFS)) {
            return resolution.originalUri;
        }

        return uri;
    }

    private _getMappedEntry(uri: Uri): MappedEntry | undefined {
        const reverseMatch = this._findClosestMatch(uri, this._data.reverseEntryMap);
        if (reverseMatch && reverseMatch.filter(uri, this._realFS)) {
            return reverseMatch;
        }
        return undefined;
    }

    private _isOriginalPath(uri: Uri): boolean {
        return this._getMappedEntry(uri) !== undefined;
    }
}
