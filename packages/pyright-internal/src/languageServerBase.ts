/*
 * languageServerBase.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Implements common language server functionality.
 * This is split out as a base class to allow for
 * different language server variants to be created
 * from the same core functionality.
 */

import './common/extensions';

import {
    AbstractCancellationTokenSource,
    CallHierarchyIncomingCallsParams,
    CallHierarchyItem,
    CallHierarchyOutgoingCall,
    CallHierarchyOutgoingCallsParams,
    CallHierarchyPrepareParams,
    CancellationToken,
    CodeAction,
    CodeActionParams,
    Command,
    CompletionItem,
    CompletionList,
    CompletionParams,
    CompletionTriggerKind,
    ConfigurationItem,
    Connection,
    Declaration,
    DeclarationLink,
    Definition,
    DefinitionLink,
    Diagnostic,
    DiagnosticRelatedInformation,
    DiagnosticSeverity,
    DiagnosticTag,
    DidChangeConfigurationParams,
    DidChangeTextDocumentParams,
    DidChangeWatchedFilesNotification,
    DidChangeWatchedFilesParams,
    DidCloseTextDocumentParams,
    DidOpenTextDocumentParams,
    Disposable,
    DocumentHighlight,
    DocumentHighlightParams,
    DocumentSymbol,
    DocumentSymbolParams,
    ExecuteCommandParams,
    FileSystemWatcher,
    HoverParams,
    InitializeParams,
    InitializeResult,
    Location,
    MarkupKind,
    PrepareRenameParams,
    PublishDiagnosticsParams,
    ReferenceParams,
    RemoteWindow,
    RenameParams,
    SignatureHelp,
    SignatureHelpParams,
    SymbolInformation,
    TextDocumentPositionParams,
    TextDocumentSyncKind,
    WatchKind,
    WorkDoneProgressReporter,
    WorkspaceEdit,
    WorkspaceSymbol,
    WorkspaceSymbolParams,
} from 'vscode-languageserver';
import { ResultProgressReporter, attachWorkDone } from 'vscode-languageserver/lib/common/progress';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { AnalysisResults } from './analyzer/analysis';
import { BackgroundAnalysisProgram, InvalidatedReason } from './analyzer/backgroundAnalysisProgram';
import { CacheManager } from './analyzer/cacheManager';
import { ImportResolver } from './analyzer/importResolver';
import { MaxAnalysisTime } from './analyzer/program';
import { AnalyzerService, configFileNames, getNextServiceId } from './analyzer/service';
import { IPythonMode } from './analyzer/sourceFile';
import type { BackgroundAnalysisBase } from './backgroundAnalysisBase';
import { CommandResult } from './commands/commandResult';
import { CancelAfter, CancellationProvider } from './common/cancellationUtils';
import { getNestedProperty } from './common/collectionUtils';
import {
    DiagnosticSeverityOverrides,
    DiagnosticSeverityOverridesMap,
    getDiagnosticSeverityOverrides,
} from './common/commandLineOptions';
import { ConfigOptions, SignatureDisplayType, getDiagLevelDiagnosticRules } from './common/configOptions';
import { ConsoleInterface, ConsoleWithLogLevel, LogLevel } from './common/console';
import {
    Diagnostic as AnalyzerDiagnostic,
    DiagnosticCategory,
    TaskListPriority,
    TaskListToken,
} from './common/diagnostic';
import { DiagnosticRule } from './common/diagnosticRules';
import { FileDiagnostics } from './common/diagnosticSink';
import { Extensions } from './common/extensibility';
import { FileSystem, FileWatcherEventType, FileWatcherHandler } from './common/fileSystem';
import { Host } from './common/host';
import { fromLSPAny } from './common/lspUtils';
import { convertPathToUri, deduplicateFolders, getDirectoryPath, getFileName, isFile } from './common/pathUtils';
import { ProgressReportTracker, ProgressReporter } from './common/progressReporter';
import { DocumentRange, Position, Range } from './common/textRange';
import { UriParser } from './common/uriParser';
import { AnalyzerServiceExecutor } from './languageService/analyzerServiceExecutor';
import { CallHierarchyProvider } from './languageService/callHierarchyProvider';
import { CompletionItemData, CompletionProvider } from './languageService/completionProvider';
import { DefinitionFilter, DefinitionProvider, TypeDefinitionProvider } from './languageService/definitionProvider';
import { DocumentHighlightProvider } from './languageService/documentHighlightProvider';
import { DocumentSymbolProvider } from './languageService/documentSymbolProvider';
import { HoverProvider } from './languageService/hoverProvider';
import { canNavigateToFile } from './languageService/navigationUtils';
import { ReferencesProvider } from './languageService/referencesProvider';
import { SignatureHelpProvider } from './languageService/signatureHelpProvider';
import { Localizer, setLocaleOverride } from './localization/localize';
import { PyrightFileSystem } from './pyrightFileSystem';
import { InitStatus, WellKnownWorkspaceKinds, Workspace, WorkspaceFactory } from './workspaceFactory';
import { RenameProvider } from './languageService/renameProvider';
import { WorkspaceSymbolProvider } from './languageService/workspaceSymbolProvider';

export interface ServerSettings {
    venvPath?: string | undefined;
    pythonPath?: string | undefined;
    typeshedPath?: string | undefined;
    stubPath?: string | undefined;
    openFilesOnly?: boolean | undefined;
    typeCheckingMode?: string | undefined;
    useLibraryCodeForTypes?: boolean | undefined;
    disableLanguageServices?: boolean | undefined;
    disableOrganizeImports?: boolean | undefined;
    autoSearchPaths?: boolean | undefined;
    extraPaths?: string[] | undefined;
    watchForSourceChanges?: boolean | undefined;
    watchForLibraryChanges?: boolean | undefined;
    watchForConfigChanges?: boolean | undefined;
    diagnosticSeverityOverrides?: DiagnosticSeverityOverridesMap | undefined;
    logLevel?: LogLevel | undefined;
    autoImportCompletions?: boolean | undefined;
    indexing?: boolean | undefined;
    logTypeEvaluationTime?: boolean | undefined;
    typeEvaluationTimeThreshold?: number | undefined;
    fileSpecs?: string[];
    excludeFileSpecs?: string[];
    ignoreFileSpecs?: string[];
    taskListTokens?: TaskListToken[];
    functionSignatureDisplay?: SignatureDisplayType | undefined;
}

export interface MessageAction {
    title: string;
    id: string;
}

export interface WindowInterface {
    showErrorMessage(message: string): void;
    showErrorMessage(message: string, ...actions: MessageAction[]): Promise<MessageAction | undefined>;

    showWarningMessage(message: string): void;
    showWarningMessage(message: string, ...actions: MessageAction[]): Promise<MessageAction | undefined>;

    showInformationMessage(message: string): void;
    showInformationMessage(message: string, ...actions: MessageAction[]): Promise<MessageAction | undefined>;
}

export interface LanguageServerInterface {
    readonly rootPath: string;
    readonly console: ConsoleInterface;
    readonly window: WindowInterface;
    readonly supportAdvancedEdits: boolean;

    getWorkspaces(): Promise<Workspace[]>;
    getWorkspaceForFile(filePath: string): Promise<Workspace>;
    getSettings(workspace: Workspace): Promise<ServerSettings>;
    createBackgroundAnalysis(serviceId: string): BackgroundAnalysisBase | undefined;
    reanalyze(): void;
    restart(): void;
    decodeTextDocumentUri(uriString: string): string;
}

export interface ServerOptions {
    productName: string;
    rootDirectory: string;
    version: string;
    cancellationProvider: CancellationProvider;
    fileSystem: FileSystem;
    fileWatcherHandler: FileWatcherHandler;
    maxAnalysisTimeInForeground?: MaxAnalysisTime;
    disableChecker?: boolean;
    supportedCommands?: string[];
    supportedCodeActions?: string[];
    supportsTelemetry?: boolean;
}

export interface WorkspaceServices {
    fs: FileSystem;
    backgroundAnalysis: BackgroundAnalysisBase | undefined;
}

export interface ClientCapabilities {
    hasConfigurationCapability: boolean;
    hasVisualStudioExtensionsCapability: boolean;
    hasWorkspaceFoldersCapability: boolean;
    hasWatchFileCapability: boolean;
    hasWatchFileRelativePathCapability: boolean;
    hasActiveParameterCapability: boolean;
    hasSignatureLabelOffsetCapability: boolean;
    hasHierarchicalDocumentSymbolCapability: boolean;
    hasWindowProgressCapability: boolean;
    hasGoToDeclarationCapability: boolean;
    hasDocumentChangeCapability: boolean;
    hasDocumentAnnotationCapability: boolean;
    hasCompletionCommitCharCapability: boolean;
    hoverContentFormat: MarkupKind;
    completionDocFormat: MarkupKind;
    completionSupportsSnippet: boolean;
    signatureDocFormat: MarkupKind;
    supportsDeprecatedDiagnosticTag: boolean;
    supportsUnnecessaryDiagnosticTag: boolean;
    supportsTaskItemDiagnosticTag: boolean;
    completionItemResolveSupportsAdditionalTextEdits: boolean;
}

const nullProgressReporter = attachWorkDone(undefined as any, /* params */ undefined);

/*
 * Additional DiagnosticTag values that are specific to Visual Studio.
 * These must match the values in https://dev.azure.com/devdiv/DevDiv/_git/vslanguageserverclient?path=%2Fsrc%2Fproduct%2FProtocol%2FLanguageServer.Protocol.Extensions%2FVSDiagnosticTags.cs&version=GBdevelop&_a=contents
 */
export namespace VSDiagnosticTag {
    /**
     * A diagnostic entry generated by the build.
     */
    export const BuildError = -1;

    /**
     * A diagnostic entry generated by Intellisense.
     */
    export const IntellisenseError = -2;

    /**
     * A diagnostic entry that could be generated from both builds and Intellisense.
     *
     * Diagnostic entries tagged with PotentialDuplicate will be hidden
     * in the error list if the error list is displaying build and intellisense errors.
     */
    export const PotentialDuplicate = -3;

    /**
     * A diagnostic entry that is never displayed in the error list.
     */
    export const HiddenInErrorList = -4;

    /**
     * A diagnostic entry that is always displayed in the error list.
     */
    export const VisibleInErrorList = -5;

    /**
     * A diagnostic entry that is never displayed in the editor.
     */
    export const HiddenInEditor = -6;

    /**
     * No tooltip is shown for the Diagnostic entry in the editor.
     */
    export const SuppressEditorToolTip = -7;

    /**
     * A diagnostic entry that is represented in the editor as an Edit and Continue error.
     */
    export const EditAndContinueError = -8;

    /**
     * A diagnostic entry that is represented in the editor as a Task List item (View -> Task List)
     */
    export const TaskItem = -9;
}

/*
 * DiagnosticRank values that are specific to Visual Studio.
 * These must match the values in https://dev.azure.com/devdiv/DevDiv/_git/vslanguageserverclient?path=/src/product/Protocol/LanguageServer.Protocol.Extensions/VSDiagnosticRank.cs&version=GBdevelop&_a=contents
 */
export namespace VSDiagnosticRank {
    export const Highest = 100;
    export const High = 200;
    export const Default = 300;
    export const Low = 400;
    export const Lowest = 500;
}

export abstract class LanguageServerBase implements LanguageServerInterface {
    // We support running only one "find all reference" at a time.
    private _pendingFindAllRefsCancellationSource: AbstractCancellationTokenSource | undefined;

    // We support running only one command at a time.
    private _pendingCommandCancellationSource: AbstractCancellationTokenSource | undefined;

    private _progressReporter: ProgressReporter;

    private _lastTriggerKind: CompletionTriggerKind | undefined = CompletionTriggerKind.Invoked;

    private _lastFileWatcherRegistration: Disposable | undefined;

    private _initialized = false;

    // Global root path - the basis for all global settings.
    rootPath = '';

    protected client: ClientCapabilities = {
        hasConfigurationCapability: false,
        hasVisualStudioExtensionsCapability: false,
        hasWorkspaceFoldersCapability: false,
        hasWatchFileCapability: false,
        hasWatchFileRelativePathCapability: false,
        hasActiveParameterCapability: false,
        hasSignatureLabelOffsetCapability: false,
        hasHierarchicalDocumentSymbolCapability: false,
        hasWindowProgressCapability: false,
        hasGoToDeclarationCapability: false,
        hasDocumentChangeCapability: false,
        hasDocumentAnnotationCapability: false,
        hasCompletionCommitCharCapability: false,
        hoverContentFormat: MarkupKind.PlainText,
        completionDocFormat: MarkupKind.PlainText,
        completionSupportsSnippet: false,
        signatureDocFormat: MarkupKind.PlainText,
        supportsDeprecatedDiagnosticTag: false,
        supportsUnnecessaryDiagnosticTag: false,
        supportsTaskItemDiagnosticTag: false,
        completionItemResolveSupportsAdditionalTextEdits: false,
    };

    protected defaultClientConfig: any;
    protected workspaceFactory: WorkspaceFactory;
    protected openFileMap = new Map<string, TextDocument>();
    protected cacheManager: CacheManager;
    protected fs: PyrightFileSystem;
    protected uriParser: UriParser;

    constructor(
        protected serverOptions: ServerOptions,
        protected connection: Connection,
        readonly console: ConsoleInterface,
        uriParserFactory = (fs: FileSystem) => new UriParser(fs)
    ) {
        // Stash the base directory into a global variable.
        // This must happen before fs.getModulePath().
        (global as any).__rootDirectory = serverOptions.rootDirectory;

        this.console.info(
            `${serverOptions.productName} language server ${
                serverOptions.version && serverOptions.version + ' '
            }starting`
        );

        this.console.info(`Server root directory: ${serverOptions.rootDirectory}`);

        this.cacheManager = new CacheManager();

        this.fs = new PyrightFileSystem(this.serverOptions.fileSystem);
        this.uriParser = uriParserFactory(this.fs);

        this.workspaceFactory = new WorkspaceFactory(
            this.console,
            this.uriParser,
            /* isWeb */ false,
            this.createAnalyzerServiceForWorkspace.bind(this),
            this.isPythonPathImmutable.bind(this),
            this.onWorkspaceCreated.bind(this)
        );

        // Set the working directory to a known location within
        // the extension directory. Otherwise the execution of
        // python can have unintended and surprising results.
        const moduleDirectory = this.fs.getModulePath();
        if (moduleDirectory && this.fs.existsSync(moduleDirectory)) {
            this.fs.chdir(moduleDirectory);
        }

        // Set up callbacks.
        this.setupConnection(serverOptions.supportedCommands ?? [], serverOptions.supportedCodeActions ?? []);

        this._progressReporter = new ProgressReportTracker(this.createProgressReporter());

        // Listen on the connection.
        this.connection.listen();

        // Setup extensions
        Extensions.createLanguageServiceExtensions(this);
    }

    // Provides access to the client's window.
    get window(): RemoteWindow {
        return this.connection.window;
    }

    get supportAdvancedEdits(): boolean {
        return this.client.hasDocumentChangeCapability && this.client.hasDocumentAnnotationCapability;
    }

    // Convert uri to path
    decodeTextDocumentUri(uriString: string): string {
        return this.uriParser.decodeTextDocumentUri(uriString);
    }

    abstract createBackgroundAnalysis(serviceId: string): BackgroundAnalysisBase | undefined;

    abstract getSettings(workspace: Workspace): Promise<ServerSettings>;

    // Creates a service instance that's used for analyzing a
    // program within a workspace.
    createAnalyzerService(
        name: string,
        services?: WorkspaceServices,
        libraryReanalysisTimeProvider?: () => number
    ): AnalyzerService {
        this.console.info(`Starting service instance "${name}"`);

        const serviceId = getNextServiceId(name);
        const service = new AnalyzerService(name, services?.fs ?? this.fs, {
            console: this.console,
            hostFactory: this.createHost.bind(this),
            importResolverFactory: this.createImportResolver.bind(this),
            backgroundAnalysis: services ? services.backgroundAnalysis : this.createBackgroundAnalysis(serviceId),
            maxAnalysisTime: this.serverOptions.maxAnalysisTimeInForeground,
            backgroundAnalysisProgramFactory: this.createBackgroundAnalysisProgram.bind(this),
            cancellationProvider: this.serverOptions.cancellationProvider,
            libraryReanalysisTimeProvider,
            cacheManager: this.cacheManager,
            serviceId,
        });

        service.setCompletionCallback((results) => this.onAnalysisCompletedHandler(service.fs, results));
        return service;
    }

    async getWorkspaces(): Promise<Workspace[]> {
        const workspaces = [...this.workspaceFactory.items()];
        for (const workspace of workspaces) {
            await workspace.isInitialized.promise;
        }

        return workspaces;
    }

    async getWorkspaceForFile(filePath: string, pythonPath?: string): Promise<Workspace> {
        return this.workspaceFactory.getWorkspaceForFile(filePath, pythonPath);
    }

    async getContainingWorkspacesForFile(filePath: string): Promise<Workspace[]> {
        return this.workspaceFactory.getContainingWorkspacesForFile(filePath);
    }

    reanalyze() {
        this.workspaceFactory.items().forEach((workspace) => {
            workspace.service.invalidateAndForceReanalysis(InvalidatedReason.Reanalyzed);
        });
    }

    restart() {
        this.workspaceFactory.items().forEach((workspace) => {
            workspace.service.restart();
        });
    }

    updateSettingsForAllWorkspaces(): void {
        const tasks: Promise<void>[] = [];
        this.workspaceFactory.items().forEach((workspace) => {
            // Updating settings can change workspace's file ownership. Make workspace uninitialized so that
            // features can wait until workspace gets new settings.
            // the file's ownership can also changed by `pyrightconfig.json` changes, but those are synchronous
            // operation, so it won't affect this.
            workspace.isInitialized = workspace.isInitialized.reset();
            tasks.push(this.updateSettingsForWorkspace(workspace, workspace.isInitialized));
        });

        Promise.all(tasks).then(() => {
            this._setupFileWatcher();
        });
    }

    async updateSettingsForWorkspace(
        workspace: Workspace,
        status: InitStatus | undefined,
        serverSettings?: ServerSettings
    ): Promise<void> {
        status?.markCalled();

        serverSettings = serverSettings ?? (await this.getSettings(workspace));

        // Set logging level first.
        (this.console as ConsoleWithLogLevel).level = serverSettings.logLevel ?? LogLevel.Info;

        // Apply the new path to the workspace (before restarting the service).
        serverSettings.pythonPath = this.workspaceFactory.applyPythonPath(workspace, serverSettings.pythonPath);

        // Then use the updated settings to restart the service.
        this.updateOptionsAndRestartService(workspace, serverSettings);

        workspace.disableLanguageServices = !!serverSettings.disableLanguageServices;
        workspace.disableOrganizeImports = !!serverSettings.disableOrganizeImports;

        // Don't use workspace.isInitialized directly since it might have been
        // reset due to pending config change event.
        // The workspace is now open for business.
        status?.resolve();
    }

    updateOptionsAndRestartService(
        workspace: Workspace,
        serverSettings: ServerSettings,
        typeStubTargetImportName?: string
    ) {
        AnalyzerServiceExecutor.runWithOptions(this.rootPath, workspace, serverSettings, typeStubTargetImportName);
        workspace.searchPathsToWatch = workspace.service.librarySearchPathsToWatch ?? [];
    }

    protected abstract executeCommand(params: ExecuteCommandParams, token: CancellationToken): Promise<any>;

    protected abstract isLongRunningCommand(command: string): boolean;

    protected abstract executeCodeAction(
        params: CodeActionParams,
        token: CancellationToken
    ): Promise<(Command | CodeAction)[] | undefined | null>;

    protected isPythonPathImmutable(filePath: string): boolean {
        // This function is called to determine if the file is using
        // a special pythonPath separate from a workspace or not.
        // The default is no.
        return false;
    }

    protected async getConfiguration(scopeUri: string | undefined, section: string) {
        if (this.client.hasConfigurationCapability) {
            const item: ConfigurationItem = {};
            if (scopeUri !== undefined) {
                item.scopeUri = scopeUri;
            }
            if (section !== undefined) {
                item.section = section;
            }
            return this.connection.workspace.getConfiguration(item);
        }

        if (this.defaultClientConfig) {
            return getNestedProperty(this.defaultClientConfig, section);
        }

        return undefined;
    }

    protected isOpenFilesOnly(diagnosticMode: string): boolean {
        return diagnosticMode !== 'workspace';
    }

    protected getSeverityOverrides(value: string): DiagnosticSeverityOverrides | undefined {
        const enumValue = value as DiagnosticSeverityOverrides;
        if (getDiagnosticSeverityOverrides().includes(enumValue)) {
            return enumValue;
        }

        return undefined;
    }

    protected getDiagnosticRuleName(value: string): DiagnosticRule | undefined {
        const enumValue = value as DiagnosticRule;
        if (getDiagLevelDiagnosticRules().includes(enumValue)) {
            return enumValue;
        }

        return undefined;
    }

    protected abstract createHost(): Host;
    protected abstract createImportResolver(fs: FileSystem, options: ConfigOptions, host: Host): ImportResolver;

    protected createBackgroundAnalysisProgram(
        serviceId: string,
        console: ConsoleInterface,
        configOptions: ConfigOptions,
        importResolver: ImportResolver,
        backgroundAnalysis?: BackgroundAnalysisBase,
        maxAnalysisTime?: MaxAnalysisTime,
        cacheManager?: CacheManager
    ): BackgroundAnalysisProgram {
        return new BackgroundAnalysisProgram(
            serviceId,
            console,
            configOptions,
            importResolver,
            backgroundAnalysis,
            maxAnalysisTime,
            /* disableChecker */ undefined,
            cacheManager
        );
    }

    protected setupConnection(supportedCommands: string[], supportedCodeActions: string[]): void {
        // After the server has started the client sends an initialize request. The server receives
        // in the passed params the rootPath of the workspace plus the client capabilities.
        this.connection.onInitialize((params) => this.initialize(params, supportedCommands, supportedCodeActions));

        this.connection.onInitialized(() => this.onInitialized());

        this.connection.onDidChangeConfiguration((params) => this.onDidChangeConfiguration(params));

        this.connection.onCodeAction((params, token) => this.executeCodeAction(params, token));

        this.connection.onDefinition(async (params, token) => this.onDefinition(params, token));
        this.connection.onDeclaration(async (params, token) => this.onDeclaration(params, token));
        this.connection.onTypeDefinition(async (params, token) => this.onTypeDefinition(params, token));

        this.connection.onReferences(async (params, token, workDoneReporter, resultReporter) =>
            this.onReferences(params, token, workDoneReporter, resultReporter)
        );

        this.connection.onDocumentSymbol(async (params, token) => this.onDocumentSymbol(params, token));
        this.connection.onWorkspaceSymbol(async (params, token, _, resultReporter) =>
            this.onWorkspaceSymbol(params, token, resultReporter)
        );

        this.connection.onHover(async (params, token) => this.onHover(params, token));

        this.connection.onDocumentHighlight(async (params, token) => this.onDocumentHighlight(params, token));

        this.connection.onSignatureHelp(async (params, token) => this.onSignatureHelp(params, token));

        this.connection.onCompletion((params, token) => this.onCompletion(params, token));
        this.connection.onCompletionResolve(async (params, token) => this.onCompletionResolve(params, token));

        this.connection.onPrepareRename(async (params, token) => this.onPrepareRenameRequest(params, token));
        this.connection.onRenameRequest(async (params, token) => this.onRenameRequest(params, token));

        const callHierarchy = this.connection.languages.callHierarchy;
        callHierarchy.onPrepare(async (params, token) => this.onPrepare(params, token));
        callHierarchy.onIncomingCalls(async (params, token) => this.onIncomingCalls(params, token));
        callHierarchy.onOutgoingCalls(async (params, token) => this.onOutgoingCalls(params, token));

        this.connection.onDidOpenTextDocument(async (params) => this.onDidOpenTextDocument(params));
        this.connection.onDidChangeTextDocument(async (params) => this.onDidChangeTextDocument(params));
        this.connection.onDidCloseTextDocument(async (params) => this.onDidCloseTextDocument(params));
        this.connection.onDidChangeWatchedFiles((params) => this.onDidChangeWatchedFiles(params));

        this.connection.onExecuteCommand(async (params, token, reporter) =>
            this.onExecuteCommand(params, token, reporter)
        );
        this.connection.onShutdown(async (token) => this.onShutdown(token));
    }

    protected initialize(
        params: InitializeParams,
        supportedCommands: string[],
        supportedCodeActions: string[]
    ): InitializeResult {
        if (params.locale) {
            setLocaleOverride(params.locale);
        }

        this.rootPath = params.rootPath || '';

        const capabilities = params.capabilities;
        this.client.hasConfigurationCapability = !!capabilities.workspace?.configuration;
        this.client.hasWatchFileCapability = !!capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration;
        this.client.hasWatchFileRelativePathCapability =
            !!capabilities.workspace?.didChangeWatchedFiles?.relativePatternSupport;
        this.client.hasWorkspaceFoldersCapability = !!capabilities.workspace?.workspaceFolders;
        this.client.hasVisualStudioExtensionsCapability = !!(capabilities as any)._vs_supportsVisualStudioExtensions;
        this.client.hasActiveParameterCapability =
            !!capabilities.textDocument?.signatureHelp?.signatureInformation?.activeParameterSupport;
        this.client.hasSignatureLabelOffsetCapability =
            !!capabilities.textDocument?.signatureHelp?.signatureInformation?.parameterInformation?.labelOffsetSupport;
        this.client.hasHierarchicalDocumentSymbolCapability =
            !!capabilities.textDocument?.documentSymbol?.hierarchicalDocumentSymbolSupport;
        this.client.hasDocumentChangeCapability =
            !!capabilities.workspace?.workspaceEdit?.documentChanges &&
            !!capabilities.workspace.workspaceEdit?.resourceOperations;
        this.client.hasDocumentAnnotationCapability = !!capabilities.workspace?.workspaceEdit?.changeAnnotationSupport;
        this.client.hasCompletionCommitCharCapability =
            !!capabilities.textDocument?.completion?.completionList?.itemDefaults &&
            !!capabilities.textDocument.completion.completionItem?.commitCharactersSupport;

        this.client.hoverContentFormat = this._getCompatibleMarkupKind(capabilities.textDocument?.hover?.contentFormat);
        this.client.completionDocFormat = this._getCompatibleMarkupKind(
            capabilities.textDocument?.completion?.completionItem?.documentationFormat
        );
        this.client.completionSupportsSnippet = !!capabilities.textDocument?.completion?.completionItem?.snippetSupport;
        this.client.signatureDocFormat = this._getCompatibleMarkupKind(
            capabilities.textDocument?.signatureHelp?.signatureInformation?.documentationFormat
        );
        const supportedDiagnosticTags = capabilities.textDocument?.publishDiagnostics?.tagSupport?.valueSet || [];
        this.client.supportsUnnecessaryDiagnosticTag = supportedDiagnosticTags.some(
            (tag) => tag === DiagnosticTag.Unnecessary
        );
        this.client.supportsDeprecatedDiagnosticTag = supportedDiagnosticTags.some(
            (tag) => tag === DiagnosticTag.Deprecated
        );
        // if the client is running in VS, it always supports task item diagnostics
        this.client.supportsTaskItemDiagnosticTag = this.client.hasVisualStudioExtensionsCapability;
        this.client.hasWindowProgressCapability = !!capabilities.window?.workDoneProgress;
        this.client.hasGoToDeclarationCapability = !!capabilities.textDocument?.declaration;
        this.client.completionItemResolveSupportsAdditionalTextEdits =
            !!capabilities.textDocument?.completion?.completionItem?.resolveSupport?.properties.some(
                (p) => p === 'additionalTextEdits'
            );

        // Create a service instance for each of the workspace folders.
        this.workspaceFactory.handleInitialize(params);

        const result: InitializeResult = {
            capabilities: {
                textDocumentSync: TextDocumentSyncKind.Incremental,
                definitionProvider: { workDoneProgress: true },
                declarationProvider: { workDoneProgress: true },
                typeDefinitionProvider: { workDoneProgress: true },
                referencesProvider: { workDoneProgress: true },
                documentSymbolProvider: { workDoneProgress: true },
                workspaceSymbolProvider: { workDoneProgress: true },
                hoverProvider: { workDoneProgress: true },
                documentHighlightProvider: { workDoneProgress: true },
                renameProvider: { prepareProvider: true, workDoneProgress: true },
                completionProvider: {
                    triggerCharacters: this.client.hasVisualStudioExtensionsCapability
                        ? ['.', '[', '@', '"', "'"]
                        : ['.', '[', '"', "'"],
                    resolveProvider: true,
                    workDoneProgress: true,
                    completionItem: {
                        labelDetailsSupport: true,
                    },
                },
                signatureHelpProvider: {
                    triggerCharacters: ['(', ',', ')'],
                    workDoneProgress: true,
                },
                codeActionProvider: {
                    codeActionKinds: supportedCodeActions,
                    workDoneProgress: true,
                },
                executeCommandProvider: {
                    commands: supportedCommands,
                    workDoneProgress: true,
                },
                callHierarchyProvider: true,
                workspace: {
                    workspaceFolders: {
                        supported: true,
                        changeNotifications: true,
                    },
                },
            },
        };

        return result;
    }

    protected onInitialized() {
        // Mark as initialized. We need this to make sure to
        // not send config updates before this point.
        this._initialized = true;

        if (!this.client.hasWorkspaceFoldersCapability) {
            // If folder capability is not supported, initialize ones given by onInitialize.
            this.updateSettingsForAllWorkspaces();
            return;
        }

        this.connection.workspace.onDidChangeWorkspaceFolders((event) => {
            this.workspaceFactory.handleWorkspaceFoldersChanged(event);
            this._setupFileWatcher();
        });

        this._setupFileWatcher();
    }

    protected onDidChangeConfiguration(params: DidChangeConfigurationParams) {
        this.console.log(`Received updated settings`);
        if (params?.settings) {
            this.defaultClientConfig = params?.settings;
        }
        this.updateSettingsForAllWorkspaces();
    }

    protected async onDefinition(
        params: TextDocumentPositionParams,
        token: CancellationToken
    ): Promise<Definition | DefinitionLink[] | undefined | null> {
        return this.getDefinitions(
            params,
            token,
            this.client.hasGoToDeclarationCapability ? DefinitionFilter.PreferSource : DefinitionFilter.All,
            (workspace, filePath, position, filter, token) =>
                workspace.service.run((program) => {
                    return new DefinitionProvider(program, filePath, position, filter, token).getDefinitions();
                }, token)
        );
    }

    protected async onDeclaration(
        params: TextDocumentPositionParams,
        token: CancellationToken
    ): Promise<Declaration | DeclarationLink[] | undefined | null> {
        return this.getDefinitions(
            params,
            token,
            this.client.hasGoToDeclarationCapability ? DefinitionFilter.PreferStubs : DefinitionFilter.All,
            (workspace, filePath, position, filter, token) =>
                workspace.service.run((program) => {
                    return new DefinitionProvider(program, filePath, position, filter, token).getDefinitions();
                }, token)
        );
    }

    protected async onTypeDefinition(
        params: TextDocumentPositionParams,
        token: CancellationToken
    ): Promise<Definition | DefinitionLink[] | undefined | null> {
        return this.getDefinitions(params, token, DefinitionFilter.All, (workspace, filePath, position, _, token) =>
            workspace.service.run((program) => {
                return new TypeDefinitionProvider(program, filePath, position, token).getDefinitions();
            }, token)
        );
    }

    protected async getDefinitions(
        params: TextDocumentPositionParams,
        token: CancellationToken,
        filter: DefinitionFilter,
        getDefinitionsFunc: (
            workspace: Workspace,
            filePath: string,
            position: Position,
            filter: DefinitionFilter,
            token: CancellationToken
        ) => DocumentRange[] | undefined
    ) {
        this.recordUserInteractionTime();

        const { filePath, position } = this.uriParser.decodeTextDocumentPosition(params.textDocument, params.position);

        const workspace = await this.getWorkspaceForFile(filePath);
        if (workspace.disableLanguageServices) {
            return undefined;
        }

        const locations = getDefinitionsFunc(workspace, filePath, position, filter, token);
        if (!locations) {
            return undefined;
        }
        return locations
            .filter((loc) => this.canNavigateToFile(loc.path, workspace.service.fs))
            .map((loc) => Location.create(convertPathToUri(workspace.service.fs, loc.path), loc.range));
    }

    protected async onReferences(
        params: ReferenceParams,
        token: CancellationToken,
        workDoneReporter: WorkDoneProgressReporter,
        resultReporter: ResultProgressReporter<Location[]> | undefined
    ): Promise<Location[] | null | undefined> {
        if (this._pendingFindAllRefsCancellationSource) {
            this._pendingFindAllRefsCancellationSource.cancel();
            this._pendingFindAllRefsCancellationSource = undefined;
        }

        // VS Code doesn't support cancellation of "final all references".
        // We provide a progress bar a cancellation button so the user can cancel
        // any long-running actions.
        const progress = await this._getProgressReporter(
            workDoneReporter,
            Localizer.CodeAction.findingReferences(),
            token
        );

        const source = progress.source;
        this._pendingFindAllRefsCancellationSource = source;

        try {
            const { filePath, position } = this.uriParser.decodeTextDocumentPosition(
                params.textDocument,
                params.position
            );

            const workspace = await this.getWorkspaceForFile(filePath);
            if (workspace.disableLanguageServices) {
                return;
            }

            return workspace.service.run((program) => {
                return new ReferencesProvider(program, source.token).reportReferences(
                    filePath,
                    position,
                    params.context.includeDeclaration,
                    resultReporter
                );
            }, token);
        } finally {
            progress.reporter.done();
            source.dispose();
        }
    }

    protected async onDocumentSymbol(
        params: DocumentSymbolParams,
        token: CancellationToken
    ): Promise<DocumentSymbol[] | SymbolInformation[] | null | undefined> {
        this.recordUserInteractionTime();

        const filePath = this.uriParser.decodeTextDocumentUri(params.textDocument.uri);
        const workspace = await this.getWorkspaceForFile(filePath);
        if (workspace.disableLanguageServices) {
            return undefined;
        }

        return workspace.service.run((program) => {
            return new DocumentSymbolProvider(
                program,
                filePath,
                this.client.hasHierarchicalDocumentSymbolCapability,
                token
            ).getSymbols();
        }, token);
    }

    protected onWorkspaceSymbol(
        params: WorkspaceSymbolParams,
        token: CancellationToken,
        resultReporter: ResultProgressReporter<SymbolInformation[]> | undefined
    ): Promise<SymbolInformation[] | WorkspaceSymbol[] | null | undefined> {
        const result = new WorkspaceSymbolProvider(
            this.workspaceFactory.items(),
            resultReporter,
            params.query,
            token
        ).reportSymbols();

        return Promise.resolve(result);
    }

    protected async onHover(params: HoverParams, token: CancellationToken) {
        const { filePath, position } = this.uriParser.decodeTextDocumentPosition(params.textDocument, params.position);
        const workspace = await this.getWorkspaceForFile(filePath);

        return workspace.service.run((program) => {
            return new HoverProvider(program, filePath, position, this.client.hoverContentFormat, token).getHover();
        }, token);
    }

    protected async onDocumentHighlight(
        params: DocumentHighlightParams,
        token: CancellationToken
    ): Promise<DocumentHighlight[] | null | undefined> {
        const { filePath, position } = this.uriParser.decodeTextDocumentPosition(params.textDocument, params.position);
        const workspace = await this.getWorkspaceForFile(filePath);

        return workspace.service.run((program) => {
            return new DocumentHighlightProvider(program, filePath, position, token).getDocumentHighlight();
        }, token);
    }

    protected async onSignatureHelp(
        params: SignatureHelpParams,
        token: CancellationToken
    ): Promise<SignatureHelp | undefined | null> {
        const { filePath, position } = this.uriParser.decodeTextDocumentPosition(params.textDocument, params.position);

        const workspace = await this.getWorkspaceForFile(filePath);
        if (workspace.disableLanguageServices) {
            return;
        }

        return workspace.service.run((program) => {
            return new SignatureHelpProvider(
                program,
                filePath,
                position,
                this.client.signatureDocFormat,
                this.client.hasSignatureLabelOffsetCapability,
                this.client.hasActiveParameterCapability,
                params.context,
                token
            ).getSignatureHelp();
        }, token);
    }

    protected setCompletionIncomplete(params: CompletionParams, completions: CompletionList | null) {
        // We set completion incomplete for the first invocation and next consecutive call,
        // but after that we mark it as completed so the client doesn't repeatedly call back.
        // We mark the first one as incomplete because completion could be invoked without
        // any meaningful character provided, such as an explicit completion invocation (ctrl+space)
        // or a period. That might cause us to not include some items (e.g., auto-imports).
        // The next consecutive call provides some characters to help us to pick
        // better completion items. After that, we are not going to introduce new items,
        // so we can let the client to do the filtering and caching.
        const completionIncomplete =
            this._lastTriggerKind !== CompletionTriggerKind.TriggerForIncompleteCompletions ||
            params.context?.triggerKind !== CompletionTriggerKind.TriggerForIncompleteCompletions;

        this._lastTriggerKind = params.context?.triggerKind;

        if (completions) {
            completions.isIncomplete = completionIncomplete;
        }
    }

    protected async onCompletion(params: CompletionParams, token: CancellationToken): Promise<CompletionList | null> {
        const { filePath, position } = this.uriParser.decodeTextDocumentPosition(params.textDocument, params.position);
        const workspace = await this.getWorkspaceForFile(filePath);
        if (workspace.disableLanguageServices) {
            return null;
        }

        return workspace.service.run((program) => {
            const completions = new CompletionProvider(
                program,
                workspace.rootPath,
                filePath,
                position,
                {
                    format: this.client.completionDocFormat,
                    snippet: this.client.completionSupportsSnippet,
                    lazyEdit: false,
                    triggerCharacter: params?.context?.triggerCharacter,
                },
                token
            ).getCompletions();

            this.setCompletionIncomplete(params, completions);
            return completions;
        }, token);
    }

    // Cancellation bugs in vscode and LSP:
    // https://github.com/microsoft/vscode-languageserver-node/issues/615
    // https://github.com/microsoft/vscode/issues/95485
    //
    // If resolver throws cancellation exception, LSP and VSCode
    // cache that result and never call us back.
    protected async onCompletionResolve(params: CompletionItem, token: CancellationToken): Promise<CompletionItem> {
        const completionItemData = fromLSPAny<CompletionItemData>(params.data);
        if (completionItemData && completionItemData.filePath) {
            const workspace = await this.getWorkspaceForFile(completionItemData.filePath);
            workspace.service.run((program) => {
                return new CompletionProvider(
                    program,
                    workspace.rootPath,
                    completionItemData.filePath,
                    completionItemData.position,
                    {
                        format: this.client.completionDocFormat,
                        snippet: this.client.completionSupportsSnippet,
                        lazyEdit: false,
                    },
                    token
                ).resolveCompletionItem(params);
            }, token);
        }
        return params;
    }

    protected async onPrepareRenameRequest(
        params: PrepareRenameParams,
        token: CancellationToken
    ): Promise<Range | { range: Range; placeholder: string } | null> {
        const { filePath, position } = this.uriParser.decodeTextDocumentPosition(params.textDocument, params.position);
        const isUntitled = this.uriParser.isUntitled(params.textDocument.uri);

        const workspace = await this.getWorkspaceForFile(filePath);
        if (workspace.disableLanguageServices) {
            return null;
        }

        return workspace.service.run((program) => {
            return new RenameProvider(program, filePath, position, token).canRenameSymbol(
                workspace.kinds.includes(WellKnownWorkspaceKinds.Default),
                isUntitled
            );
        }, token);
    }

    protected async onRenameRequest(
        params: RenameParams,
        token: CancellationToken
    ): Promise<WorkspaceEdit | null | undefined> {
        const { filePath, position } = this.uriParser.decodeTextDocumentPosition(params.textDocument, params.position);
        const isUntitled = this.uriParser.isUntitled(params.textDocument.uri);

        const workspace = await this.getWorkspaceForFile(filePath);
        if (workspace.disableLanguageServices) {
            return;
        }

        return workspace.service.run((program) => {
            return new RenameProvider(program, filePath, position, token).renameSymbol(
                params.newName,
                workspace.kinds.includes(WellKnownWorkspaceKinds.Default),
                isUntitled
            );
        }, token);
    }

    protected async onPrepare(
        params: CallHierarchyPrepareParams,
        token: CancellationToken
    ): Promise<CallHierarchyItem[] | null> {
        const { filePath, position } = this.uriParser.decodeTextDocumentPosition(params.textDocument, params.position);

        const workspace = await this.getWorkspaceForFile(filePath);
        if (workspace.disableLanguageServices) {
            return null;
        }

        return workspace.service.run((program) => {
            return new CallHierarchyProvider(program, filePath, position, token).onPrepare();
        }, token);
    }

    protected async onIncomingCalls(params: CallHierarchyIncomingCallsParams, token: CancellationToken) {
        const { filePath, position } = this.uriParser.decodeTextDocumentPosition(params.item, params.item.range.start);

        const workspace = await this.getWorkspaceForFile(filePath);
        if (workspace.disableLanguageServices) {
            return null;
        }

        return workspace.service.run((program) => {
            return new CallHierarchyProvider(program, filePath, position, token).getIncomingCalls();
        }, token);
    }

    protected async onOutgoingCalls(
        params: CallHierarchyOutgoingCallsParams,
        token: CancellationToken
    ): Promise<CallHierarchyOutgoingCall[] | null> {
        const { filePath, position } = this.uriParser.decodeTextDocumentPosition(params.item, params.item.range.start);

        const workspace = await this.getWorkspaceForFile(filePath);
        if (workspace.disableLanguageServices) {
            return null;
        }

        return workspace.service.run((program) => {
            return new CallHierarchyProvider(program, filePath, position, token).getOutgoingCalls();
        }, token);
    }

    protected async onDidOpenTextDocument(params: DidOpenTextDocumentParams, ipythonMode = IPythonMode.None) {
        const filePath = this.uriParser.decodeTextDocumentUri(params.textDocument.uri);

        if (!this.fs.addUriMap(params.textDocument.uri, filePath)) {
            // We do not support opening 1 file with 2 different uri.
            return;
        }

        let doc = this.openFileMap.get(filePath);
        if (doc) {
            // We shouldn't get an open text document request for an already-opened doc.
            this.console.error(`Received redundant open text document command for ${filePath}`);
            doc = TextDocument.update(doc, [{ text: params.textDocument.text }], params.textDocument.version);
        } else {
            doc = TextDocument.create(filePath, 'python', params.textDocument.version, params.textDocument.text);
        }
        this.openFileMap.set(filePath, doc);

        // Send this open to all the workspaces that might contain this file.
        const workspaces = await this.getContainingWorkspacesForFile(filePath);
        workspaces.forEach((w) => {
            w.service.setFileOpened(filePath, params.textDocument.version, params.textDocument.text, ipythonMode);
        });
    }

    protected async onDidChangeTextDocument(params: DidChangeTextDocumentParams, ipythonMode = IPythonMode.None) {
        this.recordUserInteractionTime();

        const filePath = this.uriParser.decodeTextDocumentUri(params.textDocument.uri);
        if (!this.fs.hasUriMapEntry(params.textDocument.uri, filePath)) {
            // We do not support opening 1 file with 2 different uri.
            return;
        }

        let doc = this.openFileMap.get(filePath);
        if (!doc) {
            // We shouldn't get a change text request for a closed doc.
            this.console.error(`Received change text document command for closed file ${filePath}`);
            return;
        }

        doc = TextDocument.update(doc, params.contentChanges, params.textDocument.version);
        this.openFileMap.set(filePath, doc);
        const newContents = doc.getText();

        // Send this change to all the workspaces that might contain this file.
        const workspaces = await this.getContainingWorkspacesForFile(filePath);
        workspaces.forEach((w) => {
            w.service.updateOpenFileContents(filePath, params.textDocument.version, newContents, ipythonMode);
        });
    }

    protected async onDidCloseTextDocument(params: DidCloseTextDocumentParams) {
        const filePath = this.uriParser.decodeTextDocumentUri(params.textDocument.uri);
        if (!this.fs.removeUriMap(params.textDocument.uri, filePath)) {
            // We do not support opening 1 file with 2 different uri.
            return;
        }

        // Send this close to all the workspaces that might contain this file.
        const workspaces = await this.getContainingWorkspacesForFile(filePath);
        workspaces.forEach((w) => {
            w.service.setFileClosed(filePath);
        });

        this.openFileMap.delete(filePath);
    }

    protected onDidChangeWatchedFiles(params: DidChangeWatchedFilesParams) {
        params.changes.forEach((change) => {
            const filePath = this.fs.realCasePath(this.uriParser.decodeTextDocumentUri(change.uri));
            const eventType: FileWatcherEventType = change.type === 1 ? 'add' : 'change';
            this.serverOptions.fileWatcherHandler.onFileChange(eventType, filePath);
        });
    }

    protected async onExecuteCommand(
        params: ExecuteCommandParams,
        token: CancellationToken,
        reporter: WorkDoneProgressReporter
    ) {
        // Cancel running command if there is one.
        if (this._pendingCommandCancellationSource) {
            this._pendingCommandCancellationSource.cancel();
            this._pendingCommandCancellationSource = undefined;
        }

        const executeCommand = async (token: CancellationToken) => {
            const result = await this.executeCommand(params, token);
            if (WorkspaceEdit.is(result)) {
                // Tell client to apply edits.
                // Do not await; the client isn't expecting a result.
                this.connection.workspace.applyEdit({ label: `Command '${params.command}'`, edit: result });
            }

            if (CommandResult.is(result)) {
                // Tell client to apply edits.
                // Await so that we return after the edit is complete.
                await this.connection.workspace.applyEdit({ label: result.label, edit: result.edits });
            }

            return result;
        };

        if (this.isLongRunningCommand(params.command)) {
            // Create a progress dialog for long-running commands.
            const progress = await this._getProgressReporter(reporter, Localizer.CodeAction.executingCommand(), token);

            const source = progress.source;
            this._pendingCommandCancellationSource = source;

            try {
                const result = await executeCommand(source.token);
                return result;
            } finally {
                progress.reporter.done();
                source.dispose();
            }
        } else {
            const result = await executeCommand(token);
            return result;
        }
    }

    protected onShutdown(token: CancellationToken) {
        // Shutdown remaining workspaces.
        this.workspaceFactory.clear();

        // Stop tracking all open files.
        this.openFileMap.clear();

        return Promise.resolve();
    }

    protected convertDiagnostics(fs: FileSystem, fileDiagnostics: FileDiagnostics): PublishDiagnosticsParams[] {
        return [
            {
                uri: convertPathToUri(fs, fileDiagnostics.filePath),
                version: fileDiagnostics.version,
                diagnostics: this._convertDiagnostics(fs, fileDiagnostics.diagnostics),
            },
        ];
    }

    protected onAnalysisCompletedHandler(fs: FileSystem, results: AnalysisResults): void {
        // Send the computed diagnostics to the client.
        results.diagnostics.forEach((fileDiag) => {
            if (!this.canNavigateToFile(fileDiag.filePath, fs)) {
                return;
            }

            this._sendDiagnostics(this.convertDiagnostics(fs, fileDiag));
            this.fs.pendingRequest(fileDiag.filePath, fileDiag.diagnostics.length > 0);
        });

        if (!this._progressReporter.isEnabled(results)) {
            // Make sure to disable progress bar if it is currently active.
            // This can happen if a user changes typeCheckingMode in the middle
            // of analysis.
            // end() is noop if there is no active progress bar.
            this._progressReporter.end();
            return;
        }

        // Update progress.
        if (results.filesRequiringAnalysis > 0) {
            this._progressReporter.begin();

            const progressMessage =
                results.filesRequiringAnalysis === 1
                    ? Localizer.CodeAction.filesToAnalyzeOne()
                    : Localizer.CodeAction.filesToAnalyzeCount().format({
                          count: results.filesRequiringAnalysis,
                      });
            this._progressReporter.report(progressMessage);
        } else {
            this._progressReporter.end();
        }
    }

    protected onWorkspaceCreated(workspace: Workspace) {
        // Update settings on this workspace (but only if initialize has happened)
        if (this._initialized) {
            this.updateSettingsForWorkspace(workspace, workspace.isInitialized).ignoreErrors();
        }

        // Otherwise the initialize completion should cause settings to be updated on all workspaces.
    }

    protected createAnalyzerServiceForWorkspace(
        name: string,
        _rootPath: string,
        _uri: string,
        kinds: string[],
        services?: WorkspaceServices
    ): AnalyzerService {
        // 5 seconds default
        const defaultBackOffTime = 5 * 1000;

        // 10 seconds back off for multi workspace.
        const multiWorkspaceBackOffTime = 10 * 1000;

        const libraryReanalysisTimeProvider =
            kinds.length === 1 && kinds[0] === WellKnownWorkspaceKinds.Regular
                ? () =>
                      this.workspaceFactory.hasMultipleWorkspaces(kinds[0])
                          ? multiWorkspaceBackOffTime
                          : defaultBackOffTime
                : () => defaultBackOffTime;

        return this.createAnalyzerService(name, services, libraryReanalysisTimeProvider);
    }

    protected recordUserInteractionTime() {
        // Tell all of the services that the user is actively
        // interacting with one or more editors, so they should
        // back off from performing any work.
        this.workspaceFactory.items().forEach((workspace: { service: { recordUserInteractionTime: () => void } }) => {
            workspace.service.recordUserInteractionTime();
        });
    }

    protected getDocumentationUrlForDiagnosticRule(rule: string): string | undefined {
        // Configuration.md is configured to have a link for every rule name.
        return `https://github.com/microsoft/pyright/blob/main/docs/configuration.md#${rule}`;
    }

    protected abstract createProgressReporter(): ProgressReporter;

    protected canNavigateToFile(path: string, fs: FileSystem): boolean {
        return canNavigateToFile(fs, path);
    }

    private _setupFileWatcher() {
        if (!this.client.hasWatchFileCapability) {
            return;
        }

        const watchKind = WatchKind.Create | WatchKind.Change | WatchKind.Delete;

        // Set default (config files and all workspace files) first.
        const watchers: FileSystemWatcher[] = [
            ...configFileNames.map((fileName) => ({ globPattern: `**/${fileName}`, kind: watchKind })),
            { globPattern: '**', kind: watchKind },
        ];

        // Add all python search paths to watch list
        if (this.client.hasWatchFileRelativePathCapability) {
            // Dedup search paths from all workspaces.
            // Get rid of any search path under workspace root since it is already watched by
            // "**" above.
            const foldersToWatch = deduplicateFolders(
                this.workspaceFactory
                    .getNonDefaultWorkspaces()
                    .map((w) => w.searchPathsToWatch.filter((p) => !p.startsWith(w.rootPath)))
            );

            foldersToWatch.forEach((p) => {
                const globPattern = isFile(this.fs, p, /* treatZipDirectoryAsFile */ true)
                    ? { baseUri: convertPathToUri(this.fs, getDirectoryPath(p)), pattern: getFileName(p) }
                    : { baseUri: convertPathToUri(this.fs, p), pattern: '**' };

                watchers.push({ globPattern, kind: watchKind });
            });
        }

        // File watcher is pylance wide service. Dispose all existing file watchers and create new ones.
        this.connection.client.register(DidChangeWatchedFilesNotification.type, { watchers }).then((d) => {
            if (this._lastFileWatcherRegistration) {
                this._lastFileWatcherRegistration.dispose();
            }

            this._lastFileWatcherRegistration = d;
        });
    }

    private _sendDiagnostics(params: PublishDiagnosticsParams[]) {
        for (const param of params) {
            this.connection.sendDiagnostics(param);
        }
    }

    private _getCompatibleMarkupKind(clientSupportedFormats: MarkupKind[] | undefined) {
        const serverSupportedFormats = [MarkupKind.PlainText, MarkupKind.Markdown];

        for (const format of clientSupportedFormats ?? []) {
            if (serverSupportedFormats.includes(format)) {
                return format;
            }
        }

        return MarkupKind.PlainText;
    }

    private async _getProgressReporter(reporter: WorkDoneProgressReporter, title: string, token: CancellationToken) {
        // This is a bit ugly, but we need to determine whether the provided reporter
        // is an actual client-side progress reporter or a dummy (null) progress reporter
        // created by the LSP library. If it's the latter, we'll create a server-initiated
        // progress reporter.
        if (reporter.constructor !== nullProgressReporter.constructor) {
            return { reporter: reporter, source: CancelAfter(this.serverOptions.cancellationProvider, token) };
        }

        const serverInitiatedReporter = await this.connection.window.createWorkDoneProgress();
        serverInitiatedReporter.begin(
            title,
            /* percentage */ undefined,
            /* message */ undefined,
            /* cancellable */ true
        );

        return {
            reporter: serverInitiatedReporter,
            source: CancelAfter(this.serverOptions.cancellationProvider, token, serverInitiatedReporter.token),
        };
    }

    private _convertDiagnostics(fs: FileSystem, diags: AnalyzerDiagnostic[]): Diagnostic[] {
        const convertedDiags: Diagnostic[] = [];

        diags.forEach((diag) => {
            const severity = convertCategoryToSeverity(diag.category);
            const rule = diag.getRule();
            const vsDiag = Diagnostic.create(diag.range, diag.message, severity, rule, this.serverOptions.productName);

            if (
                diag.category === DiagnosticCategory.UnusedCode ||
                diag.category === DiagnosticCategory.UnreachableCode
            ) {
                vsDiag.tags = [DiagnosticTag.Unnecessary];
                vsDiag.severity = DiagnosticSeverity.Hint;

                // If the client doesn't support "unnecessary" tags, don't report unused code.
                if (!this.client.supportsUnnecessaryDiagnosticTag) {
                    return;
                }
            } else if (diag.category === DiagnosticCategory.Deprecated) {
                vsDiag.tags = [DiagnosticTag.Deprecated];
                vsDiag.severity = DiagnosticSeverity.Hint;

                // If the client doesn't support "deprecated" tags, don't report.
                if (!this.client.supportsDeprecatedDiagnosticTag) {
                    return;
                }
            } else if (diag.category === DiagnosticCategory.TaskItem) {
                vsDiag.tags = [VSDiagnosticTag.TaskItem as DiagnosticTag];

                // Map the task item priority to a value VS will understand
                // and store it in the diagnostic.

                // The Diagnostic type is defined in a protocol that we can't change,
                // so we just dynamically create the vsDiag._vs_diagnosticRank property at runtime,
                // which is what VS is looking for.
                switch (diag.priority as TaskListPriority) {
                    case TaskListPriority.High:
                        (vsDiag as any)._vs_diagnosticRank = VSDiagnosticRank.High;
                        break;
                    case TaskListPriority.Normal:
                        (vsDiag as any)._vs_diagnosticRank = VSDiagnosticRank.Default;
                        break;
                    case TaskListPriority.Low:
                        (vsDiag as any)._vs_diagnosticRank = VSDiagnosticRank.Low;
                        break;
                }

                // if the client doesn't support "task item" tags, don't report.
                if (!this.client.supportsTaskItemDiagnosticTag) {
                    return;
                }
            }

            if (rule) {
                const ruleDocUrl = this.getDocumentationUrlForDiagnosticRule(rule);
                if (ruleDocUrl) {
                    vsDiag.codeDescription = {
                        href: ruleDocUrl,
                    };
                }
            }

            const relatedInfo = diag.getRelatedInfo();
            if (relatedInfo.length > 0) {
                vsDiag.relatedInformation = relatedInfo
                    .filter((info) => this.canNavigateToFile(info.filePath, fs))
                    .map((info) =>
                        DiagnosticRelatedInformation.create(
                            Location.create(convertPathToUri(fs, info.filePath), info.range),
                            info.message
                        )
                    );
            }

            convertedDiags.push(vsDiag);
        });

        function convertCategoryToSeverity(category: DiagnosticCategory) {
            switch (category) {
                case DiagnosticCategory.Error:
                    return DiagnosticSeverity.Error;

                case DiagnosticCategory.Warning:
                    return DiagnosticSeverity.Warning;

                case DiagnosticCategory.Information:
                case DiagnosticCategory.TaskItem: // task items only show up in the task list if they are information or above.
                    return DiagnosticSeverity.Information;

                case DiagnosticCategory.UnusedCode:
                case DiagnosticCategory.UnreachableCode:
                case DiagnosticCategory.Deprecated:
                    return DiagnosticSeverity.Hint;
            }
        }

        return convertedDiags;
    }
}
