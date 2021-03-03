/*
 * pyrightFileSystem.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * a file system that knows how to deal with partial stub files.
 */

import * as fs from 'fs';

import { getPyTypedInfo } from './analyzer/pyTypedUtils';
import { ExecutionEnvironment } from './common/configOptions';
import {
    FileSystem,
    FileWatcher,
    FileWatcherEventHandler,
    MkDirOptions,
    Stats,
    TmpfileOptions,
} from './common/fileSystem';
import { stubsSuffix } from './common/pathConsts';
import { combinePaths, ensureTrailingDirectorySeparator, getDirectoryPath, getFileName } from './common/pathUtils';

export class PyrightFileSystem implements FileSystem {
    private readonly _pathMap = new Map<string, string>();
    private readonly _folderMap = new Map<string, string[]>();

    private readonly _rootSearched = new Set<string>();
    private readonly _partialStubPackagePaths = new Set<string>();

    constructor(private _realFS: FileSystem) {}

    existsSync(path: string): boolean {
        if (this._partialStubPackagePaths.has(path)) {
            // Pretend partial stub package directory doesn't exist.
            // To be 100% correct, we need to check whether a file is under partial stub package path,
            // but for now, this is enough to make import resolver to skip this folder.
            return false;
        }

        return this._realFS.existsSync(this._getPath(path));
    }

    mkdirSync(path: string, options?: MkDirOptions | number): void {
        this._realFS.mkdirSync(path, options);
    }

    chdir(path: string): void {
        this._realFS.chdir(path);
    }

    readdirEntriesSync(path: string): fs.Dirent[] {
        const entries = this._realFS.readdirEntriesSync(path);

        const partialStubs = this._folderMap.get(ensureTrailingDirectorySeparator(path));
        if (!partialStubs) {
            return entries;
        }

        return entries.concat(partialStubs.map((f) => new FakeFile(f)));
    }

    readdirSync(path: string): string[] {
        const entries = this._realFS.readdirSync(path);

        const partialStubs = this._folderMap.get(ensureTrailingDirectorySeparator(path));
        if (!partialStubs) {
            return entries;
        }

        return entries.concat(partialStubs);
    }

    readFileSync(path: string, encoding?: null): Buffer;
    readFileSync(path: string, encoding: BufferEncoding): string;
    readFileSync(path: string, encoding?: BufferEncoding | null): string | Buffer {
        return this._realFS.readFileSync(this._getPath(path), encoding);
    }

    writeFileSync(path: string, data: string | Buffer, encoding: BufferEncoding | null): void {
        this._realFS.writeFileSync(this._getPath(path), data, encoding);
    }

    statSync(path: string): Stats {
        return this._realFS.statSync(this._getPath(path));
    }

    unlinkSync(path: string): void {
        this._realFS.unlinkSync(this._getPath(path));
    }

    realpathSync(path: string): string {
        return this._realFS.realpathSync(path);
    }

    getModulePath(): string {
        return this._realFS.getModulePath();
    }

    createFileSystemWatcher(paths: string[], listener: FileWatcherEventHandler): FileWatcher {
        return this._realFS.createFileSystemWatcher(paths, listener);
    }

    createReadStream(path: string): fs.ReadStream {
        return this._realFS.createReadStream(this._getPath(path));
    }

    createWriteStream(path: string): fs.WriteStream {
        return this._realFS.createWriteStream(this._getPath(path));
    }

    copyFileSync(src: string, dst: string): void {
        this._realFS.copyFileSync(this._getPath(src), this._getPath(dst));
    }

    // Async I/O
    readFile(path: string): Promise<Buffer> {
        return this._realFS.readFile(this._getPath(path));
    }

    readFileText(path: string, encoding?: BufferEncoding): Promise<string> {
        return this._realFS.readFileText(this._getPath(path), encoding);
    }

    // The directory returned by tmpdir must exist and be the same each time tmpdir is called.
    tmpdir(): string {
        return this._realFS.tmpdir();
    }

    tmpfile(options?: TmpfileOptions): string {
        return this._realFS.tmpfile(options);
    }

    isPartialStubPackagesScanned(execEnv: ExecutionEnvironment): boolean {
        return this.isPathScanned(execEnv.root);
    }

    isPathScanned(path: string): boolean {
        return this._rootSearched.has(path);
    }

    processPartialStubPackages(paths: string[], roots: string[]) {
        for (const path of paths) {
            this._rootSearched.add(path);

            if (!this._realFS.existsSync(path)) {
                continue;
            }

            for (const entry of this._realFS.readdirEntriesSync(path)) {
                if (!entry.isDirectory() || !entry.name.endsWith(stubsSuffix)) {
                    continue;
                }

                const partialStubPackagePath = combinePaths(path, entry.name);
                const pyTypedInfo = getPyTypedInfo(this._realFS, partialStubPackagePath);
                if (!pyTypedInfo || !pyTypedInfo.isPartiallyTyped) {
                    // Stub-Package is fully typed.
                    continue;
                }

                // We found partially typed stub-packages.
                this._partialStubPackagePaths.add(partialStubPackagePath);

                // 1. Search the root to see whether we have matching package installed.
                let partialStubs: string[] | undefined;
                const packageName = entry.name.substr(0, entry.name.length - stubsSuffix.length);
                for (const root of roots) {
                    const packagePath = combinePaths(root, packageName);
                    try {
                        const stat = this._realFS.statSync(packagePath);
                        if (!stat.isDirectory()) {
                            continue;
                        }

                        // 2. Check py.typed of the package.
                        const packagePyTyped = getPyTypedInfo(this._realFS, packagePath);
                        if (packagePyTyped && !packagePyTyped.isPartiallyTyped) {
                            // We have fully typed package.
                            continue;
                        }

                        // 3. Merge partial stub packages to the library (py.typed not exist or partially typed).
                        partialStubs = partialStubs ?? this._getRelativePathPartialStubs(partialStubPackagePath);
                        for (const partialStub of partialStubs) {
                            const pyiFile = combinePaths(packagePath, partialStub);
                            if (this.existsSync(pyiFile)) {
                                // Found existing pyi file, skip.
                                continue;
                            }

                            this._pathMap.set(pyiFile, combinePaths(partialStubPackagePath, partialStub));

                            const directory = ensureTrailingDirectorySeparator(getDirectoryPath(pyiFile));
                            getOrAdd(this._folderMap, directory, () => []).push(getFileName(pyiFile));
                        }
                    } catch {
                        // ignore
                    }
                }
            }
        }
    }

    isVirtual(filepath: string): boolean {
        return this._pathMap.has(filepath);
    }

    clearPartialStubs(): void {
        this._pathMap.clear();
        this._folderMap.clear();

        this._rootSearched.clear();
        this._partialStubPackagePaths.clear();
    }

    private _getPath(path: string) {
        return this._pathMap.get(path) ?? path;
    }

    private _getRelativePathPartialStubs(path: string) {
        const paths: string[] = [];

        const partialStubPathLength = ensureTrailingDirectorySeparator(path).length;
        const searchAllStubs = (path: string) => {
            for (const entry of this._realFS.readdirEntriesSync(path)) {
                if (entry.isDirectory()) {
                    searchAllStubs(combinePaths(path, entry.name));
                }

                if (entry.isFile() && entry.name.endsWith('.pyi')) {
                    const stubFile = combinePaths(path, entry.name);
                    const relative = stubFile.substring(partialStubPathLength);
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

class FakeFile extends fs.Dirent {
    constructor(public name: string) {
        super();
    }

    isFile(): boolean {
        return true;
    }

    isDirectory(): boolean {
        return false;
    }

    isBlockDevice(): boolean {
        return false;
    }

    isCharacterDevice(): boolean {
        return false;
    }

    isSymbolicLink(): boolean {
        return false;
    }

    isFIFO(): boolean {
        return false;
    }

    isSocket(): boolean {
        return false;
    }
}

function getOrAdd<K, V>(map: Map<K, V>, key: K, newValueFactory: () => V): V {
    const value = map.get(key);
    if (value !== undefined) {
        return value;
    }

    const newValue = newValueFactory();
    map.set(key, newValue);

    return newValue;
}
