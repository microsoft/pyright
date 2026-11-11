import { Connection } from 'vscode-languageserver';

import { CacheManager } from '../analyzer/cacheManager';
import { ConsoleWithLogLevel } from '../common/console';
import { nullFileWatcherHandler } from '../common/fileWatcher';
import { NoAccessHost } from '../common/host';
import { createServiceProvider } from '../common/serviceProviderExtensions';
import { Uri } from '../common/uri/uri';
import { PyrightFileSystem } from '../pyrightFileSystem';
import { PyrightServerBase } from '../pyrightServer';
import { Workspace } from '../workspaceFactory';
import { BrowserFileSystem } from './browserFileSystem';
import { BrowserCaseSensitivityDetector } from './browserHost';

export class BrowserPyrightServer extends PyrightServerBase {
    constructor(connection: Connection, fileSystem: BrowserFileSystem) {
        const services = createServiceProvider(
            new PyrightFileSystem(fileSystem),
            new BrowserCaseSensitivityDetector(),
            new ConsoleWithLogLevel(connection.console),
            new CacheManager()
        );
        super(connection, {
            rootDirectory: Uri.file('/', services),
            serviceProvider: services,
            fileWatcherHandler: nullFileWatcherHandler,
            createHost: () => new NoAccessHost(),
        });
    }

    override async getSettings(workspace: Workspace) {
        const settings = await super.getSettings(workspace);
        settings.watchForSourceChanges = false;
        settings.watchForLibraryChanges = false;
        settings.watchForConfigChanges = false;
        return settings;
    }
}
