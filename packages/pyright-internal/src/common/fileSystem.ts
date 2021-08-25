/*
 * fileSystem.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * A "file system provider" abstraction that allows us to swap out a
 * real file system implementation for a virtual (mocked) implementation
 * for testing.
 */

// * NOTE * except tests, this should be only file that import "fs"
import type * as fs from 'fs';

export type FileWatcherEventType = 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir';
export type FileWatcherEventHandler = (eventName: FileWatcherEventType, path: string, stats?: Stats) => void;

export interface FileWatcher {
    close(): void;
}

export interface FileWatcherProvider {
    createFileWatcher(paths: string[], listener: FileWatcherEventHandler): FileWatcher;
    onFileChange(eventType: FileWatcherEventType, path: string): void;
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
    mkdirSync(path: string, options?: MkDirOptions): void;
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

    // Return path in casing on OS.
    realCasePath(path: string): string;

    // See whether the file is mapped to another location.
    isMappedFilePath(filepath: string): boolean;

    // Get original filepath if the given filepath is mapped.
    getOriginalFilePath(mappedFilePath: string): string;

    // Get mapped filepath if the given filepath is mapped.
    getMappedFilePath(originalFilepath: string): string;

    getUri(path: string): string;

    isInZipOrEgg(path: string): boolean;
}

// File watchers can give "changed" event even for a file open. but for those cases,
// it will give relative path rather than absolute path. To get rid of such cases,
// we will drop any event with relative paths. this trick is copied from VS Code
// (https://github.com/microsoft/vscode/blob/main/src/vs/platform/files/node/watcher/unix/chokidarWatcherService.ts)
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

const nullFileWatcher: FileWatcher = {
    close() {
        // empty;
    },
};

export const nullFileWatcherProvider: FileWatcherProvider = {
    createFileWatcher(_1: string[], _2: FileWatcherEventHandler): FileWatcher {
        return nullFileWatcher;
    },
    onFileChange(_1: FileWatcherEventType, _2: string): void {
        // do nothing
    },
};

export class VirtualDirent implements fs.Dirent {
    constructor(public name: string, public _file: boolean) {}

    isFile(): boolean {
        return this._file;
    }

    isDirectory(): boolean {
        return !this._file;
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
