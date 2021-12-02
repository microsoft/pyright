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
import { ConfigOptions } from '../../../common/configOptions';
import { ConsoleInterface } from '../../../common/console';
import * as debug from '../../../common/debug';
import { createDeferred } from '../../../common/deferred';
import { FileSystem } from '../../../common/fileSystem';
import { Range } from '../../../common/textRange';
import { UriParser } from '../../../common/uriParser';
import {
    LanguageServerInterface,
    MessageAction,
    ServerSettings,
    WindowInterface,
    WorkspaceServiceInstance,
} from '../../../languageServerBase';
import { CodeActionProvider } from '../../../languageService/codeActionProvider';
import { TestAccessHost } from '../testAccessHost';
import { HostSpecificFeatures } from './testState';

export class TestFeatures implements HostSpecificFeatures {
    importResolverFactory: ImportResolverFactory = AnalyzerService.createImportResolver;
    runIndexer(workspace: WorkspaceServiceInstance, noStdLib: boolean): void {
        /* empty */
    }
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
    private readonly _defaultWorkspace: WorkspaceServiceInstance;
    private readonly _uriParser: UriParser;

    constructor(workspace: WorkspaceServiceInstance, readonly console: ConsoleInterface, readonly fs: FileSystem) {
        this._workspace = workspace;
        this._uriParser = new UriParser(this.fs);
        this._defaultWorkspace = {
            workspaceName: '',
            rootPath: '',
            rootUri: '',
            serviceInstance: new AnalyzerService(
                'test service',
                this.fs,
                this.console,
                () => new TestAccessHost(),
                AnalyzerService.createImportResolver,
                new ConfigOptions('.')
            ),
            disableLanguageServices: false,
            disableOrganizeImports: false,
            isInitialized: createDeferred<boolean>(),
        };
    }
    decodeTextDocumentUri(uriString: string): string {
        return this._uriParser.decodeTextDocumentUri(uriString);
    }

    getWorkspaceForFile(filePath: string): Promise<WorkspaceServiceInstance> {
        if (filePath.startsWith(this._workspace.rootPath)) {
            return Promise.resolve(this._workspace);
        }

        return Promise.resolve(this._defaultWorkspace);
    }

    getSettings(workspace: WorkspaceServiceInstance): Promise<ServerSettings> {
        const settings: ServerSettings = {
            venvPath: this._workspace.serviceInstance.getConfigOptions().venvPath,
            pythonPath: this._workspace.serviceInstance.getConfigOptions().pythonPath,
            typeshedPath: this._workspace.serviceInstance.getConfigOptions().typeshedPath,
            openFilesOnly: this._workspace.serviceInstance.getConfigOptions().checkOnlyOpenFiles,
            useLibraryCodeForTypes: this._workspace.serviceInstance.getConfigOptions().useLibraryCodeForTypes,
            disableLanguageServices: this._workspace.disableLanguageServices,
            autoImportCompletions: this._workspace.serviceInstance.getConfigOptions().autoImportCompletions,
        };

        return Promise.resolve(settings);
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
    readonly supportAdvancedEdits = true;
}

class TestWindow implements WindowInterface {
    showErrorMessage(message: string): void;
    showErrorMessage(message: string, ...actions: MessageAction[]): Promise<MessageAction | undefined>;
    showErrorMessage(message: string, ...actions: MessageAction[]): Promise<MessageAction | undefined> | void {
        debug.fail("shouldn't be called");
    }

    showWarningMessage(message: string): void;
    showWarningMessage(message: string, ...actions: MessageAction[]): Promise<MessageAction | undefined>;
    showWarningMessage(message: string, ...actions: MessageAction[]): Promise<MessageAction | undefined> | void {
        debug.fail("shouldn't be called");
    }

    showInformationMessage(message: string): void;
    showInformationMessage(message: string, ...actions: MessageAction[]): Promise<MessageAction | undefined>;
    showInformationMessage(message: string, ...actions: MessageAction[]): Promise<MessageAction | undefined> | void {
        // Don't do anything
    }
}
