/*
 * testLanguageService.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Test mock that implements LanguageServiceInterface
 */

import { CancellationToken, CodeAction, ExecuteCommandParams } from 'vscode-languageserver';

import {
    BackgroundAnalysisProgram,
    BackgroundAnalysisProgramFactory,
} from '../../../analyzer/backgroundAnalysisProgram';
import { ImportResolver, ImportResolverFactory } from '../../../analyzer/importResolver';
import { MaxAnalysisTime } from '../../../analyzer/program';
import { AnalyzerService, AnalyzerServiceOptions } from '../../../analyzer/service';
import { IBackgroundAnalysis } from '../../../backgroundAnalysisBase';
import { CommandController } from '../../../commands/commandController';
import { ConfigOptions } from '../../../common/configOptions';
import { ConsoleInterface } from '../../../common/console';
import * as debug from '../../../common/debug';
import { FileSystem } from '../../../common/fileSystem';
import { ServiceProvider } from '../../../common/serviceProvider';
import { Range } from '../../../common/textRange';
import { Uri } from '../../../common/uri/uri';
import {
    LanguageServerInterface,
    MessageAction,
    ServerSettings,
    WindowInterface,
} from '../../../common/languageServerInterface';
import { CodeActionProvider } from '../../../languageService/codeActionProvider';
import { WellKnownWorkspaceKinds, Workspace, createInitStatus } from '../../../workspaceFactory';
import { TestAccessHost } from '../testAccessHost';
import { HostSpecificFeatures } from './testState';

export class TestFeatures implements HostSpecificFeatures {
    importResolverFactory: ImportResolverFactory = AnalyzerService.createImportResolver;
    backgroundAnalysisProgramFactory: BackgroundAnalysisProgramFactory = (
        serviceId: string,
        serviceProvider: ServiceProvider,
        configOptions: ConfigOptions,
        importResolver: ImportResolver,
        backgroundAnalysis?: IBackgroundAnalysis,
        maxAnalysisTime?: MaxAnalysisTime
    ) =>
        new BackgroundAnalysisProgram(
            serviceId,
            serviceProvider,
            configOptions,
            importResolver,
            backgroundAnalysis,
            maxAnalysisTime,
            /* disableChecker */ undefined
        );

    getCodeActionsForPosition(
        workspace: Workspace,
        fileUri: Uri,
        range: Range,
        token: CancellationToken
    ): Promise<CodeAction[]> {
        return CodeActionProvider.getCodeActionsForPosition(workspace, fileUri, range, undefined, token);
    }
    execute(ls: LanguageServerInterface, params: ExecuteCommandParams, token: CancellationToken): Promise<any> {
        const controller = new CommandController(ls);
        return controller.execute(params, token);
    }
}

export class TestLanguageService implements LanguageServerInterface {
    readonly window = new TestWindow();
    readonly supportAdvancedEdits = true;
    readonly serviceProvider: ServiceProvider;

    private readonly _workspace: Workspace;
    private readonly _defaultWorkspace: Workspace;

    constructor(
        workspace: Workspace,
        readonly console: ConsoleInterface,
        readonly fs: FileSystem,
        options?: AnalyzerServiceOptions
    ) {
        this._workspace = workspace;
        this.serviceProvider = this._workspace.service.serviceProvider;

        this._defaultWorkspace = {
            workspaceName: '',
            rootUri: undefined,
            kinds: [WellKnownWorkspaceKinds.Test],
            service: new AnalyzerService(
                'test service',
                new ServiceProvider(),
                options ?? {
                    console: this.console,
                    hostFactory: () => new TestAccessHost(),
                    importResolverFactory: AnalyzerService.createImportResolver,
                    configOptions: new ConfigOptions(Uri.empty()),
                    fileSystem: this.fs,
                }
            ),
            disableLanguageServices: false,
            disableTaggedHints: false,
            disableOrganizeImports: false,
            disableWorkspaceSymbol: false,
            isInitialized: createInitStatus(),
            searchPathsToWatch: [],
        };
    }

    getWorkspaces(): Promise<Workspace[]> {
        return Promise.resolve([this._workspace, this._defaultWorkspace]);
    }

    getWorkspaceForFile(uri: Uri): Promise<Workspace> {
        if (uri.startsWith(this._workspace.rootUri)) {
            return Promise.resolve(this._workspace);
        }

        return Promise.resolve(this._defaultWorkspace);
    }

    getSettings(_workspace: Workspace): Promise<ServerSettings> {
        const settings: ServerSettings = {
            venvPath: this._workspace.service.getConfigOptions().venvPath,
            pythonPath: this._workspace.service.getConfigOptions().pythonPath,
            typeshedPath: this._workspace.service.getConfigOptions().typeshedPath,
            openFilesOnly: this._workspace.service.getConfigOptions().checkOnlyOpenFiles,
            useLibraryCodeForTypes: this._workspace.service.getConfigOptions().useLibraryCodeForTypes,
            disableLanguageServices: this._workspace.disableLanguageServices,
            disableTaggedHints: this._workspace.disableTaggedHints,
            autoImportCompletions: this._workspace.service.getConfigOptions().autoImportCompletions,
            functionSignatureDisplay: this._workspace.service.getConfigOptions().functionSignatureDisplay,
        };

        return Promise.resolve(settings);
    }

    createBackgroundAnalysis(serviceId: string): IBackgroundAnalysis | undefined {
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
