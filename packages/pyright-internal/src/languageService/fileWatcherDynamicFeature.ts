/*
 * fileWatcherDynamicFeature.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * implementation of file watcher feature dynamic registration
 */
import {
    Connection,
    DidChangeWatchedFilesNotification,
    Disposable,
    FileSystemWatcher,
    WatchKind,
} from 'vscode-languageserver';
import { FileSystem } from '../common/fileSystem';
import { deduplicateFolders, isFile } from '../common/uri/uriUtils';
import { DynamicFeature } from './dynamicFeature';
import { Workspace } from '../workspaceFactory';
import { isDefined } from '../common/core';
import { configFileName } from '../common/pathConsts';

export class FileWatcherDynamicFeature extends DynamicFeature {
    constructor(
        private readonly _connection: Connection,
        private readonly _hasWatchFileRelativePathCapability: boolean,
        private readonly _fs: FileSystem,
        private readonly _workspaceFactory: IWorkspaceFactory
    ) {
        super('file watcher');
    }

    protected override registerFeature(): Promise<Disposable> {
        const watchKind = WatchKind.Create | WatchKind.Change | WatchKind.Delete;

        // Set default (config files and all workspace files) first.
        const watchers: FileSystemWatcher[] = [
            { globPattern: `**/${configFileName}`, kind: watchKind },
            { globPattern: '**', kind: watchKind },
        ];

        // Add all python search paths to watch list
        if (this._hasWatchFileRelativePathCapability) {
            // Dedup search paths from all workspaces.
            // Get rid of any search path under workspace root since it is already watched by
            // "**" above.
            const searchPaths = this._workspaceFactory.getNonDefaultWorkspaces().map((w) => [
                ...w.searchPathsToWatch,
                ...w.service
                    .getConfigOptions()
                    .getExecutionEnvironments()
                    .map((e) => e.extraPaths)
                    .flat(),
            ]);

            const foldersToWatch = deduplicateFolders(
                searchPaths,
                this._workspaceFactory
                    .getNonDefaultWorkspaces()
                    .map((w) => w.rootUri)
                    .filter(isDefined)
            );

            foldersToWatch.forEach((p) => {
                const globPattern = isFile(this._fs, p, /* treatZipDirectoryAsFile */ true)
                    ? { baseUri: p.getDirectory().toString(), pattern: p.fileName }
                    : { baseUri: p.toString(), pattern: '**' };

                watchers.push({ globPattern, kind: watchKind });
            });
        }

        return this._connection.client.register(DidChangeWatchedFilesNotification.type, { watchers });
    }
}

interface IWorkspaceFactory {
    getNonDefaultWorkspaces(kind?: string): Workspace[];
}
