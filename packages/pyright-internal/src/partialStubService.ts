/*
 * partialStubService.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * A service that maps partial stub packages into the original directory of the installed library.
 */

import type * as fs from 'fs';

import { Disposable } from 'vscode-jsonrpc';
import { getPyTypedInfo, PyTypedInfo } from './analyzer/pyTypedUtils';
import { ExecutionEnvironment } from './common/configOptions';
import { FileSystem } from './common/fileSystem';
import { stubsSuffix } from './common/pathConsts';
import { Uri } from './common/uri/uri';
import { isDirectory, tryStat } from './common/uri/uriUtils';

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

export class PartialStubService implements SupportPartialStubs {
    // Root paths processed
    private readonly _rootSearched = new Set<string>();

    // Partial stub package paths processed
    private readonly _partialStubPackagePaths = new Set<string>();

    // Disposables to cleanup moved directories
    private _movedDirectories: Disposable[] = [];

    constructor(private _realFs: FileSystem) {}

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

            if (!this._realFs.existsSync(path) || !isDirectory(this._realFs, path)) {
                continue;
            }

            let dirEntries: fs.Dirent[] = [];

            try {
                dirEntries = this._realFs.readdirEntriesSync(path);
            } catch {
                // Leave empty set of dir entries to process.
            }

            const isBundledStub = path.equals(bundledStubPath);
            for (const entry of dirEntries) {
                const partialStubPackagePath = path.combinePaths(entry.name);
                const isDirectory = !entry.isSymbolicLink()
                    ? entry.isDirectory()
                    : !!tryStat(this._realFs, partialStubPackagePath)?.isDirectory();

                if (!isDirectory || !entry.name.endsWith(stubsSuffix)) {
                    continue;
                }

                const pyTypedInfo = getPyTypedInfo(this._realFs, partialStubPackagePath);
                if (!pyTypedInfo || !pyTypedInfo.isPartiallyTyped) {
                    // Stub-Package is fully typed.
                    continue;
                }

                // We found partially typed stub-packages.
                this._partialStubPackagePaths.add(partialStubPackagePath.key);

                // Search the root to see whether we have matching package installed.
                const packageName = entry.name.substr(0, entry.name.length - stubsSuffix.length);
                for (const root of roots) {
                    const packagePath = root.combinePaths(packageName);
                    try {
                        const stat = tryStat(this._realFs, packagePath);
                        if (!stat?.isDirectory()) {
                            continue;
                        }

                        // If partial stub we found is from bundled stub and library installed is marked as py.typed
                        // ignore bundled partial stub.
                        if (!allowMovingFn(isBundledStub, getPyTypedInfo(this._realFs, packagePath), pyTypedInfo)) {
                            continue;
                        }
                        // Merge partial stub packages to the library.
                        this._movedDirectories.push(
                            this._realFs.mapDirectory(
                                packagePath,
                                partialStubPackagePath,
                                (u, fs) => u.hasExtension('.pyi') || (fs.existsSync(u) && fs.statSync(u).isDirectory())
                            )
                        );
                    } catch {
                        // ignore
                    }
                }
            }
        }
    }

    clearPartialStubs(): void {
        this._rootSearched.clear();
        this._partialStubPackagePaths.clear();
        this._movedDirectories.forEach((d) => d.dispose());
        this._movedDirectories = [];
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
}
