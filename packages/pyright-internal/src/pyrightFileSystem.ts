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

import { getPyTypedInfo } from './analyzer/pyTypedUtils';
import { ExecutionEnvironment } from './common/configOptions';
import { FileSystem, MkDirOptions } from './common/fileSystem';
import { stubsSuffix } from './common/pathConsts';
import { combinePaths, ensureTrailingDirectorySeparator, isDirectory, tryStat } from './common/pathUtils';
import { ReadOnlyAugmentedFileSystem } from './readonlyAugmentedFileSystem';

export interface SupportPartialStubs {
    isPartialStubPackagesScanned(execEnv: ExecutionEnvironment): boolean;
    isPathScanned(path: string): boolean;
    processPartialStubPackages(paths: string[], roots: string[], bundledStubPath?: string): void;
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

export interface SupportUriToPathMapping {
    hasUriMapEntry(uriString: string, mappedPath: string): boolean;
    addUriMap(uriString: string, mappedPath: string): boolean;
    removeUriMap(uriString: string, mappedPath: string): boolean;
    pendingRequest(mappedPath: string, hasPendingRequest: boolean): void;
}

export namespace SupportUriToPathMapping {
    export function is(value: any): value is SupportUriToPathMapping {
        return value.hasUriMapEntry && value.addUriMap && value.removeUriMap && value.pendingRequest;
    }
}

export interface IPyrightFileSystem extends FileSystem, SupportPartialStubs, SupportUriToPathMapping {}

export class PyrightFileSystem extends ReadOnlyAugmentedFileSystem implements IPyrightFileSystem {
    // Root paths processed
    private readonly _rootSearched = new Set<string>();

    // Partial stub package paths processed
    private readonly _partialStubPackagePaths = new Set<string>();

    private readonly _customUriMap = new Map<string, { uri: string; closed: boolean; hasPendingRequest: boolean }>();

    constructor(realFS: FileSystem) {
        super(realFS);
    }

    override mkdirSync(path: string, options?: MkDirOptions): void {
        this.realFS.mkdirSync(path, options);
    }

    override chdir(path: string): void {
        this.realFS.chdir(path);
    }

    override writeFileSync(path: string, data: string | Buffer, encoding: BufferEncoding | null): void {
        this.realFS.writeFileSync(this.getOriginalPath(path), data, encoding);
    }

    override rmdirSync(path: string): void {
        this.realFS.rmdirSync(this.getOriginalPath(path));
    }

    override unlinkSync(path: string): void {
        this.realFS.unlinkSync(this.getOriginalPath(path));
    }

    override createWriteStream(path: string): fs.WriteStream {
        return this.realFS.createWriteStream(this.getOriginalPath(path));
    }

    override copyFileSync(src: string, dst: string): void {
        this.realFS.copyFileSync(this.getOriginalPath(src), this.getOriginalPath(dst));
    }

    override getUri(originalPath: string): string {
        const entry = this._customUriMap.get(this.getMappedFilePath(originalPath));
        if (entry) {
            return entry.uri;
        }

        return this.realFS.getUri(originalPath);
    }

    hasUriMapEntry(uriString: string, mappedPath: string): boolean {
        const entry = this._customUriMap.get(mappedPath);
        if (!entry || entry.uri !== uriString) {
            // We don't support having 2 uri pointing to same file.
            return false;
        }

        return true;
    }

    addUriMap(uriString: string, mappedPath: string): boolean {
        const entry = this._customUriMap.get(mappedPath);
        if (!entry) {
            this._customUriMap.set(mappedPath, { uri: uriString, closed: false, hasPendingRequest: false });
            return true;
        }

        if (entry.uri !== uriString) {
            // We don't support having 2 uri pointing to same file.
            return false;
        }

        entry.closed = false;
        return true;
    }

    removeUriMap(uriString: string, mappedPath: string): boolean {
        const entry = this._customUriMap.get(mappedPath);
        if (!entry || entry.uri !== uriString) {
            return false;
        }

        if (entry.hasPendingRequest) {
            entry.closed = true;
            return true;
        }

        this._customUriMap.delete(mappedPath);
        return true;
    }

    pendingRequest(mappedPath: string, hasPendingRequest: boolean): void {
        const entry = this._customUriMap.get(mappedPath);
        if (!entry) {
            return;
        }

        if (!hasPendingRequest && entry.closed) {
            this._customUriMap.delete(mappedPath);
            return;
        }

        entry.hasPendingRequest = hasPendingRequest;
    }

    isPartialStubPackagesScanned(execEnv: ExecutionEnvironment): boolean {
        return this.isPathScanned(execEnv.root ?? '');
    }

    isPathScanned(path: string): boolean {
        return this._rootSearched.has(path);
    }

    processPartialStubPackages(paths: string[], roots: string[], bundledStubPath?: string) {
        for (const path of paths) {
            this._rootSearched.add(path);

            if (!this.realFS.existsSync(path) || !isDirectory(this.realFS, path)) {
                continue;
            }

            let dirEntries: fs.Dirent[] = [];

            try {
                dirEntries = this.realFS.readdirEntriesSync(path);
            } catch {
                // Leave empty set of dir entries to process.
            }

            const isBundledStub = path === bundledStubPath;
            for (const entry of dirEntries) {
                const partialStubPackagePath = combinePaths(path, entry.name);
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
                this._partialStubPackagePaths.add(partialStubPackagePath);

                // Search the root to see whether we have matching package installed.
                let partialStubs: string[] | undefined;
                const packageName = entry.name.substr(0, entry.name.length - stubsSuffix.length);
                for (const root of roots) {
                    const packagePath = combinePaths(root, packageName);
                    try {
                        const stat = tryStat(this.realFS, packagePath);
                        if (!stat?.isDirectory()) {
                            continue;
                        }

                        if (isBundledStub) {
                            // If partial stub we found is from bundled stub and library installed is marked as py.typed
                            // ignore bundled partial stub.
                            const packagePyTyped = getPyTypedInfo(this.realFS, packagePath);
                            if (packagePyTyped && !packagePyTyped.isPartiallyTyped) {
                                // We have fully typed package.
                                continue;
                            }
                        }

                        // Merge partial stub packages to the library.
                        partialStubs = partialStubs ?? this._getRelativePathPartialStubs(partialStubPackagePath);
                        for (const partialStub of partialStubs) {
                            const originalPyiFile = combinePaths(partialStubPackagePath, partialStub);
                            const mappedPyiFile = combinePaths(packagePath, partialStub);

                            this.recordMovedEntry(mappedPyiFile, originalPyiFile);
                        }
                    } catch {
                        // ignore
                    }
                }
            }
        }
    }

    override dispose(): void {
        this.realFS.dispose();
    }

    clearPartialStubs(): void {
        super.clear();

        this._rootSearched.clear();
        this._partialStubPackagePaths.clear();
    }

    protected override isMovedEntry(path: string) {
        return this._partialStubPackagePaths.has(path) || super.isMovedEntry(path);
    }

    private _getRelativePathPartialStubs(path: string) {
        const paths: string[] = [];

        const partialStubPathLength = ensureTrailingDirectorySeparator(path).length;
        const searchAllStubs = (path: string) => {
            for (const entry of this.realFS.readdirEntriesSync(path)) {
                const filePath = combinePaths(path, entry.name);

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
                    const relative = filePath.substring(partialStubPathLength);
                    if (relative) {
                        paths.push(relative);
                    }
                }
            }
        };

        searchAllStubs(path);
        return paths;
    }
}
