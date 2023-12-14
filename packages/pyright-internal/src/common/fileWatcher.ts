/*
 * fileWatcher.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * file watcher related functionality.
 */
import { Stats } from './fileSystem';
import { Uri } from './uri/uri';

export type FileWatcherEventType = 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir';
export type FileWatcherEventHandler = (eventName: FileWatcherEventType, path: string, stats?: Stats) => void;

export interface FileWatcher {
    close(): void;
}

export interface FileWatcherHandler {
    onFileChange(eventType: FileWatcherEventType, uri: Uri): void;
}

export interface FileWatcherProvider {
    createFileWatcher(paths: string[], listener: FileWatcherEventHandler): FileWatcher;
}

export const nullFileWatcherHandler: FileWatcherHandler = {
    onFileChange(_1: FileWatcherEventType, _2: Uri): void {
        // do nothing
    },
};

export const nullFileWatcherProvider: FileWatcherProvider = {
    createFileWatcher(_1: string[], _2: FileWatcherEventHandler): FileWatcher {
        return nullFileWatcher;
    },
};

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
