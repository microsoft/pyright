/*
 * factory.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Provides a factory to create virtual file system backed by a real file system with some path remapped
 */

import { combinePaths, getDirectoryPath, normalizeSlashes, resolvePaths } from '../../../common/pathUtils';
import { TestHost } from '../host';
import { bufferFrom } from '../utils';
import { FileSystem, FileSystemOptions, FileSystemResolver, MODULE_PATH, Mount, S_IFDIR, S_IFREG } from './filesystem';

export class TextDocument {
    readonly meta: Map<string, string>;
    readonly file: string;
    readonly text: string;

    constructor(file: string, text: string, meta?: Map<string, string>) {
        this.file = file;
        this.text = text;
        this.meta = meta || new Map<string, string>();
    }
}

export interface FileSystemCreateOptions extends FileSystemOptions {
    // Sets the documents to add to the file system.
    documents?: readonly TextDocument[];
}

export const typeshedFolder = combinePaths(MODULE_PATH, normalizeSlashes('typeshed-fallback'));
export const srcFolder = normalizeSlashes('/.src');

/**
 * Create a virtual file system from a physical file system using the following path mappings:
 *
 *  - `/typeshed-fallback` is a directory mapped to `${workspaceRoot}/../dist/typeshed-fallback`
 *  - `/.src` is a virtual directory to be used for tests.
 *
 * @param host it provides an access to host (real) file system
 * @param ignoreCase indicates whether we should ignore casing on this file system or not
 * @param documents initial documents to create in this virtual file system
 * @param files initial files to create in this virtual file system
 * @param cwd initial current working directory in this virtual file system
 * @param time initial time in this virtual file system
 * @param meta initial metadata in this virtual file system
 *
 * all `FileSystemCreateOptions` are optional
 */
export function createFromFileSystem(host: TestHost, ignoreCase: boolean,
    { documents, files, cwd, time, meta }: FileSystemCreateOptions = {}) {

    const fs = getBuiltLocal(host, meta ? meta[typeshedFolder] : undefined, ignoreCase).shadow();
    if (meta) {
        for (const key of Object.keys(meta)) {
            fs.meta.set(key, meta[key]);
        }
    }
    if (time) {
        fs.time(time);
    }
    if (cwd) {
        fs.mkdirpSync(cwd);
        fs.chdir(cwd);
    }
    if (documents) {
        for (const document of documents) {
            fs.mkdirpSync(getDirectoryPath(document.file));
            fs.writeFileSync(document.file, document.text, 'utf8');
            fs.filemeta(document.file).set('document', document);
            // Add symlinks
            const symlink = document.meta.get('symlink');
            if (symlink) {
                for (const link of symlink.split(',').map(link => link.trim())) {
                    fs.mkdirpSync(getDirectoryPath(link));
                    fs.symlinkSync(resolvePaths(fs.cwd(), document.file), link);
                }
            }
        }
    }
    if (files) {
        fs.apply(files);
    }
    return fs;
}

let cacheKey: { host: TestHost; typeshedFolderPath: string | undefined } | undefined;
let localCIFSCache: FileSystem | undefined;
let localCSFSCache: FileSystem | undefined;

function getBuiltLocal(host: TestHost, typeshedFolderPath: string | undefined, ignoreCase: boolean): FileSystem {
    if (cacheKey?.host !== host || cacheKey.typeshedFolderPath !== typeshedFolderPath) {
        localCIFSCache = undefined;
        localCSFSCache = undefined;
        cacheKey = { host, typeshedFolderPath };
    }
    if (!localCIFSCache) {
        const resolver = createResolver(host);
        typeshedFolderPath = typeshedFolderPath ?? resolvePaths(host.getWorkspaceRoot(), '../client/typeshed-fallback');
        localCIFSCache = new FileSystem(/*ignoreCase*/ true, {
            files: {
                [typeshedFolder]: new Mount(typeshedFolderPath, resolver),
                [srcFolder]: {}
            },
            cwd: srcFolder,
            meta: {}
        });
        localCIFSCache.makeReadonly();
    }

    if (ignoreCase) { return localCIFSCache; }

    if (!localCSFSCache) {
        localCSFSCache = localCIFSCache.shadow(/*ignoreCase*/ false);
        localCSFSCache.makeReadonly();
    }

    return localCSFSCache;
}

function createResolver(host: TestHost): FileSystemResolver {
    return {
        readdirSync(path: string): string[] {
            const { files, directories } = host.getAccessibleFileSystemEntries(path);
            return directories.concat(files);
        },
        statSync(path: string): { mode: number; size: number } {
            if (host.directoryExists(path)) {
                return { mode: S_IFDIR | 0o777, size: 0 };
            } else if (host.fileExists(path)) {
                return { mode: S_IFREG | 0o666, size: host.getFileSize(path) };
            } else {
                throw new Error('ENOENT: path does not exist');
            }
        },
        readFileSync(path: string): Buffer {
            return bufferFrom(host.readFile(path)!, 'utf8');
        }
    };
}
