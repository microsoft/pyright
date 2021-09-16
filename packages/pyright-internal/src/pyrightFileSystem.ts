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
import {
    FileSystem,
    FileWatcher,
    FileWatcherEventHandler,
    MkDirOptions,
    Stats,
    TmpfileOptions,
    VirtualDirent,
} from './common/fileSystem';
import { stubsSuffix } from './common/pathConsts';
import {
    changeAnyExtension,
    combinePaths,
    ensureTrailingDirectorySeparator,
    getDirectoryPath,
    getFileName,
    isDirectory,
    tryStat,
} from './common/pathUtils';

export class PyrightFileSystem implements FileSystem {
    // Mapped file to original file map
    private readonly _fileMap = new Map<string, string>();

    // Original file to mapped file map
    private readonly _reverseFileMap = new Map<string, string>();

    // Mapped files per a containing folder map
    private readonly _folderMap = new Map<string, string[]>();

    // Root paths processed
    private readonly _rootSearched = new Set<string>();

    // Partial stub package paths processed
    private readonly _partialStubPackagePaths = new Set<string>();

    // Conflicted files. We keep these in case we want something such as doc string
    // from files.
    private readonly _conflictMap = new Map<string, string>();

    private readonly _customUriMap = new Map<string, { uri: string; closed: boolean; hasPendingRequest: boolean }>();

    constructor(private _realFS: FileSystem) {}

    existsSync(path: string): boolean {
        if (this._isVirtualEntry(path)) {
            // Pretend partial stub folder and its files not exist
            return false;
        }

        return this._realFS.existsSync(this._getPartialStubOriginalPath(path));
    }

    mkdirSync(path: string, options?: MkDirOptions): void {
        this._realFS.mkdirSync(path, options);
    }

    chdir(path: string): void {
        this._realFS.chdir(path);
    }

    readdirEntriesSync(path: string): fs.Dirent[] {
        const entries = this._realFS.readdirEntriesSync(path).filter((item) => {
            // Filter out the stub package directory.
            return !this._isVirtualEntry(combinePaths(path, item.name));
        });

        const partialStubs = this._folderMap.get(ensureTrailingDirectorySeparator(path));
        if (!partialStubs) {
            return entries;
        }

        return entries.concat(partialStubs.map((f) => new VirtualDirent(f, /* file */ true)));
    }

    readdirSync(path: string): string[] {
        const entries = this._realFS.readdirSync(path).filter((item) => {
            // Filter out the stub package directory.
            return !this._isVirtualEntry(combinePaths(path, item));
        });

        const partialStubs = this._folderMap.get(ensureTrailingDirectorySeparator(path));
        if (!partialStubs) {
            return entries;
        }

        return entries.concat(partialStubs);
    }

    readFileSync(path: string, encoding?: null): Buffer;
    readFileSync(path: string, encoding: BufferEncoding): string;
    readFileSync(path: string, encoding?: BufferEncoding | null): string | Buffer {
        return this._realFS.readFileSync(this._getPartialStubOriginalPath(path), encoding);
    }

    writeFileSync(path: string, data: string | Buffer, encoding: BufferEncoding | null): void {
        this._realFS.writeFileSync(this._getPartialStubOriginalPath(path), data, encoding);
    }

    statSync(path: string): Stats {
        return this._realFS.statSync(this._getPartialStubOriginalPath(path));
    }

    unlinkSync(path: string): void {
        this._realFS.unlinkSync(this._getPartialStubOriginalPath(path));
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
        return this._realFS.createReadStream(this._getPartialStubOriginalPath(path));
    }

    createWriteStream(path: string): fs.WriteStream {
        return this._realFS.createWriteStream(this._getPartialStubOriginalPath(path));
    }

    copyFileSync(src: string, dst: string): void {
        this._realFS.copyFileSync(this._getPartialStubOriginalPath(src), this._getPartialStubOriginalPath(dst));
    }

    // Async I/O
    readFile(path: string): Promise<Buffer> {
        return this._realFS.readFile(this._getPartialStubOriginalPath(path));
    }

    readFileText(path: string, encoding?: BufferEncoding): Promise<string> {
        return this._realFS.readFileText(this._getPartialStubOriginalPath(path), encoding);
    }

    // The directory returned by tmpdir must exist and be the same each time tmpdir is called.
    tmpdir(): string {
        return this._realFS.tmpdir();
    }

    tmpfile(options?: TmpfileOptions): string {
        return this._realFS.tmpfile(options);
    }

    realCasePath(path: string): string {
        return this._realFS.realCasePath(path);
    }

    getUri(originalPath: string): string {
        const entry = this._customUriMap.get(this.getMappedFilePath(originalPath));
        if (entry) {
            return entry.uri;
        }

        return this._realFS.getUri(originalPath);
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

    processPartialStubPackages(paths: string[], roots: string[]) {
        for (const path of paths) {
            this._rootSearched.add(path);

            if (!this._realFS.existsSync(path) || !isDirectory(this._realFS, path)) {
                continue;
            }

            for (const entry of this._realFS.readdirEntriesSync(path)) {
                const partialStubPackagePath = combinePaths(path, entry.name);
                const isDirectory = !entry.isSymbolicLink()
                    ? entry.isDirectory()
                    : !!tryStat(this._realFS, partialStubPackagePath)?.isDirectory();

                if (!isDirectory || !entry.name.endsWith(stubsSuffix)) {
                    continue;
                }

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
                        const stat = tryStat(this._realFS, packagePath);
                        if (!stat?.isDirectory()) {
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
                            const originalPyiFile = combinePaths(partialStubPackagePath, partialStub);
                            const mappedPyiFile = combinePaths(packagePath, partialStub);

                            if (this.existsSync(mappedPyiFile)) {
                                // If we have a conflict, first check whether we should save
                                // the partial stub for later such as doc string for compiled module,
                                // otherwise, just skip it.
                                const mappedPyFile = changeAnyExtension(mappedPyiFile, 'py');
                                const tmpPyFile = changeAnyExtension(
                                    combinePaths(this.tmpdir(), 'conflictFiles', packageName, partialStub),
                                    'py'
                                );

                                // If no source file exists and never saved the conflict file before,
                                // save it for doc string.
                                if (
                                    !this._conflictMap.has(mappedPyiFile) &&
                                    !this.existsSync(mappedPyFile) &&
                                    !this.existsSync(tmpPyFile)
                                ) {
                                    // We let people to go from tmpPyFile to originalPyiFile but
                                    // not the other way around. what that means is that even if a user opens
                                    // the file explicitly from real file system (ex, vscode open file), it won't
                                    // go to the fake tmp py file. but open as it is.
                                    this._recordVirtualFile(tmpPyFile, originalPyiFile, /* reversible */ false);

                                    // This should be the only way to get to the tmp py file. and used internally
                                    // to get some info like doc string of compiled module.
                                    this._conflictMap.set(mappedPyiFile, tmpPyFile);
                                }
                                continue;
                            }

                            this._recordVirtualFile(mappedPyiFile, originalPyiFile);
                        }
                    } catch {
                        // ignore
                    }
                }
            }
        }
    }

    clearPartialStubs(): void {
        this._fileMap.clear();
        this._folderMap.clear();

        this._rootSearched.clear();
        this._partialStubPackagePaths.clear();

        this._conflictMap.clear();
    }

    // See whether the file is mapped to another location.
    isMappedFilePath(filepath: string): boolean {
        return this._fileMap.has(filepath) || this._realFS.isMappedFilePath(filepath);
    }

    // Get original filepath if the given filepath is mapped.
    getOriginalFilePath(mappedFilePath: string) {
        return this._realFS.getOriginalFilePath(this._getPartialStubOriginalPath(mappedFilePath));
    }

    // Get mapped filepath if the given filepath is mapped.
    getMappedFilePath(originalFilepath: string) {
        const mappedFilePath = this._realFS.getMappedFilePath(originalFilepath);
        return this._reverseFileMap.get(mappedFilePath) ?? mappedFilePath;
    }

    // If we have a conflict file from the partial stub packages for the given file path,
    // return it.
    getConflictedFile(filepath: string) {
        return this._conflictMap.get(filepath);
    }

    isInZipOrEgg(path: string): boolean {
        return this._realFS.isInZipOrEgg(path);
    }

    private _recordVirtualFile(mappedFile: string, originalFile: string, reversible = true) {
        this._fileMap.set(mappedFile, originalFile);

        if (reversible) {
            this._reverseFileMap.set(originalFile, mappedFile);
        }

        const directory = ensureTrailingDirectorySeparator(getDirectoryPath(mappedFile));
        let folderInfo = this._folderMap.get(directory);
        if (!folderInfo) {
            folderInfo = [];
            this._folderMap.set(directory, folderInfo);
        }

        const fileName = getFileName(mappedFile);
        if (!folderInfo.some((entry) => entry === fileName)) {
            folderInfo.push(fileName);
        }
    }

    private _getPartialStubOriginalPath(mappedFilePath: string) {
        return this._fileMap.get(mappedFilePath) ?? mappedFilePath;
    }

    private _getRelativePathPartialStubs(path: string) {
        const paths: string[] = [];

        const partialStubPathLength = ensureTrailingDirectorySeparator(path).length;
        const searchAllStubs = (path: string) => {
            for (const entry of this._realFS.readdirEntriesSync(path)) {
                const filePath = combinePaths(path, entry.name);

                let isDirectory = entry.isDirectory();
                let isFile = entry.isFile();
                if (entry.isSymbolicLink()) {
                    const stat = tryStat(this._realFS, filePath);
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

    private _isVirtualEntry(path: string) {
        return this._partialStubPackagePaths.has(path) || this._reverseFileMap.has(path);
    }
}
