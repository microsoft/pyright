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
import { Uri } from '../common/uri/uri';
import { ImportResult } from './importResult';

export type ImportPath = { importPath: Uri | undefined };

type CacheEntry = { importResult: ImportResult; path: Uri; importName: string };

export class ParentDirectoryCache {
    private readonly _importChecked = new Map<string, Map<string, ImportPath>>();
    private readonly _cachedResults = new Map<string, Map<string, ImportResult>>();

    private _libPathCache: Uri[] | undefined = undefined;

    constructor(private _importRootGetter: () => Uri[]) {
        // empty
    }

    getImportResult(path: Uri, importName: string, importResult: ImportResult): ImportResult | undefined {
        const result = this._cachedResults.get(importName)?.get(path.key);
        if (result) {
            // We already checked for the importName at the path.
            return result;
        }

        const checked = this._importChecked.get(importName)?.get(path.key);
        if (checked) {
            // We already checked for the importName at the path.
            if (!checked.importPath) {
                return importResult;
            }

            return this._cachedResults.get(importName)?.get(checked.importPath.key) ?? importResult;
        }

        return undefined;
    }

    checkValidPath(fs: FileSystem, sourceFileUri: Uri, root: Uri): boolean {
        if (!sourceFileUri.startsWith(root)) {
            // We don't search containing folders for libs.
            return false;
        }

        this._libPathCache =
            this._libPathCache ??
            this._importRootGetter()
                .map((r) => fs.realCasePath(r))
                .filter((r) => !r.equals(root))
                .filter((r) => r.startsWith(root));

        if (this._libPathCache.some((p) => sourceFileUri.startsWith(p))) {
            // Make sure it is not lib folders under user code root.
            // ex) .venv folder
            return false;
        }

        return true;
    }

    checked(path: Uri, importName: string, importPath: ImportPath) {
        getOrAdd(this._importChecked, importName, () => new Map<string, ImportPath>()).set(path.key, importPath);
    }

    add(result: CacheEntry) {
        getOrAdd(this._cachedResults, result.importName, () => new Map<string, ImportResult>()).set(
            result.path.key,
            result.importResult
        );
    }

    reset() {
        this._importChecked.clear();
        this._cachedResults.clear();
        this._libPathCache = undefined;
    }
}
