/*
 * importResolverTypes.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import type { FileSystem } from '../common/fileSystem';
import type { PythonVersion } from '../common/pythonVersion';
import type { Uri } from '../common/uri/uri';
import type { ImportLogger } from './importLogger';

export interface SupportedVersionInfo {
    min: PythonVersion;
    max?: PythonVersion | undefined;
    unsupportedPlatforms?: string[];
    supportedPlatforms?: string[];
}

export type TypeshedThirdPartyPackageMapResult = readonly [ReadonlyMap<string, readonly Uri[]>, readonly Uri[]];

// Optional hook used to override how typeshed-derived information is computed and cached.
//
// ImportResolver will consult this service (if registered) before falling back to a default
// implementation. Tests can use this to provide a memoized implementation so expensive
// typeshed scanning/reading work is performed once and reused across many ImportResolver instances.
export interface TypeshedInfoProvider {
    getTypeshedRoot(customTypeshedPath: Uri | undefined, importLogger?: ImportLogger): Uri | undefined;

    getTypeshedSubdirectory(
        isStdLib: boolean,
        customTypeshedPath: Uri | undefined,
        importLogger?: ImportLogger
    ): Uri | undefined;

    getThirdPartyPackageMap(
        customTypeshedPath: Uri | undefined,
        importLogger?: ImportLogger
    ): TypeshedThirdPartyPackageMapResult;

    getStdLibModuleVersionInfo(
        customTypeshedPath: Uri | undefined,
        importLogger?: ImportLogger
    ): ReadonlyMap<string, SupportedVersionInfo>;
}

// Minimal cached filesystem facade used by ImportResolver.
//
// It caches directory enumeration and a few existence/file-list lookups to avoid repeated IO.
// The API is intentionally small and tailored to ImportResolver's needs.
export interface ImportResolverFileSystem
    extends Pick<
        FileSystem,
        'existsSync' | 'realCasePath' | 'getModulePath' | 'readdirEntriesSync' | 'readFileSync' | 'statSync'
    > {
    // ImportResolver-specific helper.
    fileExists(uri: Uri): boolean;
    dirExists(uri: Uri): boolean;
    getFilesInDirectory(dirPath: Uri): readonly Uri[];
    getResolvableNamesInDirectory(dirPath: Uri): ReadonlySet<string>;
    invalidateCache(): void;
}
