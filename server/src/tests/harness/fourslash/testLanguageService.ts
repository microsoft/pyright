/*
 * testLanguageService.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Test mock that implements LanguageServiceInterface
 */

import * as path from 'path';
import { CancellationToken, CodeAction, ExecuteCommandParams } from 'vscode-languageserver';

import { ImportResolverFactory } from '../../../analyzer/importResolver';
import { AnalyzerService } from '../../../analyzer/service';
import { BackgroundAnalysisBase } from '../../../backgroundAnalysisBase';
import { CommandController } from '../../../commands/commandController';
import { ConsoleInterface } from '../../../common/console';
import * as debug from '../../../common/debug';
import { FileSystem } from '../../../common/fileSystem';
import { Range } from '../../../common/textRange';
import {
    LanguageServerInterface,
    ServerSettings,
    WindowInterface,
    WorkspaceServiceInstance,
} from '../../../languageServerBase';
import { CodeActionProvider } from '../../../languageService/codeActionProvider';
import { HostSpecificFeatures } from './testState';

export class TestFeatures implements HostSpecificFeatures {
    importResolverFactory: ImportResolverFactory = AnalyzerService.createImportResolver;
    getCodeActionsForPosition(
        workspace: WorkspaceServiceInstance,
        filePath: string,
        range: Range,
        token: CancellationToken
    ): Promise<CodeAction[]> {
        return CodeActionProvider.getCodeActionsForPosition(workspace, filePath, range, token);
    }
    execute(ls: LanguageServerInterface, params: ExecuteCommandParams, token: CancellationToken): Promise<any> {
        const controller = new CommandController(ls);
        return controller.execute(params, token);
    }
}

export class TestLanguageService implements LanguageServerInterface {
    private readonly _workspace: WorkspaceServiceInstance;

    constructor(workspace: WorkspaceServiceInstance, readonly console: ConsoleInterface, readonly fs: FileSystem) {
        this._workspace = workspace;
    }

    async getWorkspaceForFile(filePath: string): Promise<WorkspaceServiceInstance> {
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

    createBackgroundAnalysis(): BackgroundAnalysisBase | undefined {
        // worker thread doesn't work in Jest
        // by returning undefined, analysis will run inline
        return undefined;
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
