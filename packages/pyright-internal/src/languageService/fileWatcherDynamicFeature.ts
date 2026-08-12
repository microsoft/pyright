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
import { extraPathWatchTargetCovers, getExtraPathWatchTargets } from '../common/extraPathGlob';
import { ServiceKeys } from '../common/serviceKeys';
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

            // Wildcard `extraPaths` entries are watched by their original glob (below)
            // rather than by their already-expanded leaf directories, so drop any
            // deduped folder that one of those globs already covers. The glob specs are
            // retained on each workspace's config options (`extraPathGlobFileSpecs`).
            const extraPathGlobTargets = this._workspaceFactory
                .getNonDefaultWorkspaces()
                .flatMap((w) =>
                    getExtraPathWatchTargets(
                        w.service.getConfigOptions().extraPathGlobFileSpecs,
                        w.service.serviceProvider.get(ServiceKeys.caseSensitivityDetector)
                    )
                );

            foldersToWatch
                .filter((p) => !extraPathGlobTargets.some((t) => extraPathWatchTargetCovers(t, p)))
                .forEach((p) => {
                    const globPattern = isFile(this._fs, p, /* treatZipDirectoryAsFile */ true)
                        ? { baseUri: p.getDirectory().toString(), pattern: p.fileName }
                        : { baseUri: p.toString(), pattern: '**' };

                    watchers.push({ globPattern, kind: watchKind });
                });

            // Watch the original wildcard `extraPaths` globs. The `dirPattern` matches the
            // directories themselves; append `/**` so files *beneath* every matched directory are
            // watched too (mirroring the `**` used for expanded folders). A pattern that already
            // ends in `**` recurses on its own, so don't append a redundant second `/**` (e.g.
            // `vendor/**`). This observes creations/deletions once a path matches the full pattern
            // (e.g. a file appearing under an existing `*/src`). A brand-new intermediate directory
            // that does not yet match the pattern (e.g. the `*` segment created before its `src`
            // child exists) is instead picked up on the next configuration reload, which re-expands
            // the globs.
            extraPathGlobTargets.forEach((t) => {
                const pattern = t.dirPattern.endsWith('**') ? t.dirPattern : `${t.dirPattern}/**`;
                watchers.push({
                    globPattern: { baseUri: t.root.toString(), pattern },
                    kind: watchKind,
                });
            });
        }

        return this._connection.client.register(DidChangeWatchedFilesNotification.type, { watchers });
    }
}

interface IWorkspaceFactory {
    getNonDefaultWorkspaces(kind?: string): Workspace[];
}
