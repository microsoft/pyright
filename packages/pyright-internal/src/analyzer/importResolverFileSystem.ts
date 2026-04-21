/*
 * importResolverFileSystem.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import type { FileSystem, Stats } from '../common/fileSystem';
import { stubsSuffix } from '../common/pathConsts';
import { stripFileExtension } from '../common/pathUtils';
import { Uri } from '../common/uri/uri';
import { isDirectory, isFile, tryRealpath, tryStat } from '../common/uri/uriUtils';

import { ImportResolverFileSystem } from './importResolverTypes';

type Dirent = ReturnType<FileSystem['readdirEntriesSync']>[number];

interface CachedDir {
    entriesByName: ReadonlyMap<string, Dirent>;
    entriesArray: Dirent[];
    resolvableNames: ReadonlySet<string>;
}

export function createImportResolverFileSystem(fileSystem: FileSystem): ImportResolverFileSystem {
    return new ImportResolverFileSystemImpl(fileSystem);
}

class ImportResolverFileSystemImpl implements ImportResolverFileSystem {
    private readonly _cachedDirInfoForPath = new Map<string, CachedDir>();
    private readonly _cachedFilesForPath = new Map<string, Uri[]>();
    private readonly _cachedDirExistenceForRoot = new Map<string, boolean>();

    constructor(private readonly _fileSystem: FileSystem) {}

    invalidateCache(): void {
        this._cachedDirInfoForPath.clear();
        this._cachedFilesForPath.clear();
        this._cachedDirExistenceForRoot.clear();
    }

    readdirEntriesSync(uri: Uri): Dirent[] {
        return this._getCachedDir(uri).entriesArray;
    }

    getResolvableNamesInDirectory(dirPath: Uri): ReadonlySet<string> {
        return this._getCachedDir(dirPath).resolvableNames;
    }

    fileExists(uri: Uri): boolean {
        const directory = uri.getDirectory();
        if (directory.equals(uri)) {
            // Started at root, so this can't be a file.
            return false;
        }

        const cachedDir = this._getCachedDir(directory);
        const entry = cachedDir.entriesByName.get(uri.fileName);
        if (entry?.isFile()) {
            return true;
        }

        if (entry?.isSymbolicLink()) {
            const realPath = tryRealpath(this._fileSystem, uri);
            if (realPath && this._fileSystem.existsSync(realPath) && isFile(this._fileSystem, realPath)) {
                return true;
            }
        }

        return false;
    }

    dirExists(uri: Uri): boolean {
        const parent = uri.getDirectory();
        if (parent.equals(uri)) {
            // Started at root. No entries to read, so have to check ourselves.
            const cachedExistence = this._cachedDirExistenceForRoot.get(uri.key);
            if (cachedExistence !== undefined) {
                return cachedExistence;
            }

            const exists = tryStat(this._fileSystem, uri)?.isDirectory() ?? false;
            this._cachedDirExistenceForRoot.set(uri.key, exists);
            return exists;
        }

        const cachedDir = this._getCachedDir(parent);
        const entry = cachedDir.entriesByName.get(uri.fileName);
        if (entry?.isDirectory()) {
            return true;
        }

        if (entry?.isSymbolicLink()) {
            const realPath = tryRealpath(this._fileSystem, uri);
            if (realPath && this._fileSystem.existsSync(realPath) && isDirectory(this._fileSystem, realPath)) {
                return true;
            }
        }

        return false;
    }

    getFilesInDirectory(dirPath: Uri): readonly Uri[] {
        const cachedValue = this._cachedFilesForPath.get(dirPath.key);
        if (cachedValue) {
            return cachedValue;
        }

        let newCacheValue: Uri[] = [];
        try {
            const entriesInDir = this._getCachedDir(dirPath);
            const filesInDir: Dirent[] = [];

            // Add any files or symbolic links that point to files.
            entriesInDir.entriesArray.forEach((entry) => {
                if (entry.isFile()) {
                    filesInDir.push(entry);
                } else if (
                    entry.isSymbolicLink() &&
                    tryStat(this._fileSystem, dirPath.combinePaths(entry.name))?.isFile()
                ) {
                    filesInDir.push(entry);
                }
            });

            newCacheValue = filesInDir.map((f) => dirPath.combinePaths(f.name));
        } catch {
            newCacheValue = [];
        }

        this._cachedFilesForPath.set(dirPath.key, newCacheValue);
        return newCacheValue;
    }

    existsSync(uri: Uri): boolean {
        return this._fileSystem.existsSync(uri);
    }

    readFileSync(uri: Uri, encoding?: null): Buffer;
    readFileSync(uri: Uri, encoding: BufferEncoding): string;
    readFileSync(uri: Uri, encoding?: BufferEncoding | null): string | Buffer {
        return this._fileSystem.readFileSync(uri, encoding as BufferEncoding | null);
    }

    statSync(uri: Uri): Stats {
        return this._fileSystem.statSync(uri);
    }

    realCasePath(uri: Uri): Uri {
        return this._fileSystem.realCasePath(uri);
    }

    getModulePath(): Uri {
        return this._fileSystem.getModulePath();
    }

    private _getCachedDir(dirPath: Uri): CachedDir {
        const cachedValue = this._cachedDirInfoForPath.get(dirPath.key);
        if (cachedValue) {
            return cachedValue;
        }

        const entriesByName = new Map<string, Dirent>();
        const resolvableNames = new Set<string>();
        let entriesArray: Dirent[] = [];

        try {
            const entries = this._fileSystem.readdirEntriesSync(dirPath);
            entriesArray = entries;

            entries.forEach((entry) => {
                entriesByName.set(entry.name, entry);

                let isFile = entry.isFile();
                let isDirectory = entry.isDirectory();
                if (entry.isSymbolicLink()) {
                    const stat = tryStat(this._fileSystem, dirPath.combinePaths(entry.name));
                    isFile = !!stat?.isFile();
                    isDirectory = !!stat?.isDirectory();
                }

                const resolvableName = isFile
                    ? stripFileExtension(entry.name, /* multiDotExtension */ true)
                    : entry.name;
                resolvableNames.add(resolvableName);

                if (isDirectory && entry.name.endsWith(stubsSuffix)) {
                    resolvableNames.add(resolvableName.substring(0, resolvableName.length - stubsSuffix.length));
                }
            });
        } catch {
            // Swallow error.
        }

        const frozen: CachedDir = {
            entriesByName,
            entriesArray,
            resolvableNames,
        };

        this._cachedDirInfoForPath.set(dirPath.key, frozen);
        return frozen;
    }
}
