/*
 * server.ts
 *
 * Node.js host for the Pyright language server.
 */

import { Connection } from 'vscode-languageserver';

import { CacheManager } from './analyzer/cacheManager';
import { BackgroundAnalysis } from './backgroundAnalysis';
import { getCancellationFolderName } from './common/cancellationUtils';
import { ConsoleWithLogLevel } from './common/console';
import { isDebugMode } from './common/core';
import { FileBasedCancellationProvider } from './common/fileBasedCancellationUtils';
import { FileSystem } from './common/fileSystem';
import { FullAccessHost } from './common/fullAccessHost';
import { createFromRealFileSystem, RealTempFile, WorkspaceFileWatcherProvider } from './common/realFileSystem';
import { createServiceProvider } from './common/serviceProviderExtensions';
import { Uri } from './common/uri/uri';
import { getRootUri } from './common/uri/uriUtils';
import { PartialStubService } from './partialStubService';
import { PyrightFileSystem } from './pyrightFileSystem';
import { PyrightServerBase } from './pyrightServer';

export class PyrightServer extends PyrightServerBase {
    constructor(connection: Connection, maxWorkers: number, realFileSystem?: FileSystem) {
        const tempFile = new RealTempFile();
        const console = new ConsoleWithLogLevel(connection.console);
        const fileWatcherProvider = new WorkspaceFileWatcherProvider();
        const fileSystem = realFileSystem ?? createFromRealFileSystem(tempFile, console, fileWatcherProvider);
        const pyrightFs = new PyrightFileSystem(fileSystem);
        const serviceProvider = createServiceProvider(
            pyrightFs,
            tempFile,
            console,
            new CacheManager(maxWorkers),
            new PartialStubService(pyrightFs),
            new FileBasedCancellationProvider('bg')
        );
        super(connection, {
            rootDirectory: getRootUri(serviceProvider) || Uri.file(__dirname, serviceProvider),
            serviceProvider,
            fileWatcherHandler: fileWatcherProvider,
            createHost: (services) => new FullAccessHost(services),
            createBackgroundAnalysis: (workspaceRoot, services) =>
                isDebugMode() || !getCancellationFolderName()
                    ? undefined
                    : new BackgroundAnalysis(workspaceRoot, services),
        });
    }
}
