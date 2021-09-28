/*
 * parentDirectoryCache.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Cache to hold parent directory import result to make sure
 * we don't repeatedly search folders.
 */

import { getOrAdd } from '../common/collectionUtils';
import { FileSystem } from '../common/fileSystem';
import { ensureTrailingDirectorySeparator, normalizePath, normalizePathCase } from '../common/pathUtils';
import { ImportResult } from './importResult';

export type ImportPath = { importPath: string | undefined };

type CacheEntry = { importResult: ImportResult; path: string; importName: string };

export class ParentDirectoryCache {
    private readonly _importChecked = new Map<string, Map<string, ImportPath>>();
    private readonly _cachedResults = new Map<string, Map<string, ImportResult>>();

    private _libPathCache: string[] | undefined = undefined;

    constructor(private _importRootGetter: () => string[]) {
        // empty
    }

    getImportResult(path: string, importName: string, importResult: ImportResult): ImportResult | undefined {
        const result = this._cachedResults.get(importName)?.get(path);
        if (result) {
            // We already checked for the importName at the path.
            // Return the result if succeeded otherwise, return regular import result given.
            return result ?? importResult;
        }

        const checked = this._importChecked.get(importName)?.get(path);
        if (checked) {
            // We already checked for the importName at the path.
            if (!checked.importPath) {
                return importResult;
            }

            return this._cachedResults.get(importName)?.get(checked.importPath) ?? importResult;
        }

        return undefined;
    }

    checkValidPath(fs: FileSystem, sourceFilePath: string, root: string): boolean {
        if (!sourceFilePath.startsWith(root)) {
            // We don't search containing folders for libs.
            return false;
        }

        this._libPathCache =
            this._libPathCache ??
            this._importRootGetter()
                .map((r) => ensureTrailingDirectorySeparator(normalizePathCase(fs, normalizePath(r))))
                .filter((r) => r !== root)
                .filter((r) => r.startsWith(root));

        if (this._libPathCache.some((p) => sourceFilePath.startsWith(p))) {
            // Make sure it is not lib folders under user code root.
            // ex) .venv folder
            return false;
        }

        return true;
    }

    checked(path: string, importName: string, importPath: ImportPath) {
        getOrAdd(this._importChecked, importName, () => new Map<string, ImportPath>()).set(path, importPath);
    }

    add(result: CacheEntry) {
        getOrAdd(this._cachedResults, result.importName, () => new Map<string, ImportResult>()).set(
            result.path,
            result.importResult
        );
    }

    reset() {
        this._importChecked.clear();
        this._cachedResults.clear();
        this._libPathCache = undefined;
    }
}
