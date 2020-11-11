/*
 * fileSystem.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * A "file system provider" abstraction that allows us to swap out a
 * real file system implementation for a virtual (mocked) implementation
 * for testing.
 */

/* eslint-disable no-dupe-class-members */

// * NOTE * except tests, this should be only file that import "fs"
import * as chokidar from 'chokidar';
import * as fs from 'fs';
import * as tmp from 'tmp';

// Automatically remove files created by tmp at process exit.
tmp.setGracefulCleanup();

import { ConsoleInterface, NullConsole } from './console';
import { createDeferred } from './deferred';
import { resolvePaths } from './pathUtils';

export type FileWatcherEventType = 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir';
export type FileWatcherEventHandler = (eventName: FileWatcherEventType, path: string, stats?: Stats) => void;

export interface FileWatcher {
    close(): void;
}

export interface Stats {
    size: number;

    isFile(): boolean;
    isDirectory(): boolean;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isSymbolicLink(): boolean;
    isFIFO(): boolean;
    isSocket(): boolean;
}

export interface MkDirOptions {
    recursive: boolean;
    // Not supported on Windows so commented out.
    // mode: string | number;
}

export interface TmpfileOptions {
    postfix?: string;
    prefix?: string;
}

export interface FileSystem {
    existsSync(path: string): boolean;
    mkdirSync(path: string, options?: MkDirOptions | number): void;
    chdir(path: string): void;
    readdirEntriesSync(path: string): fs.Dirent[];
    readdirSync(path: string): string[];
    readFileSync(path: string, encoding?: null): Buffer;
    readFileSync(path: string, encoding: BufferEncoding): string;
    readFileSync(path: string, encoding?: BufferEncoding | null): string | Buffer;
    writeFileSync(path: string, data: string | Buffer, encoding: BufferEncoding | null): void;
    statSync(path: string): Stats;
    unlinkSync(path: string): void;
    realpathSync(path: string): string;
    getModulePath(): string;
    createFileSystemWatcher(paths: string[], listener: FileWatcherEventHandler): FileWatcher;
    createReadStream(path: string): fs.ReadStream;
    createWriteStream(path: string): fs.WriteStream;
    copyFileSync(src: string, dst: string): void;
    // Async I/O
    readFile(path: string): Promise<Buffer>;
    readFileText(path: string, encoding?: BufferEncoding): Promise<string>;
    // The directory returned by tmpdir must exist and be the same each time tmpdir is called.
    tmpdir(): string;
    tmpfile(options?: TmpfileOptions): string;
}

export interface FileWatcherProvider {
    createFileWatcher(paths: string[], listener: FileWatcherEventHandler): FileWatcher;
}

// Callers can specify a different file watcher provider if desired.
// By default, we'll use the file watcher based on chokidar.
export function createFromRealFileSystem(
    console?: ConsoleInterface,
    fileWatcherProvider?: FileWatcherProvider
): FileSystem {
    return new RealFileSystem(fileWatcherProvider ?? new ChokidarFileWatcherProvider(console ?? new NullConsole()));
}

// File watchers can give "changed" event even for a file open. but for those cases,
// it will give relative path rather than absolute path. To get rid of such cases,
// we will drop any event with relative paths. this trick is copied from VS Code
// (https://github.com/microsoft/vscode/blob/master/src/vs/platform/files/node/watcher/unix/chokidarWatcherService.ts)
export function ignoredWatchEventFunction(paths: string[]) {
    const normalizedPaths = paths.map((p) => p.toLowerCase());
    return (path: string): boolean => {
        if (!path || path.indexOf('__pycache__') >= 0) {
            return true;
        }
        const normalizedPath = path.toLowerCase();
        return normalizedPaths.every((p) => normalizedPath.indexOf(p) < 0);
    };
}

const _isMacintosh = process.platform === 'darwin';
const _isLinux = process.platform === 'linux';

class RealFileSystem implements FileSystem {
    private _fileWatcherProvider: FileWatcherProvider;
    private _tmpdir?: string;

    constructor(fileWatcherProvider: FileWatcherProvider) {
        this._fileWatcherProvider = fileWatcherProvider;
    }

    existsSync(path: string) {
        return fs.existsSync(path);
    }

    mkdirSync(path: string, options?: MkDirOptions | number) {
        fs.mkdirSync(path, options);
    }

    chdir(path: string) {
        process.chdir(path);
    }

    readdirSync(path: string): string[] {
        return fs.readdirSync(path);
    }
    readdirEntriesSync(path: string): fs.Dirent[] {
        return fs.readdirSync(path, { withFileTypes: true });
    }

    readFileSync(path: string, encoding?: null): Buffer;
    readFileSync(path: string, encoding: BufferEncoding): string;
    readFileSync(path: string, encoding?: BufferEncoding | null): Buffer | string;
    readFileSync(path: string, encoding: BufferEncoding | null = null) {
        return fs.readFileSync(path, { encoding });
    }

    writeFileSync(path: string, data: string | Buffer, encoding: BufferEncoding | null) {
        fs.writeFileSync(path, data, { encoding });
    }

    statSync(path: string) {
        return fs.statSync(path);
    }

    unlinkSync(path: string) {
        fs.unlinkSync(path);
    }

    realpathSync(path: string) {
        return fs.realpathSync(path);
    }

    getModulePath(): string {
        // The entry point to the tool should have set the __rootDirectory
        // global variable to point to the directory that contains the
        // typeshed-fallback directory.
        return (global as any).__rootDirectory;
    }

    createFileSystemWatcher(paths: string[], listener: FileWatcherEventHandler): FileWatcher {
        return this._fileWatcherProvider.createFileWatcher(paths, listener);
    }

    createReadStream(path: string): fs.ReadStream {
        return fs.createReadStream(path);
    }

    createWriteStream(path: string): fs.WriteStream {
        return fs.createWriteStream(path);
    }

    copyFileSync(src: string, dst: string): void {
        fs.copyFileSync(src, dst);
    }

    readFile(path: string): Promise<Buffer> {
        const d = createDeferred<Buffer>();
        fs.readFile(path, (e, b) => {
            if (e) {
                d.reject(e);
            } else {
                d.resolve(b);
            }
        });
        return d.promise;
    }

    readFileText(path: string, encoding: BufferEncoding): Promise<string> {
        const d = createDeferred<string>();
        fs.readFile(path, { encoding }, (e, s) => {
            if (e) {
                d.reject(e);
            } else {
                d.resolve(s);
            }
        });
        return d.promise;
    }

    tmpdir() {
        if (!this._tmpdir) {
            const dir = tmp.dirSync({ prefix: 'pyright' });
            this._tmpdir = dir.name;
        }
        return this._tmpdir;
    }

    tmpfile(options?: TmpfileOptions): string {
        const f = tmp.fileSync({ dir: this.tmpdir(), discardDescriptor: true, ...options });
        return f.name;
    }
}

class ChokidarFileWatcherProvider implements FileWatcherProvider {
    constructor(private _console: ConsoleInterface) {}

    createFileWatcher(paths: string[], listener: FileWatcherEventHandler): FileWatcher {
        return this._createFileSystemWatcher(paths).on('all', listener);
    }

    createReadStream(path: string): fs.ReadStream {
        return fs.createReadStream(path);
    }
    createWriteStream(path: string): fs.WriteStream {
        return fs.createWriteStream(path);
    }

    private _createFileSystemWatcher(paths: string[]): chokidar.FSWatcher {
        // The following options are copied from VS Code source base. It also
        // uses chokidar for its file watching.
        const watcherOptions: chokidar.WatchOptions = {
            ignoreInitial: true,
            ignorePermissionErrors: true,
            followSymlinks: true, // this is the default of chokidar and supports file events through symlinks
            interval: 1000, // while not used in normal cases, if any error causes chokidar to fallback to polling, increase its intervals
            binaryInterval: 1000,
            disableGlobbing: true, // fix https://github.com/Microsoft/vscode/issues/4586
            awaitWriteFinish: {
                // this will make sure we re-scan files once file changes are written to disk
                stabilityThreshold: 1000,
                pollInterval: 1000,
            },
        };

        if (_isMacintosh) {
            // Explicitly disable on MacOS because it uses up large amounts of memory
            // and CPU for large file hierarchies, resulting in instability and crashes.
            watcherOptions.usePolling = false;
        }

        const excludes: string[] = ['**/__pycache__/**'];
        if (_isMacintosh || _isLinux) {
            if (paths.some((path) => path === '' || path === '/')) {
                excludes.push('/dev/**');
                if (_isLinux) {
                    excludes.push('/proc/**', '/sys/**');
                }
            }
        }
        watcherOptions.ignored = excludes;

        const watcher = chokidar.watch(paths, watcherOptions);
        watcher.on('error', (_) => {
            this._console.error('Error returned from file system watcher.');
        });

        // Detect if for some reason the native watcher library fails to load
        if (_isMacintosh && !watcher.options.useFsEvents) {
            this._console.info('Watcher could not use native fsevents library. File system watcher disabled.');
        }

        return watcher;
    }

    readFile(path: string): Promise<Buffer> {
        const d = createDeferred<Buffer>();
        fs.readFile(path, (e, b) => {
            if (e) {
                d.reject(e);
            } else {
                d.resolve(b);
            }
        });
        return d.promise;
    }

    readFileText(path: string, encoding: BufferEncoding): Promise<string> {
        const d = createDeferred<string>();
        fs.readFile(path, { encoding }, (e, s) => {
            if (e) {
                d.reject(e);
            } else {
                d.resolve(s);
            }
        });
        return d.promise;
    }
}
