/*
 * cliWatchMain.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Subprocess entry point for CLI watch integration tests.
 */

import { FSWatcher } from 'chokidar';

import { ChokidarFileWatcherProvider } from '../../common/chokidarFileWatcherProvider';
import { main } from '../../pyright';

// Observe readiness without replacing native events or changing watcher options.
// CLI diagnostic output can finish before chokidar's initial scan does.
const createFileWatcher = ChokidarFileWatcherProvider.prototype.createFileWatcher;
ChokidarFileWatcherProvider.prototype.createFileWatcher = function (paths, listener) {
    const watcher = createFileWatcher.call(this, paths, listener) as FSWatcher;
    watcher.once('ready', () => process.send?.({ kind: 'watcher-ready', paths }));
    return watcher;
};

main();
