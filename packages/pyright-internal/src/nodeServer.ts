/*
 * nodeServer.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Implements utilities for starting the language server in a node environment.
 */

import { Connection, ConnectionOptions } from 'vscode-languageserver';
import { createConnection } from 'vscode-languageserver/node';
import { isMainThread } from 'worker_threads';

import { initializeDependencies } from './common/asyncInitialization';
import { getCancellationStrategyFromArgv } from './common/fileBasedCancellationUtils';

export async function run(runServer: (connection: Connection) => void, runBackgroundThread: () => void) {
    await initializeDependencies();

    if (isMainThread) {
        runServer(createConnection(getConnectionOptions()));
    } else {
        runBackgroundThread();
    }
}

export function getConnectionOptions(): ConnectionOptions {
    return { cancellationStrategy: getCancellationStrategyFromArgv(process.argv) };
}
