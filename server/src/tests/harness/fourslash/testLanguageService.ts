/*
 * testLanguageService.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Test mock that implements LanguageServiceInterface
 */

import * as path from 'path';

import { ConsoleInterface } from '../../../common/console';
import * as debug from '../../../common/debug';
import { FileSystem } from '../../../common/fileSystem';
import {
    LanguageServerInterface,
    ServerSettings,
    WindowInterface,
    WorkspaceServiceInstance,
} from '../../../languageServerBase';

export class TestLanguageService implements LanguageServerInterface {
    private readonly _workspace: WorkspaceServiceInstance;

    constructor(workspace: WorkspaceServiceInstance, readonly console: ConsoleInterface, readonly fs: FileSystem) {
        this._workspace = workspace;
    }

    getWorkspaceForFile(filePath: string): WorkspaceServiceInstance {
        debug.assertDefined(this._workspace.serviceInstance.test_program.getSourceFile(filePath));
        return this._workspace;
    }

    async getSettings(workspace: WorkspaceServiceInstance): Promise<ServerSettings> {
        const settings: ServerSettings = {
            venvPath: this._workspace.serviceInstance.test_configOptions.venvPath,
            pythonPath: this._workspace.serviceInstance.test_configOptions.pythonPath,
            typeshedPath: this._workspace.serviceInstance.test_configOptions.typeshedPath,
            openFilesOnly: this._workspace.serviceInstance.test_configOptions.checkOnlyOpenFiles,
            useLibraryCodeForTypes: this._workspace.serviceInstance.test_configOptions.useLibraryCodeForTypes,
            disableLanguageServices: this._workspace.disableLanguageServices,
        };

        return settings;
    }

    reanalyze(): void {
        // Don't do anything
    }

    restart(): void {
        // Don't do anything
    }

    readonly rootPath = path.sep;
    readonly window = new TestWindow();
}

class TestWindow implements WindowInterface {
    showErrorMessage(message: string): void {
        debug.fail("shouldn't be called");
    }

    showWarningMessage(message: string): void {
        debug.fail("shouldn't be called");
    }

    showInformationMessage(message: string): void {
        // Don't do anything
    }
}
