/*
 * factory.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Provides a factory to create virtual file system backed by a real file system with some path remapped
 */

import * as pathConsts from '../../../common/pathConsts';
import { combinePaths, getDirectoryPath, normalizeSlashes, resolvePaths } from '../../../common/pathUtils';
import { UriEx } from '../../../common/uri/uriUtils';
import { GlobalMetadataOptionNames } from '../fourslash/fourSlashTypes';
import { TestHost } from '../testHost';
import { bufferFrom } from '../utils';
import {
    FileSet,
    FileSystemOptions,
    FileSystemResolver,
    MODULE_PATH,
    Mount,
    S_IFDIR,
    S_IFREG,
    TestFileSystem,
} from './filesystem';

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

// Make sure all paths are lower case since `isCaseSensitive` is hard coded as `true`
export const libFolder = UriEx.file(
    combinePaths(MODULE_PATH, normalizeSlashes(combinePaths(pathConsts.lib, pathConsts.sitePackages)))
);
export const distlibFolder = UriEx.file(
    combinePaths(MODULE_PATH, normalizeSlashes(combinePaths(pathConsts.lib, pathConsts.distPackages)))
);
export const typeshedFolder = UriEx.file(combinePaths(MODULE_PATH, normalizeSlashes(pathConsts.typeshedFallback)));
export const srcFolder = normalizeSlashes('/.src');

/**
 * Create a virtual file system from a physical file system using the following path mappings:
 *
 *  - `/typeshed-fallback` is a directory mapped to `packages/pyright-internal/typeshed-fallback`
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
export function createFromFileSystem(
    host: TestHost,
    ignoreCase: boolean,
    { documents, files, cwd, time, meta }: FileSystemCreateOptions = {},
    mountPaths: Map<string, string> = new Map<string, string>()
) {
    const typeshedPath = meta ? meta[GlobalMetadataOptionNames.typeshed] : undefined;
    if (typeshedPath) {
        mountPaths.set(typeshedFolder.key, typeshedPath);
    }

    const fs = getBuiltLocal(host, ignoreCase, cwd, mountPaths).shadow();
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
        fs.chdir(UriEx.file(cwd, !ignoreCase));
    }
    if (documents) {
        for (const document of documents) {
            fs.mkdirpSync(getDirectoryPath(document.file));
            fs.writeFileSync(UriEx.file(document.file, !ignoreCase), document.text, 'utf8');
            fs.filemeta(document.file).set('document', document);
            // Add symlinks
            const symlink = document.meta.get('symlink');
            if (symlink) {
                for (const link of symlink.split(',').map((link) => link.trim())) {
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

let cacheKey: { host: TestHost; mountPaths: Map<string, string> } | undefined;
let localCIFSCache: TestFileSystem | undefined;
let localCSFSCache: TestFileSystem | undefined;

export function clearCache() {
    cacheKey = undefined;
    localCIFSCache = undefined;
    localCSFSCache = undefined;
}

function getBuiltLocal(
    host: TestHost,
    ignoreCase: boolean,
    cwd: string | undefined,
    mountPaths: Map<string, string>
): TestFileSystem {
    // Ensure typeshed folder
    if (!mountPaths.has(typeshedFolder.key)) {
        mountPaths.set(typeshedFolder.key, resolvePaths(host.getWorkspaceRoot(), pathConsts.typeshedFallback));
    }

    if (!canReuseCache(host, mountPaths)) {
        localCIFSCache = undefined;
        localCSFSCache = undefined;
        cacheKey = { host, mountPaths };
    }

    if (!localCIFSCache) {
        const resolver = createResolver(host);
        const files: FileSet = {};
        mountPaths.forEach((v, k) => (files[k] = new Mount(v, resolver)));

        localCIFSCache = new TestFileSystem(/* ignoreCase */ true, {
            files,
            cwd,
            meta: {},
        });
        localCIFSCache.makeReadonly();
    }

    if (ignoreCase) {
        return localCIFSCache;
    }

    if (!localCSFSCache) {
        localCSFSCache = localCIFSCache.shadow(/* ignoreCase */ false);
        localCSFSCache.makeReadonly();
    }

    return localCSFSCache;
}

function canReuseCache(host: TestHost, mountPaths: Map<string, string>): boolean {
    if (cacheKey === undefined) {
        return false;
    }
    if (cacheKey.host !== host) {
        return false;
    }
    if (cacheKey.mountPaths.size !== mountPaths.size) {
        return false;
    }

    for (const key of cacheKey.mountPaths.keys()) {
        if (cacheKey.mountPaths.get(key) !== mountPaths.get(key)) {
            return false;
        }
    }

    return true;
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
        },
    };
}
