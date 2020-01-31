/*
 * vfs.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Defines virtual file system interface that our code will operate upon and
 * factory method to expose real file system as virtual file system
 */

/* eslint-disable no-dupe-class-members */

// * NOTE * except tests, this should be only file that import "fs"
import * as fs from 'fs';
import * as chokidar from 'chokidar';
import { ConsoleInterface, NullConsole } from './console';

export type Listener = (eventName: 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir', path: string, stats?: Stats) => void;

export interface FileWatcher {
    close(): void;
}

export interface VirtualFileSystem {
    existsSync(path: string): boolean;
    mkdirSync(path: string): void;
    chdir(path: string): void;
    readdirSync(path: string): string[];
    readFileSync(path: string, encoding?: null): Buffer;
    readFileSync(path: string, encoding: string): string;
    readFileSync(path: string, encoding?: string | null): string | Buffer;
    writeFileSync(path: string, data: string | Buffer, encoding: string | null): void;
    statSync(path: string): Stats;
    unlinkSync(path: string): void;
    realpathSync(path: string): string;
    getModulePath(): string;
    createFileSystemWatcher(paths: string[], event: 'all', listener: Listener): FileWatcher;
}

/**
 * expose real file system as virtual file system
 * @param console console to log messages
 */
export function createFromRealFileSystem(console?: ConsoleInterface): VirtualFileSystem {
    return new FileSystem(console ?? new NullConsole());
}

// file type
export const S_IFMT = 0o170000; // file type
export const S_IFSOCK = 0o140000; // socket
export const S_IFLNK = 0o120000; // symbolic link
export const S_IFREG = 0o100000; // regular file
export const S_IFBLK = 0o060000; // block device
export const S_IFDIR = 0o040000; // directory
export const S_IFCHR = 0o020000; // character device
export const S_IFIFO = 0o010000; // FIFO

export class Stats {
    public dev: number;
    public ino: number;
    public mode: number;
    public nlink: number;
    public uid: number;
    public gid: number;
    public rdev: number;
    public size: number;
    public blksize: number;
    public blocks: number;
    public atimeMs: number;
    public mtimeMs: number;
    public ctimeMs: number;
    public birthtimeMs: number;
    public atime: Date;
    public mtime: Date;
    public ctime: Date;
    public birthtime: Date;

    constructor();
    constructor(dev: number, ino: number, mode: number, nlink: number, rdev: number, size: number, blksize: number, blocks: number, atimeMs: number, mtimeMs: number, ctimeMs: number, birthtimeMs: number);
    constructor(dev = 0, ino = 0, mode = 0, nlink = 0, rdev = 0, size = 0, blksize = 0, blocks = 0, atimeMs = 0, mtimeMs = 0, ctimeMs = 0, birthtimeMs = 0) {
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

    public isFile() { return (this.mode & S_IFMT) === S_IFREG; }
    public isDirectory() { return (this.mode & S_IFMT) === S_IFDIR; }
    public isSymbolicLink() { return (this.mode & S_IFMT) === S_IFLNK; }
    public isBlockDevice() { return (this.mode & S_IFMT) === S_IFBLK; }
    public isCharacterDevice() { return (this.mode & S_IFMT) === S_IFCHR; }
    public isFIFO() { return (this.mode & S_IFMT) === S_IFIFO; }
    public isSocket() { return (this.mode & S_IFMT) === S_IFSOCK; }
}

const _isMacintosh = process.platform === 'darwin';
const _isLinux = process.platform === 'linux';

class FileSystem implements VirtualFileSystem {
    constructor(private _console: ConsoleInterface) {
    }

    public existsSync(path: string) { return fs.existsSync(path) }
    public mkdirSync(path: string) { fs.mkdirSync(path); }
    public chdir(path: string) { process.chdir(path); }
    public readdirSync(path: string) { return fs.readdirSync(path); }
    public readFileSync(path: string, encoding?: null): Buffer;
    public readFileSync(path: string, encoding: string): string;
    public readFileSync(path: string, encoding?: string | null): Buffer | string;
    public readFileSync(path: string, encoding: string | null = null) { return fs.readFileSync(path, { encoding: encoding }); }
    public writeFileSync(path: string, data: string | Buffer, encoding: string | null) { fs.writeFileSync(path, data, { encoding: encoding }); }
    public statSync(path: string) { return fs.statSync(path); }
    public unlinkSync(path: string) { return fs.unlinkSync(path); }
    public realpathSync(path: string) { return fs.realpathSync(path); }

    public getModulePath(): string {
        // The entry point to the tool should have set the __rootDirectory
        // global variable to point to the directory that contains the
        // typeshed-fallback directory.
        return (global as any).__rootDirectory;
    }

    public createFileSystemWatcher(paths: string[], event: 'all', listener: Listener): FileWatcher {
        return this._createBaseFileSystemWatcher(paths).on(event, listener);
    }

    private _createBaseFileSystemWatcher(paths: string[]): chokidar.FSWatcher {
        // The following options are copied from VS Code source base. It also
        // uses chokidar for its file watching.
        const watcherOptions: chokidar.WatchOptions = {
            ignoreInitial: true,
            ignorePermissionErrors: true,
            followSymlinks: true, // this is the default of chokidar and supports file events through symlinks
            interval: 1000, // while not used in normal cases, if any error causes chokidar to fallback to polling, increase its intervals
            binaryInterval: 1000,
            disableGlobbing: true // fix https://github.com/Microsoft/vscode/issues/4586
        };

        if (_isMacintosh) {
            // Explicitly disable on MacOS because it uses up large amounts of memory
            // and CPU for large file hierarchies, resulting in instability and crashes.
            watcherOptions.usePolling = false;
        }

        const excludes: string[] = [];
        if (_isMacintosh || _isLinux) {
            if (paths.some(path => path === '' || path === '/')) {
                excludes.push('/dev/**');
                if (_isLinux) {
                    excludes.push('/proc/**', '/sys/**');
                }
            }
        }
        watcherOptions.ignored = excludes;

        const watcher = chokidar.watch(paths, watcherOptions);
        watcher.on('error', _ => {
            this._console.log('Error returned from file system watcher.');
        });

        // Detect if for some reason the native watcher library fails to load
        if (_isMacintosh && !watcher.options.useFsEvents) {
            this._console.log('Watcher could not use native fsevents library. File system watcher disabled.');
        }

        return watcher;
    }
}