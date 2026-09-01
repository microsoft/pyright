/*
 * nodeMain.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Provides the main entrypoint to the Pyright type server when running in Node.
 *
 * This lives in pyright-internal (rather than the pyright-typeserver package) so that all
 * vscode-languageserver usage resolves to a single copy, matching how the `pyright`
 * package keeps its own entry points as thin shims over pyright-internal.
 */

import path from 'path';
import { createConnection } from 'vscode-languageserver/node';

import { CacheManager } from '../analyzer/cacheManager';
import { initializeDependencies } from '../common/asyncInitialization';
import { ConsoleWithLogLevel } from '../common/console';
import { FileBasedCancellationProvider } from '../common/fileBasedCancellationUtils';
import { createFromRealFileSystem, RealTempFile, WorkspaceFileWatcherProvider } from '../common/realFileSystem';
import { createServiceProvider } from '../common/serviceProviderExtensions';
import { Uri } from '../common/uri/uri';
import { getRootUri } from '../common/uri/uriUtils';
import { getConnectionOptions } from '../nodeServer';
import { PartialStubService } from '../partialStubService';

import { TypeServer } from './server';
import { NotebookUriMapper } from './notebookUriMapper';
import { TypeServerFileSystem } from './typeServerFileSystem';
import { TypeServerServiceKeys } from './typeServerServiceKeys';

export async function main() {
    await initializeDependencies();

    const rootDirectory = __dirname;
    (global as any).__rootDirectory = path.resolve(rootDirectory);

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const version = require('../../package.json').version || '';

    const connection = createConnection(getConnectionOptions());
    const tempFile = new RealTempFile();
    const console = new ConsoleWithLogLevel(connection.console, `TS(${process.pid})`);
    const fileWatcherProvider = new WorkspaceFileWatcherProvider();
    const fileSystem = createFromRealFileSystem(tempFile, console, fileWatcherProvider);

    // The notebook URI mapper maps notebook-cell URIs to their file-scheme equivalents. It is
    // shared between the file system (so mapped reads/stats resolve) and the server (so cell
    // requests route to the right workspace). `tempFile` provides case-sensitivity detection.
    const uriMapper = new NotebookUriMapper(tempFile);
    const typeServerFs = new TypeServerFileSystem(fileSystem, uriMapper);
    const cacheManager = new CacheManager();
    const partialStubService = new PartialStubService(typeServerFs);

    const serviceProvider = createServiceProvider(
        typeServerFs,
        tempFile,
        console,
        cacheManager,
        partialStubService,
        new FileBasedCancellationProvider('bg')
    );
    serviceProvider.add(TypeServerServiceKeys.uriMapper, uriMapper);

    const rootUri: Uri = getRootUri(serviceProvider) || Uri.file(rootDirectory, serviceProvider);
    const realPathRoot = typeServerFs.realCasePath(rootUri);

    new TypeServer(
        {
            productName: 'PyrightTypeServer',
            rootDirectory: realPathRoot,
            version,
            serviceProvider,
            fileWatcherHandler: fileWatcherProvider,
            maxAnalysisTimeInForeground: { openFilesTimeInMs: 50, noOpenFilesTimeInMs: 200 },
        },
        connection
    );
}
