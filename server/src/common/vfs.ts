/*
* vfs.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
*/
/* eslint-disable no-dupe-class-members */

// except tests, this should be only file that import "fs"
import * as fs from 'fs';
import * as chokidar from 'chokidar';
import { Stats } from "../tests/harness/vfs/filesystem";
import { ConsoleInterface, NullConsole } from './console';

const _isMacintosh = process.platform === 'darwin';
const _isLinux = process.platform === 'linux';

export type Listener = (eventName: 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir', path: string, stats?: Stats) => void;

export interface FileWatcher {
    close(): void;
}

export interface VirtualFileSystem {
    existsSync(path: string): boolean;
    mkdirSync(path: string): void;
    readdirSync(path: string): string[];
    readFileSync(path: string, encoding?: null): Buffer;
    readFileSync(path: string, encoding: string): string;
    readFileSync(path: string, encoding?: string | null): string | Buffer;
    writeFileSync(path: string, data: string | Buffer, encoding: string | null): void;
    statSync(path: string): Stats;
    unlinkSync(path: string): void;
    realpathSync(path: string): string;
    createFileSystemWatcher(paths: string[], event: 'all', listener: Listener): FileWatcher;
}

export function createFromRealFileSystem(console?: ConsoleInterface): VirtualFileSystem {
    return new FileSystem(console ?? new NullConsole());
}

class FileSystem implements VirtualFileSystem {
    constructor(private _console: ConsoleInterface) {
    }

    public existsSync(path: string) { return fs.existsSync(path) }
    public mkdirSync(path: string) { fs.mkdirSync(path); }
    public readdirSync(path: string) { return fs.readdirSync(path); }
    public readFileSync(path: string, encoding?: null): Buffer;
    public readFileSync(path: string, encoding: string): string;
    public readFileSync(path: string, encoding?: string | null): Buffer | string;
    public readFileSync(path: string, encoding: string | null = null) { return fs.readFileSync(path, { encoding: encoding }); }
    public writeFileSync(path: string, data: string | Buffer, encoding: string | null) { fs.writeFileSync(path, data, { encoding: encoding }); }
    public statSync(path: string) { return fs.statSync(path); }
    public unlinkSync(path: string) { return fs.unlinkSync(path); }
    public realpathSync(path: string) { return fs.realpathSync(path); }
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