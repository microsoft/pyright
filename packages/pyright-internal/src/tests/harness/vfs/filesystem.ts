/*
 * filesystem.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * virtual file system implementation
 */

/* eslint-disable no-dupe-class-members */
import { Dirent, ReadStream, WriteStream } from 'fs';

import { CaseSensitivityDetector } from '../../../common/caseSensitivityDetector';
import { FileSystem, MkDirOptions, TempFile, TmpfileOptions } from '../../../common/fileSystem';
import { FileWatcher, FileWatcherEventHandler, FileWatcherEventType } from '../../../common/fileWatcher';
import * as pathUtil from '../../../common/pathUtils';
import { compareStringsCaseInsensitive, compareStringsCaseSensitive } from '../../../common/stringUtils';
import { FileUriSchema } from '../../../common/uri/fileUri';
import { Uri } from '../../../common/uri/uri';
import { bufferFrom, createIOError } from '../utils';
import { Metadata, SortedMap, closeIterator, getIterator, nextResult } from './../utils';
import { ValidationFlags, validate } from './pathValidation';
import { Disposable } from 'vscode-jsonrpc';

export const MODULE_PATH = pathUtil.normalizeSlashes('/');

let devCount = 0; // A monotonically increasing count of device ids
let inoCount = 0; // A monotonically increasing count of inodes

export interface DiffOptions {
    includeChangedFileWithSameContent?: boolean;
}

export class TestFileSystemWatcher implements FileWatcher {
    constructor(readonly paths: Uri[], private _listener: FileWatcherEventHandler) {}
    close() {
        // Do nothing.
    }

    fireFileChange(path: Uri, eventType: FileWatcherEventType): boolean {
        if (this.paths.some((p) => path.startsWith(p))) {
            this._listener(eventType, path.getFilePath());
        }
        return false;
    }
}

/**
 * Represents a virtual POSIX-like file system.
 */
export class TestFileSystem implements FileSystem, TempFile, CaseSensitivityDetector {
    /** Indicates whether the file system is case-sensitive (`false`) or case-insensitive (`true`). */
    readonly ignoreCase: boolean;

    /** Gets the comparison function used to compare two paths. */
    readonly stringComparer: (a: string, b: string) => number;

    // lazy-initialized state that should be mutable even if the FileSystem is frozen.
    private _lazy: {
        links?: SortedMap<string, Inode>;
        shadows?: Map<number, Inode>;
        meta?: Metadata;
    } = {};

    private _cwd: string; // current working directory
    private _time: number | Date | (() => number | Date);
    private _shadowRoot: TestFileSystem | undefined;
    private _dirStack: string[] | undefined;
    private _tmpfileCounter = 0;
    private _watchers: TestFileSystemWatcher[] = [];
    private _id: number;
    private static _nextId = 1;

    constructor(ignoreCase: boolean, options: FileSystemOptions = {}) {
        this._id = TestFileSystem._nextId++;
        const { time = -1, files, meta } = options;
        this.ignoreCase = ignoreCase;
        this.stringComparer = this.ignoreCase ? compareStringsCaseInsensitive : compareStringsCaseSensitive;
        this._time = time;

        if (meta) {
            for (const key of Object.keys(meta)) {
                this.meta.set(key, meta[key]);
            }
        }

        if (files) {
            this._applyFiles(files, /* dirname */ '');
        }

        let cwd = options.cwd;
        if ((!cwd || !pathUtil.isDiskPathRoot(cwd)) && this._lazy.links) {
            const iterator = getIterator(this._lazy.links.keys());
            try {
                for (let i = nextResult(iterator); i; i = nextResult(iterator)) {
                    const name = i.value;
                    cwd = cwd ? pathUtil.resolvePaths(name, cwd) : name;
                    break;
                }
            } finally {
                closeIterator(iterator);
            }
        }

        if (cwd) {
            validate(cwd, ValidationFlags.Absolute);
            this.mkdirpSync(cwd);
        }

        this._cwd = cwd || '';
    }

    /**
     * Gets metadata for this `FileSystem`.
     */
    get meta(): Metadata {
        if (!this._lazy.meta) {
            this._lazy.meta = new Metadata(this._shadowRoot ? this._shadowRoot.meta : undefined);
        }
        return this._lazy.meta;
    }

    /**
     * Gets a value indicating whether the file system is read-only.
     */
    get isReadonly() {
        return Object.isFrozen(this);
    }

    /**
     * Gets the file system shadowed by this file system.
     */
    get shadowRoot() {
        return this._shadowRoot;
    }

    get fileWatchers() {
        return this._watchers;
    }

    /**
     * Makes the file system read-only.
     */
    makeReadonly() {
        Object.freeze(this);
        return this;
    }

    /**
     * Snapshots the current file system, effectively shadowing itself. This is useful for
     * generating file system patches using `.diff()` from one snapshot to the next. Performs
     * no action if this file system is read-only.
     */
    snapshot() {
        if (this.isReadonly) {
            return;
        }
        const fs = new TestFileSystem(this.ignoreCase, { time: this._time });
        fs._lazy = this._lazy;
        fs._cwd = this._cwd;
        fs._time = this._time;
        fs._shadowRoot = this._shadowRoot;
        fs._dirStack = this._dirStack;
        fs.makeReadonly();
        this._lazy = {};
        this._shadowRoot = fs;
    }

    /**
     * Gets a shadow copy of this file system. Changes to the shadow copy do not affect the
     * original, allowing multiple copies of the same core file system without multiple copies
     * of the same data.
     */
    shadow(ignoreCase = this.ignoreCase) {
        if (!this.isReadonly) {
            throw new Error('Cannot shadow a mutable file system.');
        }
        if (ignoreCase && !this.ignoreCase) {
            throw new Error('Cannot create a case-insensitive file system from a case-sensitive one.');
        }
        const fs = new TestFileSystem(ignoreCase, { time: this._time });
        fs._shadowRoot = this;
        fs._cwd = this._cwd;
        return fs;
    }

    /**
     * Gets or sets the timestamp (in milliseconds) used for file status, returning the previous timestamp.
     *
     * @link http://pubs.opengroup.org/onlinepubs/9699919799/functions/time.html
     */
    time(value?: number | Date | (() => number | Date)): number {
        if (value !== undefined && this.isReadonly) {
            throw createIOError('EPERM');
        }
        let result = this._time;
        if (typeof result === 'function') {
            result = result();
        }
        if (typeof result === 'object') {
            result = result.getTime();
        }
        if (result === -1) {
            result = Date.now();
        }
        if (value !== undefined) {
            this._time = value;
        }
        return result;
    }

    /**
     * Gets the metadata object for a path.
     * @param path
     */
    filemeta(path: string): Metadata {
        const { node } = this._walk(this._resolve(path));
        if (!node) {
            throw createIOError('ENOENT');
        }
        return this._filemeta(node);
    }

    /**
     * Get the pathname of the current working directory.
     *
     * @link - http://pubs.opengroup.org/onlinepubs/9699919799/functions/getcwd.html
     */
    cwd() {
        if (!this._cwd) {
            throw new Error('The current working directory has not been set.');
        }
        const { node } = this._walk(this._cwd);
        if (!node) {
            throw createIOError('ENOENT');
        }
        if (!isDirectory(node)) {
            throw createIOError('ENOTDIR');
        }
        return this._cwd;
    }

    /**
     * Changes the current working directory.
     *
     * @link http://pubs.opengroup.org/onlinepubs/9699919799/functions/chdir.html
     */
    chdir(uri: Uri) {
        let path = uri.getFilePath();
        if (this.isReadonly) {
            throw createIOError('EPERM');
        }
        path = this._resolve(path);
        const { node } = this._walk(path);
        if (!node) {
            throw createIOError('ENOENT');
        }
        if (!isDirectory(node)) {
            throw createIOError('ENOTDIR');
        }
        this._cwd = path;
    }

    /**
     * Pushes the current directory onto the directory stack and changes the current working directory to the supplied path.
     */
    pushd(path?: string) {
        if (this.isReadonly) {
            throw createIOError('EPERM');
        }
        if (path) {
            path = this._resolve(path);
        }
        if (this._cwd) {
            if (!this._dirStack) {
                this._dirStack = [];
            }
            this._dirStack.push(this._cwd);
        }
        if (path && path !== this._cwd) {
            this.chdir(Uri.file(path, this));
        }
    }

    /**
     * Pops the previous directory from the location stack and changes the current directory to that directory.
     */
    popd() {
        if (this.isReadonly) {
            throw createIOError('EPERM');
        }
        const path = this._dirStack && this._dirStack.pop();
        if (path) {
            this.chdir(Uri.file(path, this));
        }
    }

    /**
     * Update the file system with a set of files.
     */
    apply(files: FileSet) {
        this._applyFiles(files, this._cwd);
    }

    /**
     * Scan file system entries along a path. If `path` is a symbolic link, it is dereferenced.
     * @param path The path at which to start the scan.
     * @param axis The axis along which to traverse.
     * @param traversal The traversal scheme to use.
     */
    scanSync(path: string, axis: Axis, traversal: Traversal) {
        path = this._resolve(path);
        const results: string[] = [];
        this._scan(path, this._stat(this._walk(path)), axis, traversal, /* noFollow */ false, results);
        return results;
    }

    /**
     * Scan file system entries along a path.
     * @param path The path at which to start the scan.
     * @param axis The axis along which to traverse.
     * @param traversal The traversal scheme to use.
     */
    lscanSync(path: string, axis: Axis, traversal: Traversal) {
        path = this._resolve(path);
        const results: string[] = [];
        this._scan(
            path,
            this._stat(this._walk(path, /* noFollow */ true)),
            axis,
            traversal,
            /* noFollow */ true,
            results
        );
        return results;
    }

    createFileSystemWatcher(paths: Uri[], listener: FileWatcherEventHandler): FileWatcher {
        const watcher = new TestFileSystemWatcher(paths, listener);
        this._watchers.push(watcher);
        return watcher;
    }

    fireFileWatcherEvent(path: string, event: FileWatcherEventType) {
        const uri = Uri.file(path, this);
        for (const watcher of this._watchers) {
            if (watcher.fireFileChange(uri, event)) {
                break;
            }
        }
    }

    getModulePath(): Uri {
        return Uri.file(MODULE_PATH, this);
    }

    isCaseSensitive(uri: string) {
        if (uri.startsWith(FileUriSchema)) {
            return !this.ignoreCase;
        }

        return true;
    }

    isLocalFileSystemCaseSensitive(): boolean {
        return !this.ignoreCase;
    }

    tmpdir(): Uri {
        this.mkdirpSync('/tmp');
        return Uri.parse('file:///tmp', this);
    }

    tmpfile(options?: TmpfileOptions): Uri {
        // Use an algorithm similar to tmp's.
        const prefix = options?.prefix || 'tmp';
        const postfix = options?.prefix ? '-' + options.prefix : '';
        const name = `${prefix}-${this._tmpfileCounter++}${postfix}`;
        const path = this.tmpdir().combinePaths(name);
        this.writeFileSync(path, '');
        return path;
    }

    realCasePath(path: Uri): Uri {
        return path;
    }

    isMappedUri(filepath: Uri): boolean {
        return false;
    }

    // Get original filepath if the given filepath is mapped.
    getOriginalUri(mappedFilePath: Uri) {
        return mappedFilePath;
    }

    // Get mapped filepath if the given filepath is mapped.
    getMappedUri(originalFilepath: Uri) {
        return originalFilepath;
    }

    /**
     * Mounts a physical or virtual file system at a location in this virtual file system.
     *
     * @param source The path in the physical (or other virtual) file system.
     * @param target The path in this virtual file system.
     * @param resolver An object used to resolve files in `source`.
     */
    mountSync(source: string, target: string, resolver: FileSystemResolver) {
        if (this.isReadonly) {
            throw createIOError('EROFS');
        }

        source = validate(source, ValidationFlags.Absolute);

        const { parent, links, node: existingNode, basename } = this._walk(this._resolve(target), /* noFollow */ true);
        if (existingNode) {
            throw createIOError('EEXIST');
        }

        const time = this.time();
        const node = this._mknod(parent ? parent.dev : ++devCount, S_IFDIR, /* mode */ 0o777, time);
        node.source = source;
        node.resolver = resolver;
        this._addLink(parent, links, basename, node, time);
    }

    /**
     * Recursively remove all files and directories underneath the provided path.
     */
    rimrafSync(path: string) {
        try {
            const stats = this.lstatSync(path);
            if (stats.isFile() || stats.isSymbolicLink()) {
                this.unlinkSync(Uri.file(path, this));
            } else if (stats.isDirectory()) {
                for (const file of this.readdirSync(Uri.file(path, this))) {
                    this.rimrafSync(pathUtil.combinePaths(path, file));
                }
                this.rmdirSync(Uri.file(path, this));
            }
        } catch (e: any) {
            if (e.code === 'ENOENT') {
                return;
            }
            throw e;
        }
    }

    /**
     * Make a directory and all of its parent paths (if they don't exist).
     */
    mkdirpSync(path: string) {
        path = this._resolve(path);
        const result = this._walk(path, /* noFollow */ true, (error, result) => {
            if (error.code === 'ENOENT') {
                this._mkdir(result);
                return 'retry';
            }
            return 'throw';
        });

        if (!result.node) {
            this._mkdir(result);
        }
    }

    getFileListing(filter?: (p: string) => boolean): string {
        let result = '';

        const addToResult = (path: string, add: string) => {
            if (!filter || filter(path)) {
                result += add;
            }
        };

        const printLinks = (dirname: string | undefined, links: SortedMap<string, Inode>) => {
            const iterator = getIterator(links);
            try {
                for (let i = nextResult(iterator); i; i = nextResult(iterator)) {
                    const [name, node] = i.value;
                    const path = dirname ? pathUtil.combinePaths(dirname, name) : name;
                    const marker = this.stringComparer(this._cwd, path) === 0 ? '*' : ' ';
                    if (result) {
                        addToResult(path, '\n');
                    }
                    addToResult(path, marker);
                    if (isDirectory(node)) {
                        addToResult(path, pathUtil.ensureTrailingDirectorySeparator(path));
                        printLinks(path, this._getLinks(node));
                    } else if (isFile(node)) {
                        addToResult(path, path);
                    } else if (isSymlink(node)) {
                        addToResult(path, `${path} -> ${node.symlink}`);
                    }
                }
            } finally {
                closeIterator(iterator);
            }
        };
        printLinks(/* dirname */ undefined, this._getRootLinks());
        return result;
    }

    /**
     * Print diagnostic information about the structure of the file system to the console.
     */
    debugPrint(filter?: (p: string) => boolean): void {
        console.log(this.getFileListing(filter));
    }

    // POSIX API (aligns with NodeJS "fs" module API)

    /**
     * Determines whether a path exists.
     */
    existsSync(path: Uri) {
        if (path.isEmpty()) {
            return false;
        }
        const result = this._walk(this._resolve(path.getFilePath()), /* noFollow */ true, () => 'stop');
        return result !== undefined && result.node !== undefined;
    }

    /**
     * Get file status. If `path` is a symbolic link, it is dereferenced.
     *
     * @link http://pubs.opengroup.org/onlinepubs/9699919799/functions/stat.html
     *
     * NOTE: do not rename this method as it is intended to align with the same named export of the "fs" module.
     */
    statSync(path: Uri) {
        return this._stat(this._walk(this._resolve(path.getFilePath())));
    }

    /**
     * Change file access times
     *
     * NOTE: do not rename this method as it is intended to align with the same named export of the "fs" module.
     */
    utimesSync(path: string, atime: Date, mtime: Date) {
        if (this.isReadonly) {
            throw createIOError('EROFS');
        }
        if (!isFinite(+atime) || !isFinite(+mtime)) {
            throw createIOError('EINVAL');
        }

        const entry = this._walk(this._resolve(path));
        if (!entry || !entry.node) {
            throw createIOError('ENOENT');
        }
        entry.node.atimeMs = +atime;
        entry.node.mtimeMs = +mtime;
        entry.node.ctimeMs = this.time();
    }

    /**
     * Get file status. If `path` is a symbolic link, it is dereferenced.
     *
     * @link http://pubs.opengroup.org/onlinepubs/9699919799/functions/lstat.html
     *
     * NOTE: do not rename this method as it is intended to align with the same named export of the "fs" module.
     */
    lstatSync(path: string) {
        return this._stat(this._walk(this._resolve(path), /* noFollow */ true));
    }

    /**
     * Read a directory. If `path` is a symbolic link, it is dereferenced.
     *
     * @link http://pubs.opengroup.org/onlinepubs/9699919799/functions/readdir.html
     *
     * NOTE: do not rename this method as it is intended to align with the same named export of the "fs" module.
     */
    readdirSync(path: Uri) {
        const { node } = this._walk(this._resolve(path.getFilePath()));
        if (!node) {
            throw createIOError('ENOENT');
        }
        if (!isDirectory(node)) {
            throw createIOError('ENOTDIR');
        }
        return Array.from(this._getLinks(node).keys());
    }

    /**
     * Read a directory. If `path` is a symbolic link, it is dereferenced.
     *
     * @link http://pubs.opengroup.org/onlinepubs/9699919799/functions/readdir.html
     *
     * NOTE: do not rename this method as it is intended to align with the same named export of the "fs" module.
     */
    readdirEntriesSync(path: Uri): Dirent[] {
        const pathStr = this._resolve(path.getFilePath());
        const { node } = this._walk(this._resolve(pathStr));
        if (!node) {
            throw createIOError('ENOENT');
        }
        if (!isDirectory(node)) {
            throw createIOError('ENOTDIR');
        }
        const entries = Array.from(this._getLinks(node).entries());
        return entries.map(([k, v]) => makeDirEnt(k, v, pathStr));
    }

    /**
     * Make a directory.
     *
     * @link http://pubs.opengroup.org/onlinepubs/9699919799/functions/mkdir.html
     *
     * NOTE: do not rename this method as it is intended to align with the same named export of the "fs" module.
     */
    mkdirSync(path: Uri, options?: MkDirOptions) {
        if (this.isReadonly) {
            throw createIOError('EROFS');
        }

        if (options?.recursive) {
            this.mkdirpSync(path.getFilePath());
            return;
        }

        this._mkdir(this._walk(this._resolve(path.getFilePath()), /* noFollow */ true));
    }

    /**
     * Remove a directory.
     *
     * @link http://pubs.opengroup.org/onlinepubs/9699919799/functions/rmdir.html
     *
     * NOTE: do not rename this method as it is intended to align with the same named export of the "fs" module.
     */
    rmdirSync(uri: Uri) {
        if (this.isReadonly) {
            throw createIOError('EROFS');
        }
        const path = this._resolve(uri.getFilePath());

        const { parent, links, node, basename } = this._walk(path, /* noFollow */ true);
        if (!parent) {
            throw createIOError('EPERM');
        }
        if (!isDirectory(node)) {
            throw createIOError('ENOTDIR');
        }
        if (this._getLinks(node).size !== 0) {
            throw createIOError('ENOTEMPTY');
        }

        this._removeLink(parent, links, basename, node);
    }

    /**
     * Link one file to another file (also known as a "hard link").
     *
     * @link http://pubs.opengroup.org/onlinepubs/9699919799/functions/link.html
     *
     * NOTE: do not rename this method as it is intended to align with the same named export of the "fs" module.
     */
    linkSync(oldpath: string, newpath: string) {
        if (this.isReadonly) {
            throw createIOError('EROFS');
        }

        const { node } = this._walk(this._resolve(oldpath));
        if (!node) {
            throw createIOError('ENOENT');
        }
        if (isDirectory(node)) {
            throw createIOError('EPERM');
        }

        const { parent, links, basename, node: existingNode } = this._walk(this._resolve(newpath), /* noFollow */ true);
        if (!parent) {
            throw createIOError('EPERM');
        }
        if (existingNode) {
            throw createIOError('EEXIST');
        }

        this._addLink(parent, links, basename, node);
    }

    /**
     * Remove a directory entry.
     *
     * @link http://pubs.opengroup.org/onlinepubs/9699919799/functions/unlink.html
     *
     * NOTE: do not rename this method as it is intended to align with the same named export of the "fs" module.
     */
    unlinkSync(path: Uri) {
        if (this.isReadonly) {
            throw createIOError('EROFS');
        }

        const { parent, links, node, basename } = this._walk(this._resolve(path.getFilePath()), /* noFollow */ true);
        if (!parent) {
            throw createIOError('EPERM');
        }
        if (!node) {
            throw createIOError('ENOENT');
        }
        if (isDirectory(node)) {
            throw createIOError('EISDIR');
        }

        this._removeLink(parent, links, basename, node);
    }

    /**
     * Rename a file.
     *
     * @link http://pubs.opengroup.org/onlinepubs/9699919799/functions/rename.html
     *
     * NOTE: do not rename this method as it is intended to align with the same named export of the "fs" module.
     */
    renameSync(oldpath: string, newpath: string) {
        if (this.isReadonly) {
            throw createIOError('EROFS');
        }

        const {
            parent: oldParent,
            links: oldParentLinks,
            node,
            basename: oldBasename,
        } = this._walk(this._resolve(oldpath), /* noFollow */ true);

        if (!oldParent) {
            throw createIOError('EPERM');
        }
        if (!node) {
            throw createIOError('ENOENT');
        }

        const {
            parent: newParent,
            links: newParentLinks,
            node: existingNode,
            basename: newBasename,
        } = this._walk(this._resolve(newpath), /* noFollow */ true);

        if (!newParent) {
            throw createIOError('EPERM');
        }

        const time = this.time();
        if (existingNode) {
            if (isDirectory(node)) {
                if (!isDirectory(existingNode)) {
                    throw createIOError('ENOTDIR');
                }
                if (this._getLinks(existingNode).size > 0) {
                    throw createIOError('ENOTEMPTY');
                }
            } else {
                if (isDirectory(existingNode)) {
                    throw createIOError('EISDIR');
                }
            }
            this._removeLink(newParent, newParentLinks, newBasename, existingNode, time);
        }

        this._replaceLink(oldParent, oldParentLinks, oldBasename, newParent, newParentLinks, newBasename, node, time);
    }

    /**
     * Make a symbolic link.
     *
     * @link http://pubs.opengroup.org/onlinepubs/9699919799/functions/symlink.html
     *
     * NOTE: do not rename this method as it is intended to align with the same named export of the "fs" module.
     */
    symlinkSync(target: string, linkpath: string) {
        if (this.isReadonly) {
            throw createIOError('EROFS');
        }

        const {
            parent,
            links,
            node: existingNode,
            basename,
        } = this._walk(this._resolve(linkpath), /* noFollow */ true);
        if (!parent) {
            throw createIOError('EPERM');
        }
        if (existingNode) {
            throw createIOError('EEXIST');
        }

        const time = this.time();
        const node = this._mknod(parent.dev, S_IFLNK, /* mode */ 0o666, time);
        node.symlink = validate(target, ValidationFlags.RelativeOrAbsolute);
        this._addLink(parent, links, basename, node, time);
    }

    /**
     * Resolve a pathname.
     *
     * @link http://pubs.opengroup.org/onlinepubs/9699919799/functions/realpath.html
     *
     * NOTE: do not rename this method as it is intended to align with the same named export of the "fs" module.
     */
    realpathSync(path: Uri) {
        try {
            const { realpath } = this._walk(this._resolve(path.getFilePath()));
            return Uri.file(realpath, this);
        } catch (e: any) {
            return path;
        }
    }

    /**
     * Read from a file.
     *
     * NOTE: do not rename this method as it is intended to align with the same named export of the "fs" module.
     */
    readFileSync(path: Uri, encoding?: null): Buffer;
    /**
     * Read from a file.
     *
     * NOTE: do not rename this method as it is intended to align with the same named export of the "fs" module.
     */
    readFileSync(path: Uri, encoding: BufferEncoding): string;
    /**
     * Read from a file.
     *
     * NOTE: do not rename this method as it is intended to align with the same named export of the "fs" module.
     */
    readFileSync(path: Uri, encoding?: BufferEncoding | null): string | Buffer;
    readFileSync(path: Uri, encoding: BufferEncoding | null = null) {
        const { node } = this._walk(this._resolve(path.getFilePath()));
        if (!node) {
            throw createIOError('ENOENT');
        }
        if (isDirectory(node)) {
            throw createIOError('EISDIR');
        }
        if (!isFile(node)) {
            throw createIOError('EBADF');
        }

        const buffer = this._getBuffer(node).slice();
        return encoding ? buffer.toString(encoding) : buffer;
    }

    /**
     * Write to a file.
     *
     * NOTE: do not rename this method as it is intended to align with the same named export of the "fs" module.
     */
    writeFileSync(uri: Uri, data: string | Buffer, encoding: BufferEncoding | null = null) {
        if (this.isReadonly) {
            throw createIOError('EROFS');
        }

        const {
            parent,
            links,
            node: existingNode,
            basename,
        } = this._walk(this._resolve(uri.getFilePath()), /* noFollow */ false);
        if (!parent) {
            throw createIOError('EPERM');
        }

        const time = this.time();
        let node = existingNode;
        if (!node) {
            node = this._mknod(parent.dev, S_IFREG, 0o666, time);
            this._addLink(parent, links, basename, node, time);
        }

        if (isDirectory(node)) {
            throw createIOError('EISDIR');
        }
        if (!isFile(node)) {
            throw createIOError('EBADF');
        }
        node.buffer = Buffer.isBuffer(data)
            ? data.slice()
            : bufferFrom('' + data, (encoding as BufferEncoding) || 'utf8');
        node.size = node.buffer.byteLength;
        node.mtimeMs = time;
        node.ctimeMs = time;
    }

    readFile(fileUri: Uri): Promise<Buffer> {
        return Promise.resolve(this.readFileSync(fileUri));
    }
    readFileText(fileUri: Uri, encoding?: BufferEncoding): Promise<string> {
        return Promise.resolve(this.readFileSync(fileUri, encoding || 'utf8'));
    }

    createReadStream(path: Uri): ReadStream {
        throw new Error('Not implemented in test file system.');
    }
    createWriteStream(path: Uri): WriteStream {
        throw new Error('Not implemented in test file system.');
    }

    copyFileSync(src: Uri, dst: Uri): void {
        throw new Error('Not implemented in test file system.');
    }

    mapDirectory(mappedUri: Uri, originalUri: Uri, filter?: (originalUri: Uri, fs: FileSystem) => boolean): Disposable {
        throw new Error('Not implemented in test file system.');
    }

    /**
     * Generates a `FileSet` patch containing all the entries in this `FileSystem` that are not in `base`.
     * @param base The base file system. If not provided, this file system's `shadowRoot` is used (if present).
     */
    diff(base = this.shadowRoot, options: DiffOptions = {}) {
        const differences: FileSet = {};
        const hasDifferences = base
            ? TestFileSystem._rootDiff(differences, this, base, options)
            : TestFileSystem._trackCreatedInodes(differences, this, this._getRootLinks());
        return hasDifferences ? differences : undefined;
    }

    /**
     * Generates a `FileSet` patch containing all the entries in `changed` that are not in `base`.
     */
    static diff(changed: TestFileSystem, base: TestFileSystem, options: DiffOptions = {}) {
        const differences: FileSet = {};
        return TestFileSystem._rootDiff(differences, changed, base, options) ? differences : undefined;
    }

    isInZip(path: Uri): boolean {
        return false;
    }

    dispose(): void {
        // Do Nothing
    }

    private _mkdir({ parent, links, node: existingNode, basename }: WalkResult) {
        if (existingNode) {
            throw createIOError('EEXIST');
        }
        const time = this.time();
        const node = this._mknod(parent ? parent.dev : ++devCount, S_IFDIR, /* mode */ 0o777, time);
        this._addLink(parent, links, basename, node, time);
    }

    private _filemeta(node: Inode): Metadata {
        if (!node.meta) {
            const parentMeta = node.shadowRoot && this._shadowRoot && this._shadowRoot._filemeta(node.shadowRoot);
            node.meta = new Metadata(parentMeta);
        }
        return node.meta;
    }

    private _scan(path: string, stats: Stats, axis: Axis, traversal: Traversal, noFollow: boolean, results: string[]) {
        if (axis === 'ancestors-or-self' || axis === 'self' || axis === 'descendants-or-self') {
            if (!traversal.accept || traversal.accept(path, stats)) {
                results.push(path);
            }
        }
        if (axis === 'ancestors-or-self' || axis === 'ancestors') {
            const dirname = pathUtil.getDirectoryPath(path);
            if (dirname !== path) {
                try {
                    const stats = this._stat(this._walk(dirname, noFollow));
                    if (!traversal.traverse || traversal.traverse(dirname, stats)) {
                        this._scan(dirname, stats, 'ancestors-or-self', traversal, noFollow, results);
                    }
                } catch {
                    /* ignored */
                }
            }
        }
        if (axis === 'descendants-or-self' || axis === 'descendants') {
            if (stats.isDirectory() && (!traversal.traverse || traversal.traverse(path, stats))) {
                for (const file of this.readdirSync(Uri.file(path, this))) {
                    try {
                        const childpath = pathUtil.combinePaths(path, file);
                        const stats = this._stat(this._walk(childpath, noFollow));
                        this._scan(childpath, stats, 'descendants-or-self', traversal, noFollow, results);
                    } catch {
                        /* ignored */
                    }
                }
            }
        }
    }

    private _stat(entry: WalkResult) {
        const node = entry.node;
        if (!node) {
            throw createIOError(`ENOENT`, entry.realpath);
        }
        return new Stats(
            node.dev,
            node.ino,
            node.mode,
            node.nlink,
            /* rdev */ 0,
            /* size */ isFile(node) ? this._getSize(node) : isSymlink(node) ? node.symlink.length : 0,
            /* blksize */ 4096,
            /* blocks */ 0,
            node.atimeMs,
            node.mtimeMs,
            node.ctimeMs,
            node.birthtimeMs
        );
    }

    private static _diffWorker(
        container: FileSet,
        changed: TestFileSystem,
        changedLinks: ReadonlyMap<string, Inode> | undefined,
        base: TestFileSystem,
        baseLinks: ReadonlyMap<string, Inode> | undefined,
        options: DiffOptions
    ) {
        if (changedLinks && !baseLinks) {
            return TestFileSystem._trackCreatedInodes(container, changed, changedLinks);
        }
        if (baseLinks && !changedLinks) {
            return TestFileSystem._trackDeletedInodes(container, baseLinks);
        }
        if (changedLinks && baseLinks) {
            let hasChanges = false;
            // track base items missing in changed
            baseLinks.forEach((node, basename) => {
                if (!changedLinks.has(basename)) {
                    container[basename] = isDirectory(node) ? new Rmdir() : new Unlink();
                    hasChanges = true;
                }
            });
            // track changed items missing or differing in base
            changedLinks.forEach((changedNode, basename) => {
                const baseNode = baseLinks.get(basename);
                if (baseNode) {
                    if (isDirectory(changedNode) && isDirectory(baseNode)) {
                        return (hasChanges =
                            TestFileSystem._directoryDiff(
                                container,
                                basename,
                                changed,
                                changedNode,
                                base,
                                baseNode,
                                options
                            ) || hasChanges);
                    }
                    if (isFile(changedNode) && isFile(baseNode)) {
                        return (hasChanges =
                            TestFileSystem._fileDiff(
                                container,
                                basename,
                                changed,
                                changedNode,
                                base,
                                baseNode,
                                options
                            ) || hasChanges);
                    }
                    if (isSymlink(changedNode) && isSymlink(baseNode)) {
                        return (hasChanges =
                            TestFileSystem._symlinkDiff(container, basename, changedNode, baseNode) || hasChanges);
                    }
                }
                return (hasChanges =
                    TestFileSystem._trackCreatedInode(container, basename, changed, changedNode) || hasChanges);
            });
            return hasChanges;
        }
        return false;
    }

    private static _rootDiff(container: FileSet, changed: TestFileSystem, base: TestFileSystem, options: DiffOptions) {
        while (!changed._lazy.links && changed._shadowRoot) {
            changed = changed._shadowRoot;
        }
        while (!base._lazy.links && base._shadowRoot) {
            base = base._shadowRoot;
        }

        // no difference if the file systems are the same reference
        if (changed === base) {
            return false;
        }

        // no difference if the root links are empty and not shadowed
        if (!changed._lazy.links && !changed._shadowRoot && !base._lazy.links && !base._shadowRoot) {
            return false;
        }

        return TestFileSystem._diffWorker(
            container,
            changed,
            changed._getRootLinks(),
            base,
            base._getRootLinks(),
            options
        );
    }

    private static _directoryDiff(
        container: FileSet,
        basename: string,
        changed: TestFileSystem,
        changedNode: DirectoryInode,
        base: TestFileSystem,
        baseNode: DirectoryInode,
        options: DiffOptions
    ) {
        while (!changedNode.links && changedNode.shadowRoot) {
            changedNode = changedNode.shadowRoot;
        }
        while (!baseNode.links && baseNode.shadowRoot) {
            baseNode = baseNode.shadowRoot;
        }

        // no difference if the nodes are the same reference
        if (changedNode === baseNode) {
            return false;
        }

        // no difference if both nodes are non shadowed and have no entries
        if (isEmptyNonShadowedDirectory(changedNode) && isEmptyNonShadowedDirectory(baseNode)) {
            return false;
        }

        // no difference if both nodes are unpopulated and point to the same mounted file system
        if (
            !changedNode.links &&
            !baseNode.links &&
            changedNode.resolver &&
            changedNode.source !== undefined &&
            baseNode.resolver === changedNode.resolver &&
            baseNode.source === changedNode.source
        ) {
            return false;
        }

        // no difference if both nodes have identical children
        const children: FileSet = {};
        if (
            !TestFileSystem._diffWorker(
                children,
                changed,
                changed._getLinks(changedNode),
                base,
                base._getLinks(baseNode),
                options
            )
        ) {
            return false;
        }

        container[basename] = new Directory(children);
        return true;
    }

    private static _fileDiff(
        container: FileSet,
        basename: string,
        changed: TestFileSystem,
        changedNode: FileInode,
        base: TestFileSystem,
        baseNode: FileInode,
        options: DiffOptions
    ) {
        while (!changedNode.buffer && changedNode.shadowRoot) {
            changedNode = changedNode.shadowRoot;
        }
        while (!baseNode.buffer && baseNode.shadowRoot) {
            baseNode = baseNode.shadowRoot;
        }

        // no difference if the nodes are the same reference
        if (changedNode === baseNode) {
            return false;
        }

        // no difference if both nodes are non shadowed and have no entries
        if (isEmptyNonShadowedFile(changedNode) && isEmptyNonShadowedFile(baseNode)) {
            return false;
        }

        // no difference if both nodes are unpopulated and point to the same mounted file system
        if (
            !changedNode.buffer &&
            !baseNode.buffer &&
            changedNode.resolver &&
            changedNode.source !== undefined &&
            baseNode.resolver === changedNode.resolver &&
            baseNode.source === changedNode.source
        ) {
            return false;
        }

        const changedBuffer = changed._getBuffer(changedNode);
        const baseBuffer = base._getBuffer(baseNode);

        // no difference if both buffers are the same reference
        if (changedBuffer === baseBuffer) {
            return false;
        }

        // no difference if both buffers are identical
        if (Buffer.compare(changedBuffer, baseBuffer) === 0) {
            if (!options.includeChangedFileWithSameContent) {
                return false;
            }
            container[basename] = new SameFileContentFile(changedBuffer);
            return true;
        }

        container[basename] = new File(changedBuffer);
        return true;
    }

    private static _symlinkDiff(
        container: FileSet,
        basename: string,
        changedNode: SymlinkInode,
        baseNode: SymlinkInode
    ) {
        // no difference if the nodes are the same reference
        if (changedNode.symlink === baseNode.symlink) {
            return false;
        }
        container[basename] = new Symlink(changedNode.symlink);
        return true;
    }

    private static _trackCreatedInode(container: FileSet, basename: string, changed: TestFileSystem, node: Inode) {
        if (isDirectory(node)) {
            const children: FileSet = {};
            TestFileSystem._trackCreatedInodes(children, changed, changed._getLinks(node));
            container[basename] = new Directory(children);
        } else if (isSymlink(node)) {
            container[basename] = new Symlink(node.symlink);
        } else {
            container[basename] = new File(node.buffer || '');
        }
        return true;
    }

    private static _trackCreatedInodes(
        container: FileSet,
        changed: TestFileSystem,
        changedLinks: ReadonlyMap<string, Inode>
    ) {
        // no difference if links are empty
        if (!changedLinks.size) {
            return false;
        }

        changedLinks.forEach((node, basename) => {
            TestFileSystem._trackCreatedInode(container, basename, changed, node);
        });
        return true;
    }

    private static _trackDeletedInodes(container: FileSet, baseLinks: ReadonlyMap<string, Inode>) {
        // no difference if links are empty
        if (!baseLinks.size) {
            return false;
        }
        baseLinks.forEach((node, basename) => {
            container[basename] = isDirectory(node) ? new Rmdir() : new Unlink();
        });
        return true;
    }

    private _mknod(dev: number, type: typeof S_IFREG, mode: number, time?: number): FileInode;
    private _mknod(dev: number, type: typeof S_IFDIR, mode: number, time?: number): DirectoryInode;
    private _mknod(dev: number, type: typeof S_IFLNK, mode: number, time?: number): SymlinkInode;
    private _mknod(dev: number, type: number, mode: number, time = this.time()): Inode {
        return {
            dev,
            ino: ++inoCount,
            mode: (mode & ~S_IFMT & ~0o022 & 0o7777) | (type & S_IFMT),
            atimeMs: time,
            mtimeMs: time,
            ctimeMs: time,
            birthtimeMs: time,
            nlink: 0,
        };
    }

    private _addLink(
        parent: DirectoryInode | undefined,
        links: SortedMap<string, Inode>,
        name: string,
        node: Inode,
        time = this.time()
    ) {
        links.set(name, node);
        node.nlink++;
        node.ctimeMs = time;
        if (parent) {
            parent.mtimeMs = time;
        }
        if (!parent && !this._cwd) {
            this._cwd = name;
        }
    }

    private _removeLink(
        parent: DirectoryInode | undefined,
        links: SortedMap<string, Inode>,
        name: string,
        node: Inode,
        time = this.time()
    ) {
        links.delete(name);
        node.nlink--;
        node.ctimeMs = time;
        if (parent) {
            parent.mtimeMs = time;
        }
    }

    private _replaceLink(
        oldParent: DirectoryInode,
        oldLinks: SortedMap<string, Inode>,
        oldName: string,
        newParent: DirectoryInode,
        newLinks: SortedMap<string, Inode>,
        newName: string,
        node: Inode,
        time: number
    ) {
        if (oldParent !== newParent) {
            this._removeLink(oldParent, oldLinks, oldName, node, time);
            this._addLink(newParent, newLinks, newName, node, time);
        } else {
            oldLinks.delete(oldName);
            oldLinks.set(newName, node);
            oldParent.mtimeMs = time;
            newParent.mtimeMs = time;
        }
    }

    private _getRootLinks() {
        if (!this._lazy.links) {
            const links = new SortedMap<string, Inode>(this.stringComparer);
            if (this._shadowRoot) {
                this._copyShadowLinks(this._shadowRoot._getRootLinks(), links);
            }
            this._lazy.links = links;
        }
        return this._lazy.links;
    }

    private _getLinks(node: DirectoryInode) {
        if (!node.links) {
            const links = new SortedMap<string, Inode>(this.stringComparer);
            const { source, resolver } = node;
            if (source && resolver) {
                node.source = undefined;
                node.resolver = undefined;
                for (const name of resolver.readdirSync(source)) {
                    const path = pathUtil.combinePaths(source, name);
                    const stats = resolver.statSync(path);
                    switch (stats.mode & S_IFMT) {
                        case S_IFDIR: {
                            const dir = this._mknod(node.dev, S_IFDIR, 0o777);
                            dir.source = pathUtil.combinePaths(source, name);
                            dir.resolver = resolver;
                            this._addLink(node, links, name, dir);
                            break;
                        }
                        case S_IFREG: {
                            const file = this._mknod(node.dev, S_IFREG, 0o666);
                            file.source = pathUtil.combinePaths(source, name);
                            file.resolver = resolver;
                            file.size = stats.size;
                            this._addLink(node, links, name, file);
                            break;
                        }
                    }
                }
            } else if (this._shadowRoot && node.shadowRoot) {
                this._copyShadowLinks(this._shadowRoot._getLinks(node.shadowRoot), links);
            }
            node.links = links;
        }
        return node.links;
    }

    private _getShadow(root: DirectoryInode): DirectoryInode;
    private _getShadow(root: Inode): Inode;
    private _getShadow(root: Inode) {
        const shadows = this._lazy.shadows || (this._lazy.shadows = new Map<number, Inode>());

        let shadow = shadows.get(root.ino);
        if (!shadow) {
            shadow = {
                dev: root.dev,
                ino: root.ino,
                mode: root.mode,
                atimeMs: root.atimeMs,
                mtimeMs: root.mtimeMs,
                ctimeMs: root.ctimeMs,
                birthtimeMs: root.birthtimeMs,
                nlink: root.nlink,
                shadowRoot: root,
            };

            if (isSymlink(root)) {
                (shadow as SymlinkInode).symlink = root.symlink;
            }
            shadows.set(shadow.ino, shadow);
        }

        return shadow;
    }

    private _copyShadowLinks(source: ReadonlyMap<string, Inode>, target: SortedMap<string, Inode>) {
        const iterator = getIterator(source);
        try {
            for (let i = nextResult(iterator); i; i = nextResult(iterator)) {
                const [name, root] = i.value;
                target.set(name, this._getShadow(root));
            }
        } finally {
            closeIterator(iterator);
        }
    }

    private _getSize(node: FileInode): number {
        if (node.buffer) {
            return node.buffer.byteLength;
        }
        if (node.size !== undefined) {
            return node.size;
        }
        if (node.source && node.resolver) {
            return (node.size = node.resolver.statSync(node.source).size);
        }
        if (this._shadowRoot && node.shadowRoot) {
            return (node.size = this._shadowRoot._getSize(node.shadowRoot));
        }
        return 0;
    }

    private _getBuffer(node: FileInode): Buffer {
        if (!node.buffer) {
            const { source, resolver } = node;
            if (source && resolver) {
                node.source = undefined;
                node.resolver = undefined;
                node.size = undefined;
                node.buffer = resolver.readFileSync(source);
            } else if (this._shadowRoot && node.shadowRoot) {
                node.buffer = this._shadowRoot._getBuffer(node.shadowRoot);
            } else {
                node.buffer = Buffer.allocUnsafe(0);
            }
        }
        return node.buffer;
    }

    /**
     * Walk a path to its end.
     *
     * @param path The path to follow.
     * @param noFollow A value indicating whether to *not* dereference a symbolic link at the
     * end of a path.
     *
     * @link http://man7.org/linux/man-pages/man7/path_resolution.7.html
     */
    private _walk(
        path: string,
        noFollow?: boolean,
        onError?: (error: NodeJS.ErrnoException, fragment: WalkResult) => 'retry' | 'throw'
    ): WalkResult;
    private _walk(
        path: string,
        noFollow?: boolean,
        onError?: (error: NodeJS.ErrnoException, fragment: WalkResult) => 'stop' | 'retry' | 'throw'
    ): WalkResult | undefined;
    private _walk(
        path: string,
        noFollow?: boolean,
        onError?: (error: NodeJS.ErrnoException, fragment: WalkResult) => 'stop' | 'retry' | 'throw'
    ): WalkResult | undefined {
        let links = this._getRootLinks();
        let parent: DirectoryInode | undefined;
        let components = pathUtil.getPathComponents(path);
        let step = 0;
        let depth = 0;
        let retry = false;
        while (true) {
            if (depth >= 40) {
                throw createIOError('ELOOP');
            }
            const lastStep = step === components.length - 1;
            const basename = components[step];
            const node = links.get(basename);
            if (lastStep && (noFollow || !isSymlink(node))) {
                return { realpath: pathUtil.combinePathComponents(components), basename, parent, links, node };
            }
            if (node === undefined) {
                if (trapError(createIOError('ENOENT'), node)) {
                    continue;
                }
                return undefined;
            }
            if (isSymlink(node)) {
                const dirname = pathUtil.combinePathComponents(components.slice(0, step));
                const symlink = pathUtil.resolvePaths(dirname, node.symlink);
                links = this._getRootLinks();
                parent = undefined;
                components = pathUtil.getPathComponents(symlink).concat(components.slice(step + 1));
                step = 0;
                depth++;
                retry = false;
                continue;
            }
            if (isDirectory(node)) {
                links = this._getLinks(node);
                parent = node;
                step++;
                retry = false;
                continue;
            }
            if (trapError(createIOError('ENOTDIR'), node)) {
                continue;
            }
            return undefined;
        }

        function trapError(error: NodeJS.ErrnoException, node?: Inode) {
            const realpath = pathUtil.combinePathComponents(components.slice(0, step + 1));
            const basename = components[step];
            const result = !retry && onError ? onError(error, { realpath, basename, parent, links, node }) : 'throw';
            if (result === 'stop') {
                return false;
            }
            if (result === 'retry') {
                retry = true;
                return true;
            }
            throw error;
        }
    }

    /**
     * Resolve a path relative to the current working directory.
     */
    private _resolve(path: string) {
        return this._cwd
            ? pathUtil.resolvePaths(
                  this._cwd,
                  validate(path, ValidationFlags.RelativeOrAbsolute | ValidationFlags.AllowWildcard)
              )
            : validate(path, ValidationFlags.Absolute | ValidationFlags.AllowWildcard);
    }

    private _applyFiles(files: FileSet, dirname: string) {
        const deferred: [Symlink | Link | Mount, string][] = [];
        this._applyFilesWorker(files, dirname, deferred);
        for (const [entry, path] of deferred) {
            this.mkdirpSync(pathUtil.getDirectoryPath(path));
            this.pushd(pathUtil.getDirectoryPath(path));
            if (entry instanceof Symlink) {
                if (this.stringComparer(pathUtil.getDirectoryPath(path), path) === 0) {
                    throw new TypeError('Roots cannot be symbolic links.');
                }
                this.symlinkSync(pathUtil.resolvePaths(dirname, entry.symlink), path);
                this._applyFileExtendedOptions(path, entry);
            } else if (entry instanceof Link) {
                if (this.stringComparer(pathUtil.getDirectoryPath(path), path) === 0) {
                    throw new TypeError('Roots cannot be hard links.');
                }
                this.linkSync(entry.path, path);
            } else {
                this.mountSync(entry.source, path, entry.resolver);
                this._applyFileExtendedOptions(path, entry);
            }
            this.popd();
        }
    }

    private _applyFileExtendedOptions(path: string, entry: Directory | File | Symlink | Mount) {
        const { meta } = entry;
        if (meta !== undefined) {
            const filemeta = this.filemeta(path);
            for (const key of Object.keys(meta)) {
                filemeta.set(key, meta[key]);
            }
        }
    }

    private _applyFilesWorker(files: FileSet, dirname: string, deferred: [Symlink | Link | Mount, string][]) {
        for (const key of Object.keys(files)) {
            const value = normalizeFileSetEntry(files[key]);
            const path = dirname ? pathUtil.resolvePaths(dirname, key) : key;
            validate(path, ValidationFlags.Absolute);

            if (value === null || value === undefined || value instanceof Rmdir || value instanceof Unlink) {
                if (this.stringComparer(pathUtil.getDirectoryPath(path), path) === 0) {
                    throw new TypeError('Roots cannot be deleted.');
                }
                this.rimrafSync(path);
            } else if (value instanceof File) {
                if (this.stringComparer(pathUtil.getDirectoryPath(path), path) === 0) {
                    throw new TypeError('Roots cannot be files.');
                }
                this.mkdirpSync(pathUtil.getDirectoryPath(path));
                this.writeFileSync(Uri.file(path, this), value.data, value.encoding);
                this._applyFileExtendedOptions(path, value);
            } else if (value instanceof Directory) {
                this.mkdirpSync(path);
                this._applyFileExtendedOptions(path, value);
                this._applyFilesWorker(value.files, path, deferred);
            } else {
                deferred.push([value, path]);
            }
        }
    }
}

export interface FileSystemOptions {
    // Sets the initial timestamp for new files and directories, or the function used
    // to calculate timestamps.
    time?: number | Date | (() => number | Date) | undefined;

    // A set of file system entries to initially add to the file system.
    files?: FileSet | undefined;

    // Sets the initial working directory for the file system.
    cwd?: string | undefined;

    // Sets initial metadata attached to the file system.
    meta?: Record<string, any> | undefined;
}

export type Axis = 'ancestors' | 'ancestors-or-self' | 'self' | 'descendants-or-self' | 'descendants';

export interface Traversal {
    /** A function called to choose whether to continue to traverse to either ancestors or descendants. */
    traverse?(path: string, stats: Stats): boolean;
    /** A function called to choose whether to accept a path as part of the result. */
    accept?(path: string, stats: Stats): boolean;
}

export interface FileSystemResolver {
    statSync(path: string): { mode: number; size: number };
    readdirSync(path: string): string[];
    readFileSync(path: string): Buffer;
}

/**
 * A template used to populate files, directories, links, etc. in a virtual file system.
 */
export interface FileSet {
    [name: string]: DirectoryLike | FileLike | Link | Symlink | Mount | Rmdir | Unlink | null | undefined;
}

export type DirectoryLike = FileSet | Directory;
export type FileLike = File | Buffer | string;

/** Extended options for a directory in a `FileSet` */
export class Directory {
    readonly files: FileSet;
    readonly meta: Record<string, any> | undefined;
    constructor(files: FileSet, { meta }: { meta?: Record<string, any> } = {}) {
        this.files = files;
        this.meta = meta;
    }
}

/** Extended options for a file in a `FileSet` */
export class File {
    readonly data: Buffer | string;
    readonly encoding: BufferEncoding | undefined;
    readonly meta: Record<string, any> | undefined;
    constructor(
        data: Buffer | string,
        { meta, encoding }: { encoding?: BufferEncoding; meta?: Record<string, any> } = {}
    ) {
        this.data = data;
        this.encoding = encoding;
        this.meta = meta;
    }
}

export class SameFileContentFile extends File {
    constructor(data: Buffer | string, metaAndEncoding?: { encoding?: BufferEncoding; meta?: Record<string, any> }) {
        super(data, metaAndEncoding);
    }
}

/** Extended options for a hard link in a `FileSet` */
export class Link {
    readonly path: string;
    constructor(path: string) {
        this.path = path;
    }
}

/** Removes a directory in a `FileSet` */
export class Rmdir {
    ' rmdirBrand'?: never; // brand necessary for proper type guards
}

/** Unlinks a file in a `FileSet` */
export class Unlink {
    ' unlinkBrand'?: never; // brand necessary for proper type guards
}

/** Extended options for a symbolic link in a `FileSet` */
export class Symlink {
    readonly symlink: string;
    readonly meta: Record<string, any> | undefined;
    constructor(symlink: string, { meta }: { meta?: Record<string, any> } = {}) {
        this.symlink = symlink;
        this.meta = meta;
    }
}

// file type
// these should be only used inside of test code. it is export just because mock file system is separated into
// 2 files. this and factory.ts file. actual value doesn't matter
export const S_IFMT = 0o170000; // file type
export const S_IFSOCK = 0o140000; // socket
export const S_IFLNK = 0o120000; // symbolic link
export const S_IFREG = 0o100000; // regular file
export const S_IFBLK = 0o060000; // block device
export const S_IFDIR = 0o040000; // directory
export const S_IFCHR = 0o020000; // character device
export const S_IFIFO = 0o010000; // FIFO

/** Extended options for mounting a virtual copy of an external file system via a `FileSet` */
export class Mount {
    readonly source: string;
    readonly resolver: FileSystemResolver;
    readonly meta: Record<string, any> | undefined;
    constructor(source: string, resolver: FileSystemResolver, { meta }: { meta?: Record<string, any> } = {}) {
        this.source = source;
        this.resolver = resolver;
        this.meta = meta;
    }
}

// a generic POSIX inode
type Inode = FileInode | DirectoryInode | SymlinkInode;

interface FileInode {
    dev: number; // device id
    ino: number; // inode id
    mode: number; // file mode
    atimeMs: number; // access time
    mtimeMs: number; // modified time
    ctimeMs: number; // status change time
    birthtimeMs: number; // creation time
    nlink: number; // number of hard links
    size?: number | undefined;
    buffer?: Buffer | undefined;
    source?: string | undefined;
    resolver?: FileSystemResolver | undefined;
    shadowRoot?: FileInode | undefined;
    meta?: Metadata | undefined;
}

interface DirectoryInode {
    dev: number; // device id
    ino: number; // inode id
    mode: number; // file mode
    atimeMs: number; // access time
    mtimeMs: number; // modified time
    ctimeMs: number; // status change time
    birthtimeMs: number; // creation time
    nlink: number; // number of hard links
    links?: SortedMap<string, Inode> | undefined;
    source?: string | undefined;
    resolver?: FileSystemResolver | undefined;
    shadowRoot?: DirectoryInode | undefined;
    meta?: Metadata | undefined;
}

interface SymlinkInode {
    dev: number; // device id
    ino: number; // inode id
    mode: number; // file mode
    atimeMs: number; // access time
    mtimeMs: number; // modified time
    ctimeMs: number; // status change time
    birthtimeMs: number; // creation time
    nlink: number; // number of hard links
    symlink: string;
    shadowRoot?: SymlinkInode | undefined;
    meta?: Metadata | undefined;
}

function isEmptyNonShadowedDirectory(node: DirectoryInode) {
    return !node.links && !node.shadowRoot && !node.resolver && !node.source;
}

function isEmptyNonShadowedFile(node: FileInode) {
    return !node.buffer && !node.shadowRoot && !node.resolver && !node.source;
}

function isFile(node: Inode | undefined): node is FileInode {
    return node !== undefined && (node.mode & S_IFMT) === S_IFREG;
}

function isDirectory(node: Inode | undefined): node is DirectoryInode {
    return node !== undefined && (node.mode & S_IFMT) === S_IFDIR;
}

function isSymlink(node: Inode | undefined): node is SymlinkInode {
    return node !== undefined && (node.mode & S_IFMT) === S_IFLNK;
}

interface WalkResult {
    realpath: string;
    basename: string;
    parent: DirectoryInode | undefined;
    links: SortedMap<string, Inode>;
    node: Inode | undefined;
}

function normalizeFileSetEntry(value: FileSet[string]) {
    if (
        value === undefined ||
        value === null ||
        value instanceof Directory ||
        value instanceof File ||
        value instanceof Link ||
        value instanceof Symlink ||
        value instanceof Mount ||
        value instanceof Rmdir ||
        value instanceof Unlink
    ) {
        return value;
    }
    return typeof value === 'string' || Buffer.isBuffer(value) ? new File(value) : new Directory(value);
}

export function formatPatch(patch: FileSet): string;
export function formatPatch(patch: FileSet | undefined): string | null;
export function formatPatch(patch: FileSet | undefined) {
    return patch ? formatPatchWorker('', patch) : null;
}

function formatPatchWorker(dirname: string, container: FileSet): string {
    let text = '';
    for (const name of Object.keys(container)) {
        const entry = normalizeFileSetEntry(container[name]);
        const file = dirname ? pathUtil.combinePaths(dirname, name) : name;
        if (entry === null || entry === undefined || entry instanceof Unlink) {
            text += `//// [${file}] unlink\r\n`;
        } else if (entry instanceof Rmdir) {
            text += `//// [${pathUtil.ensureTrailingDirectorySeparator(file)}] rmdir\r\n`;
        } else if (entry instanceof Directory) {
            text += formatPatchWorker(file, entry.files);
        } else if (entry instanceof SameFileContentFile) {
            text += `//// [${file}] file written with same contents\r\n`;
        } else if (entry instanceof File) {
            const content = typeof entry.data === 'string' ? entry.data : entry.data.toString('utf8');
            text += `//// [${file}]\r\n${content}\r\n\r\n`;
        } else if (entry instanceof Link) {
            text += `//// [${file}] link(${entry.path})\r\n`;
        } else if (entry instanceof Symlink) {
            text += `//// [${file}] symlink(${entry.symlink})\r\n`;
        } else if (entry instanceof Mount) {
            text += `//// [${file}] mount(${entry.source})\r\n`;
        }
    }
    return text;
}

function makeDirEnt(name: string, node: Inode, parentDir: string): Dirent {
    const de: Dirent = {
        isFile: () => isFile(node),
        isDirectory: () => isDirectory(node),
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isFIFO: () => false,
        isSocket: () => false,
        isSymbolicLink: () => isSymlink(node),
        name,
        parentPath: parentDir,
        get path() {
            return this.parentPath;
        },
    };
    return de;
}

class Stats {
    dev: number;
    ino: number;
    mode: number;
    nlink: number;
    uid: number;
    gid: number;
    rdev: number;
    size: number;
    blksize: number;
    blocks: number;
    atimeMs: number;
    mtimeMs: number;
    ctimeMs: number;
    birthtimeMs: number;
    atime: Date;
    mtime: Date;
    ctime: Date;
    birthtime: Date;

    constructor();
    constructor(
        dev: number,
        ino: number,
        mode: number,
        nlink: number,
        rdev: number,
        size: number,
        blksize: number,
        blocks: number,
        atimeMs: number,
        mtimeMs: number,
        ctimeMs: number,
        birthtimeMs: number
    );
    constructor(
        dev = 0,
        ino = 0,
        mode = 0,
        nlink = 0,
        rdev = 0,
        size = 0,
        blksize = 0,
        blocks = 0,
        atimeMs = 0,
        mtimeMs = 0,
        ctimeMs = 0,
        birthtimeMs = 0
    ) {
        this.dev = dev;
        this.ino = ino;
        this.mode = mode;
        this.nlink = nlink;
        this.uid = 0;
        this.gid = 0;
        this.rdev = rdev;
        this.size = size;
        this.blksize = blksize;
        this.blocks = blocks;
        this.atimeMs = atimeMs;
        this.mtimeMs = mtimeMs;
        this.ctimeMs = ctimeMs;
        this.birthtimeMs = birthtimeMs;
        this.atime = new Date(this.atimeMs);
        this.mtime = new Date(this.mtimeMs);
        this.ctime = new Date(this.ctimeMs);
        this.birthtime = new Date(this.birthtimeMs);
    }

    isFile() {
        return (this.mode & S_IFMT) === S_IFREG;
    }
    isDirectory() {
        return (this.mode & S_IFMT) === S_IFDIR;
    }
    isSymbolicLink() {
        return (this.mode & S_IFMT) === S_IFLNK;
    }
    isBlockDevice() {
        return (this.mode & S_IFMT) === S_IFBLK;
    }
    isCharacterDevice() {
        return (this.mode & S_IFMT) === S_IFCHR;
    }
    isFIFO() {
        return (this.mode & S_IFMT) === S_IFIFO;
    }
    isSocket() {
        return (this.mode & S_IFMT) === S_IFSOCK;
    }
}
