/*
 * pyrightFileSystem.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * A file system that knows how to deal with partial stub files.
 * Files within a partial stub package act as though they are
 * copied into the associated package, and the combined set of
 * files is treated as one.
 */

import type * as fs from 'fs';

import { PyTypedInfo, getPyTypedInfo } from './analyzer/pyTypedUtils';
import { ExecutionEnvironment } from './common/configOptions';
import { FileSystem, MkDirOptions } from './common/fileSystem';
import { stubsSuffix } from './common/pathConsts';
import { Uri } from './common/uri/uri';
import { isDirectory, tryStat } from './common/uri/uriUtils';
import { ReadOnlyAugmentedFileSystem } from './readonlyAugmentedFileSystem';

export interface SupportPartialStubs {
    isPartialStubPackagesScanned(execEnv: ExecutionEnvironment): boolean;
    isPathScanned(path: Uri): boolean;
    processPartialStubPackages(paths: Uri[], roots: Uri[], bundledStubPath?: Uri): void;
    clearPartialStubs(): void;
}

export namespace SupportPartialStubs {
    export function is(value: any): value is SupportPartialStubs {
        return (
            value.isPartialStubPackagesScanned &&
            value.isPathScanned &&
            value.processPartialStubPackages &&
            value.clearPartialStubs
        );
    }
}

export interface IPyrightFileSystem extends FileSystem, SupportPartialStubs {}

export class PyrightFileSystem extends ReadOnlyAugmentedFileSystem implements IPyrightFileSystem {
    // Root paths processed
    private readonly _rootSearched = new Set<string>();

    // Partial stub package paths processed
    private readonly _partialStubPackagePaths = new Set<string>();

    constructor(realFS: FileSystem) {
        super(realFS);
    }

    override mkdirSync(uri: Uri, options?: MkDirOptions): void {
        this.realFS.mkdirSync(uri, options);
    }

    override chdir(uri: Uri): void {
        this.realFS.chdir(uri);
    }

    override writeFileSync(uri: Uri, data: string | Buffer, encoding: BufferEncoding | null): void {
        this.realFS.writeFileSync(this.getOriginalPath(uri), data, encoding);
    }

    override rmdirSync(uri: Uri): void {
        this.realFS.rmdirSync(this.getOriginalPath(uri));
    }

    override unlinkSync(uri: Uri): void {
        this.realFS.unlinkSync(this.getOriginalPath(uri));
    }

    override createWriteStream(uri: Uri): fs.WriteStream {
        return this.realFS.createWriteStream(this.getOriginalPath(uri));
    }

    override copyFileSync(src: Uri, dst: Uri): void {
        this.realFS.copyFileSync(this.getOriginalPath(src), this.getOriginalPath(dst));
    }

    isPartialStubPackagesScanned(execEnv: ExecutionEnvironment): boolean {
        return execEnv.root ? this.isPathScanned(execEnv.root) : false;
    }

    isPathScanned(uri: Uri): boolean {
        return this._rootSearched.has(uri.key);
    }

    processPartialStubPackages(
        paths: Uri[],
        roots: Uri[],
        bundledStubPath?: Uri,
        allowMoving?: (
            isBundled: boolean,
            packagePyTyped: PyTypedInfo | undefined,
            _stubPyTyped: PyTypedInfo
        ) => boolean
    ): void {
        const allowMovingFn = allowMoving ?? this._allowMoving.bind(this);
        for (const path of paths) {
            this._rootSearched.add(path.key);

            if (!this.realFS.existsSync(path) || !isDirectory(this.realFS, path)) {
                continue;
            }

            let dirEntries: fs.Dirent[] = [];

            try {
                dirEntries = this.realFS.readdirEntriesSync(path);
            } catch {
                // Leave empty set of dir entries to process.
            }

            const isBundledStub = path.equals(bundledStubPath);
            for (const entry of dirEntries) {
                const partialStubPackagePath = path.combinePaths(entry.name);
                const isDirectory = !entry.isSymbolicLink()
                    ? entry.isDirectory()
                    : !!tryStat(this.realFS, partialStubPackagePath)?.isDirectory();

                if (!isDirectory || !entry.name.endsWith(stubsSuffix)) {
                    continue;
                }

                const pyTypedInfo = getPyTypedInfo(this.realFS, partialStubPackagePath);
                if (!pyTypedInfo || !pyTypedInfo.isPartiallyTyped) {
                    // Stub-Package is fully typed.
                    continue;
                }

                // We found partially typed stub-packages.
                this._partialStubPackagePaths.add(partialStubPackagePath.key);

                // Search the root to see whether we have matching package installed.
                let partialStubs: string[] | undefined;
                const packageName = entry.name.substr(0, entry.name.length - stubsSuffix.length);
                for (const root of roots) {
                    const packagePath = root.combinePaths(packageName);
                    try {
                        const stat = tryStat(this.realFS, packagePath);
                        if (!stat?.isDirectory()) {
                            continue;
                        }

                        // If partial stub we found is from bundled stub and library installed is marked as py.typed
                        // ignore bundled partial stub.
                        if (!allowMovingFn(isBundledStub, getPyTypedInfo(this.realFS, packagePath), pyTypedInfo)) {
                            continue;
                        }
                        // Merge partial stub packages to the library.
                        partialStubs = partialStubs ?? this._getRelativePathPartialStubs(partialStubPackagePath);
                        for (const partialStub of partialStubs) {
                            const originalPyiFile = partialStubPackagePath.resolvePaths(partialStub);
                            const mappedPyiFile = packagePath.resolvePaths(partialStub);
                            this.recordMovedEntry(mappedPyiFile, originalPyiFile, packagePath);
                        }
                    } catch {
                        // ignore
                    }
                }
            }
        }
    }

    clearPartialStubs(): void {
        super.clear();

        this._rootSearched.clear();
        this._partialStubPackagePaths.clear();
    }

    protected override isMovedEntry(uri: Uri) {
        return this._partialStubPackagePaths.has(uri.key) || super.isMovedEntry(uri);
    }

    private _allowMoving(
        isBundled: boolean,
        packagePyTyped: PyTypedInfo | undefined,
        _stubPyTyped: PyTypedInfo
    ): boolean {
        if (!isBundled) {
            return true;
        }

        // If partial stub we found is from bundled stub and library installed is marked as py.typed
        // allow moving only if the package is marked as partially typed.
        return !packagePyTyped || packagePyTyped.isPartiallyTyped;
    }

    private _getRelativePathPartialStubs(partialStubPath: Uri) {
        const relativePaths: string[] = [];
        const searchAllStubs = (uri: Uri) => {
            for (const entry of this.realFS.readdirEntriesSync(uri)) {
                const filePath = uri.combinePaths(entry.name);

                let isDirectory = entry.isDirectory();
                let isFile = entry.isFile();
                if (entry.isSymbolicLink()) {
                    const stat = tryStat(this.realFS, filePath);
                    if (stat) {
                        isDirectory = stat.isDirectory();
                        isFile = stat.isFile();
                    }
                }

                if (isDirectory) {
                    searchAllStubs(filePath);
                }

                if (isFile && entry.name.endsWith('.pyi')) {
                    const relative = partialStubPath.getRelativePathComponents(filePath).join('/');
                    if (relative) {
                        relativePaths.push(relative);
                    }
                }
            }
        };

        searchAllStubs(partialStubPath);
        return relativePaths;
    }
}
