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
    ParameterInformation,
    PrepareRenameParams,
    PublishDiagnosticsParams,
    ReferenceParams,
    RemoteWindow,
    RenameParams,
    SignatureHelp,
    SignatureHelpParams,
    SignatureHelpTriggerKind,
    SignatureInformation,
    SymbolInformation,
    TextDocumentPositionParams,
    TextDocumentSyncKind,
    WatchKind,
    WorkDoneProgressReporter,
    WorkspaceEdit,
    WorkspaceSymbol,
    WorkspaceSymbolParams,
} from 'vscode-languageserver';
import { attachWorkDone, ResultProgressReporter } from 'vscode-languageserver/lib/common/progress';

import { AnalysisResults } from './analyzer/analysis';
import { BackgroundAnalysisProgram } from './analyzer/backgroundAnalysisProgram';
import { CacheManager } from './analyzer/cacheManager';
import { ImportResolver } from './analyzer/importResolver';
import { MaxAnalysisTime } from './analyzer/program';
import { AnalyzerService, configFileNames, getNextServiceId } from './analyzer/service';
import { IPythonMode } from './analyzer/sourceFile';
import type { BackgroundAnalysisBase } from './backgroundAnalysisBase';
import { CommandResult } from './commands/commandResult';
import { CancelAfter, CancellationProvider } from './common/cancellationUtils';
import { appendArray, getNestedProperty } from './common/collectionUtils';
import {
    DiagnosticSeverityOverrides,
    DiagnosticSeverityOverridesMap,
    getDiagnosticSeverityOverrides,
} from './common/commandLineOptions';
import { ConfigOptions, getDiagLevelDiagnosticRules, SignatureDisplayType } from './common/configOptions';
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
import { ProgressReporter, ProgressReportTracker } from './common/progressReporter';
import { hashString } from './common/stringUtils';
import { DocumentRange, Position, Range } from './common/textRange';
import { UriParser } from './common/uriParser';
import { convertToWorkspaceEdit } from './common/workspaceEditUtils';
import { AnalyzerServiceExecutor } from './languageService/analyzerServiceExecutor';
import { ImportFormat } from './languageService/autoImporter';
import { CompletionItemData, CompletionOptions, CompletionResultsList } from './languageService/completionProvider';
import { DefinitionFilter } from './languageService/definitionProvider';
import { convertToFlatSymbols, WorkspaceSymbolCallback } from './languageService/documentSymbolProvider';
import { convertHoverResults } from './languageService/hoverProvider';
import { ReferenceCallback } from './languageService/referencesProvider';
import { Localizer, setLocaleOverride } from './localization/localize';
import { PyrightFileSystem } from './pyrightFileSystem';
import { InitStatus, WellKnownWorkspaceKinds, Workspace, WorkspaceFactory } from './workspaceFactory';

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
    getWorkspaceForFile(filePath: string): Promise<Workspace>;
    getSettings(workspace: Workspace): Promise<ServerSettings>;
    createBackgroundAnalysis(serviceId: string): BackgroundAnalysisBase | undefined;
    reanalyze(): void;
    restart(): void;
    decodeTextDocumentUri(uriString: string): string;

    readonly rootPath: string;
    readonly console: ConsoleInterface;
    readonly window: WindowInterface;
    readonly supportAdvancedEdits: boolean;
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

interface ClientCapabilities {
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
namespace VSDiagnosticTag {
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
namespace VSDiagnosticRank {
    export const Highest = 100;
    export const High = 200;
    export const Default = 300;
    export const Low = 400;
    export const Lowest = 500;
}

export abstract class LanguageServerBase implements LanguageServerInterface {
    protected _defaultClientConfig: any;
    protected _workspaceFactory: WorkspaceFactory;
    protected _cacheManager: CacheManager;

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

    // File system abstraction.
    protected _serviceFS: PyrightFileSystem;

    protected _uriParser: UriParser;

    constructor(
        protected _serverOptions: ServerOptions,
        protected _connection: Connection,
        readonly console: ConsoleInterface,
        uriParserFactory = (fs: FileSystem) => new UriParser(fs)
    ) {
        // Stash the base directory into a global variable.
        // This must happen before fs.getModulePath().
        (global as any).__rootDirectory = _serverOptions.rootDirectory;

        this.console.info(
            `${_serverOptions.productName} language server ${
                _serverOptions.version && _serverOptions.version + ' '
            }starting`
        );

        this.console.info(`Server root directory: ${_serverOptions.rootDirectory}`);

        this._cacheManager = new CacheManager();

        this._serviceFS = new PyrightFileSystem(this._serverOptions.fileSystem);
        this._uriParser = uriParserFactory(this._serviceFS);

        this._workspaceFactory = new WorkspaceFactory(
            this.console,
            this._uriParser,
            this.createAnalyzerServiceForWorkspace.bind(this),
            this.isPythonPathImmutable.bind(this),
            this.onWorkspaceCreated.bind(this)
        );

        // Set the working directory to a known location within
        // the extension directory. Otherwise the execution of
        // python can have unintended and surprising results.
        const moduleDirectory = this._serviceFS.getModulePath();
        if (moduleDirectory) {
            this._serviceFS.chdir(moduleDirectory);
        }

        // Set up callbacks.
        this.setupConnection(_serverOptions.supportedCommands ?? [], _serverOptions.supportedCodeActions ?? []);

        this._progressReporter = new ProgressReportTracker(this.createProgressReporter());

        // Listen on the connection.
        this._connection.listen();

        // Setup extensions
        Extensions.createLanguageServiceExtensions(this);
    }

    // Convert uri to path
    decodeTextDocumentUri(uriString: string): string {
        return this._uriParser.decodeTextDocumentUri(uriString);
    }

    abstract createBackgroundAnalysis(serviceId: string): BackgroundAnalysisBase | undefined;

    protected abstract executeCommand(params: ExecuteCommandParams, token: CancellationToken): Promise<any>;

    protected abstract isLongRunningCommand(command: string): boolean;

    protected abstract executeCodeAction(
        params: CodeActionParams,
        token: CancellationToken
    ): Promise<(Command | CodeAction)[] | undefined | null>;

    abstract getSettings(workspace: Workspace): Promise<ServerSettings>;

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
            return this._connection.workspace.getConfiguration(item);
        }

        if (this._defaultClientConfig) {
            return getNestedProperty(this._defaultClientConfig, section);
        }

        return undefined;
    }

    protected isOpenFilesOnly(diagnosticMode: string): boolean {
        return diagnosticMode !== 'workspace';
    }

    protected get allowModuleRename() {
        return false;
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
            console,
            configOptions,
            importResolver,
            backgroundAnalysis,
            maxAnalysisTime,
            /* disableChecker */ undefined,
            cacheManager
        );
    }

    // Provides access to the client's window.
    get window(): RemoteWindow {
        return this._connection.window;
    }

    get supportAdvancedEdits(): boolean {
        return this.client.hasDocumentChangeCapability && this.client.hasDocumentAnnotationCapability;
    }

    // Creates a service instance that's used for analyzing a
    // program within a workspace.
    createAnalyzerService(
        name: string,
        services?: WorkspaceServices,
        libraryReanalysisTimeProvider?: () => number
    ): AnalyzerService {
        this.console.info(`Starting service instance "${name}"`);

        const serviceId = getNextServiceId(name);
        const service = new AnalyzerService(name, services?.fs ?? this._serviceFS, {
            console: this.console,
            hostFactory: this.createHost.bind(this),
            importResolverFactory: this.createImportResolver.bind(this),
            backgroundAnalysis: services ? services.backgroundAnalysis : this.createBackgroundAnalysis(serviceId),
            maxAnalysisTime: this._serverOptions.maxAnalysisTimeInForeground,
            backgroundAnalysisProgramFactory: this.createBackgroundAnalysisProgram.bind(this),
            cancellationProvider: this._serverOptions.cancellationProvider,
            libraryReanalysisTimeProvider,
            cacheManager: this._cacheManager,
            serviceId,
        });

        service.setCompletionCallback((results) => this.onAnalysisCompletedHandler(service.fs, results));
        return service;
    }

    async test_getWorkspaces() {
        const workspaces = [...this._workspaceFactory.items()];
        for (const workspace of workspaces) {
            await workspace.isInitialized.promise;
        }

        return workspaces;
    }

    async getWorkspaceForFile(filePath: string, pythonPath?: string): Promise<Workspace> {
        return this._workspaceFactory.getWorkspaceForFile(filePath, pythonPath);
    }

    async getContainingWorkspacesForFile(filePath: string): Promise<Workspace[]> {
        return this._workspaceFactory.getContainingWorkspacesForFile(filePath);
    }

    reanalyze() {
        this._workspaceFactory.items().forEach((workspace) => {
            workspace.service.invalidateAndForceReanalysis();
        });
    }

    restart() {
        this._workspaceFactory.items().forEach((workspace) => {
            workspace.service.restart();
        });
    }

    protected setupConnection(supportedCommands: string[], supportedCodeActions: string[]): void {
        // After the server has started the client sends an initialize request. The server receives
        // in the passed params the rootPath of the workspace plus the client capabilities.
        this._connection.onInitialize((params) => this.initialize(params, supportedCommands, supportedCodeActions));

        this._connection.onInitialized(() => this.onInitialized());

        this._connection.onDidChangeConfiguration((params) => this.onDidChangeConfiguration(params));

        this._connection.onCodeAction((params, token) => this.executeCodeAction(params, token));

        this._connection.onDefinition(async (params, token) => this.onDefinition(params, token));
        this._connection.onDeclaration(async (params, token) => this.onDeclaration(params, token));
        this._connection.onTypeDefinition(async (params, token) => this.onTypeDefinition(params, token));

        this._connection.onReferences(async (params, token, workDoneReporter, resultReporter) =>
            this.onReferences(params, token, workDoneReporter, resultReporter)
        );

        this._connection.onDocumentSymbol(async (params, token) => this.onDocumentSymbol(params, token));
        this._connection.onWorkspaceSymbol(async (params, token, _, resultReporter) =>
            this.onWorkspaceSymbol(params, token, resultReporter)
        );

        this._connection.onHover(async (params, token) => this.onHover(params, token));

        this._connection.onDocumentHighlight(async (params, token) => this.onDocumentHighlight(params, token));

        this._connection.onSignatureHelp(async (params, token) => this.onSignatureHelp(params, token));

        this._connection.onCompletion((params, token) => this.onCompletion(params, token));

        this._connection.onCompletionResolve(async (params, token) => this.onCompletionResolve(params, token));

        this._connection.onPrepareRename(async (params, token) => this.onPrepareRenameRequest(params, token));
        this._connection.onRenameRequest(async (params, token) => this.onRenameRequest(params, token));

        const callHierarchy = this._connection.languages.callHierarchy;
        callHierarchy.onPrepare(async (params, token) => this.onPrepare(params, token));
        callHierarchy.onIncomingCalls(async (params, token) => this.onIncomingCalls(params, token));
        callHierarchy.onOutgoingCalls(async (params, token) => this.onOutgoingCalls(params, token));

        this._connection.onDidOpenTextDocument(async (params) => this.onDidOpenTextDocument(params));
        this._connection.onDidChangeTextDocument(async (params) => this.onDidChangeTextDocument(params));
        this._connection.onDidCloseTextDocument(async (params) => this.onDidCloseTextDocument(params));
        this._connection.onDidChangeWatchedFiles((params) => this.onDidChangeWatchedFiles(params));

        this._connection.onExecuteCommand(async (params, token, reporter) =>
            this.onExecuteCommand(params, token, reporter)
        );
        this._connection.onShutdown(async (token) => this.onShutdown(token));
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
        this._workspaceFactory.handleInitialize(params);

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

        this._connection.workspace.onDidChangeWorkspaceFolders((event) => {
            this._workspaceFactory.handleWorkspaceFoldersChanged(event);
            this._setupFileWatcher();
        });

        this._setupFileWatcher();
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
                this._workspaceFactory
                    .getNonDefaultWorkspaces()
                    .map((w) => w.searchPathsToWatch.filter((p) => !p.startsWith(w.rootPath)))
            );

            foldersToWatch.forEach((p) => {
                const globPattern = isFile(this._serviceFS, p, /* treatZipDirectoryAsFile */ true)
                    ? { baseUri: convertPathToUri(this._serviceFS, getDirectoryPath(p)), pattern: getFileName(p) }
                    : { baseUri: convertPathToUri(this._serviceFS, p), pattern: '**' };

                watchers.push({ globPattern, kind: watchKind });
            });
        }

        // File watcher is pylance wide service. Dispose all existing file watchers and create new ones.
        this._connection.client.register(DidChangeWatchedFilesNotification.type, { watchers }).then((d) => {
            if (this._lastFileWatcherRegistration) {
                this._lastFileWatcherRegistration.dispose();
            }

            this._lastFileWatcherRegistration = d;
        });
    }

    protected onDidChangeConfiguration(params: DidChangeConfigurationParams) {
        this.console.log(`Received updated settings`);
        if (params?.settings) {
            this._defaultClientConfig = params?.settings;
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
                workspace.service.getDefinitionForPosition(filePath, position, filter, token)
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
                workspace.service.getDefinitionForPosition(filePath, position, filter, token)
        );
    }

    protected async onTypeDefinition(
        params: TextDocumentPositionParams,
        token: CancellationToken
    ): Promise<Definition | DefinitionLink[] | undefined | null> {
        return this.getDefinitions(params, token, DefinitionFilter.All, (workspace, filePath, position, _, token) =>
            workspace.service.getTypeDefinitionForPosition(filePath, position, token)
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

        const { filePath, position } = this._uriParser.decodeTextDocumentPosition(params.textDocument, params.position);

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
            const { filePath, position } = this._uriParser.decodeTextDocumentPosition(
                params.textDocument,
                params.position
            );

            const workspace = await this.getWorkspaceForFile(filePath);
            if (workspace.disableLanguageServices) {
                return;
            }

            const convert = (locs: DocumentRange[]): Location[] => {
                return locs
                    .filter((loc) => this.canNavigateToFile(loc.path, workspace.service.fs))
                    .map((loc) => Location.create(convertPathToUri(workspace.service.fs, loc.path), loc.range));
            };

            const locations: Location[] = [];
            const reporter: ReferenceCallback = resultReporter
                ? (locs) => resultReporter.report(convert(locs))
                : (locs) => appendArray(locations, convert(locs));

            workspace.service.reportReferencesForPosition(
                filePath,
                position,
                params.context.includeDeclaration,
                reporter,
                source.token
            );

            return locations;
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

        const filePath = this._uriParser.decodeTextDocumentUri(params.textDocument.uri);

        const workspace = await this.getWorkspaceForFile(filePath);
        if (workspace.disableLanguageServices) {
            return undefined;
        }

        const symbolList: DocumentSymbol[] = [];
        workspace.service.addSymbolsForDocument(filePath, symbolList, token);
        if (this.client.hasHierarchicalDocumentSymbolCapability) {
            return symbolList;
        }

        return convertToFlatSymbols(params.textDocument.uri, symbolList);
    }

    protected async onWorkspaceSymbol(
        params: WorkspaceSymbolParams,
        token: CancellationToken,
        resultReporter: ResultProgressReporter<SymbolInformation[]> | undefined
    ): Promise<SymbolInformation[] | WorkspaceSymbol[] | null | undefined> {
        const symbolList: SymbolInformation[] = [];

        const reporter: WorkspaceSymbolCallback = resultReporter
            ? (symbols) => resultReporter.report(symbols)
            : (symbols) => appendArray(symbolList, symbols);

        for (const workspace of this._workspaceFactory.items()) {
            await workspace.isInitialized.promise;
            if (!workspace.disableLanguageServices && !workspace.disableWorkspaceSymbol) {
                workspace.service.reportSymbolsForWorkspace(params.query, reporter, token);
            }
        }

        return symbolList;
    }

    protected async onHover(params: HoverParams, token: CancellationToken) {
        const { filePath, position } = this._uriParser.decodeTextDocumentPosition(params.textDocument, params.position);

        const workspace = await this.getWorkspaceForFile(filePath);
        const hoverResults = workspace.service.getHoverForPosition(
            filePath,
            position,
            this.client.hoverContentFormat,
            token
        );
        return convertHoverResults(
            this.client.hoverContentFormat,
            hoverResults,
            !!this._serverOptions.supportsTelemetry
        );
    }

    protected async onDocumentHighlight(
        params: DocumentHighlightParams,
        token: CancellationToken
    ): Promise<DocumentHighlight[] | null | undefined> {
        const { filePath, position } = this._uriParser.decodeTextDocumentPosition(params.textDocument, params.position);
        const workspace = await this.getWorkspaceForFile(filePath);
        return workspace.service.getDocumentHighlight(filePath, position, token);
    }

    protected async onSignatureHelp(
        params: SignatureHelpParams,
        token: CancellationToken
    ): Promise<SignatureHelp | undefined | null> {
        const { filePath, position } = this._uriParser.decodeTextDocumentPosition(params.textDocument, params.position);

        const workspace = await this.getWorkspaceForFile(filePath);
        if (workspace.disableLanguageServices) {
            return;
        }
        const signatureHelpResults = workspace.service.getSignatureHelpForPosition(
            filePath,
            position,
            this.client.signatureDocFormat,
            token
        );
        if (!signatureHelpResults) {
            return undefined;
        }

        const signatures = signatureHelpResults.signatures.map((sig) => {
            let paramInfo: ParameterInformation[] = [];
            if (sig.parameters) {
                paramInfo = sig.parameters.map((param) =>
                    ParameterInformation.create(
                        this.client.hasSignatureLabelOffsetCapability
                            ? [param.startOffset, param.endOffset]
                            : param.text,
                        param.documentation
                    )
                );
            }

            const sigInfo = SignatureInformation.create(sig.label, /* documentation */ undefined, ...paramInfo);
            if (sig.documentation !== undefined) {
                sigInfo.documentation = sig.documentation;
            }
            if (sig.activeParameter !== undefined) {
                sigInfo.activeParameter = sig.activeParameter;
            }
            return sigInfo;
        });

        // A signature is active if it contains an active parameter,
        // or if both the signature and its invocation have no parameters.
        const isActive = (sig: SignatureInformation) =>
            sig.activeParameter !== undefined || (!signatureHelpResults.callHasParameters && !sig.parameters?.length);

        let activeSignature: number | undefined = signatures.findIndex(isActive);
        if (activeSignature === -1) {
            activeSignature = undefined;
        }

        let activeParameter = activeSignature !== undefined ? signatures[activeSignature].activeParameter! : undefined;

        // Check if we should reuse the user's signature selection. If the retrigger was not "invoked"
        // (i.e., the signature help call was automatically generated by the client due to some navigation
        // or text change), check to see if the previous signature is still "active". If so, we mark it as
        // active in our response.
        //
        // This isn't a perfect method. For nested calls, we can't tell when we are moving between them.
        // Ideally, we would include a token in the signature help responses to compare later, allowing us
        // to know when the user's navigated to a nested call (and therefore the old signature's info does
        // not apply), but for now manually retriggering the signature help will work around the issue.
        if (params.context?.isRetrigger && params.context.triggerKind !== SignatureHelpTriggerKind.Invoked) {
            const prevActiveSignature = params.context.activeSignatureHelp?.activeSignature;
            if (prevActiveSignature !== undefined && prevActiveSignature < signatures.length) {
                const sig = signatures[prevActiveSignature];
                if (isActive(sig)) {
                    activeSignature = prevActiveSignature;
                    activeParameter = sig.activeParameter;
                }
            }
        }

        if (this.client.hasActiveParameterCapability || activeSignature === undefined) {
            // If there is no active parameter, then we want the client to not highlight anything.
            // Unfortunately, the LSP spec says that "undefined" or "out of bounds" values should be
            // treated as 0, which is the first parameter. That's not what we want, but thankfully
            // VS Code (and potentially other clients) choose to handle out of bounds values by
            // not highlighting them, which is what we want.
            //
            // The spec defines activeParameter as uinteger, so use the maximum length of any
            // signature's parameter list to ensure that the value is always out of range.
            //
            // We always set this even if some signature has an active parameter, as this
            // value is used as the fallback for signatures that don't explicitly specify an
            // active parameter (and we use "undefined" to mean "no active parameter").
            //
            // We could apply this hack to each individual signature such that they all specify
            // activeParameter, but that would make it more difficult to determine which actually
            // are active when comparing, and we already have to set this for clients which don't
            // support per-signature activeParameter.
            //
            // See:
            //   - https://github.com/microsoft/language-server-protocol/issues/1271
            //   - https://github.com/microsoft/pyright/pull/1783
            activeParameter = Math.max(...signatures.map((s) => s.parameters?.length ?? 0));
        }

        return { signatures, activeSignature, activeParameter };
    }

    protected async onCompletion(
        params: CompletionParams,
        token: CancellationToken
    ): Promise<CompletionList | undefined> {
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

        const { filePath, position } = this._uriParser.decodeTextDocumentPosition(params.textDocument, params.position);

        const workspace = await this.getWorkspaceForFile(filePath);
        if (workspace.disableLanguageServices) {
            return;
        }

        const completions = await this.getWorkspaceCompletionsForPosition(
            workspace,
            filePath,
            position,
            this.getCompletionOptions(workspace, params),
            token
        );

        if (completions) {
            completions.completionList.isIncomplete = completionIncomplete;
        }

        // Add memberAccessInfo.lastKnownModule if we have it. The client side
        // will use this to send extra telemetry
        if (
            completions?.memberAccessInfo &&
            completions.completionList &&
            completions.completionList.items.length > 0 &&
            completions.memberAccessInfo.lastKnownModule &&
            this._serverOptions.supportsTelemetry
        ) {
            // Just stick it on the first item. It only checks the first one
            completions.completionList.items[0].data = {
                ...completions.completionList.items[0].data,
                moduleHash: hashString(completions.memberAccessInfo.lastKnownModule),
            };
        }

        return completions?.completionList;
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
            this.resolveWorkspaceCompletionItem(workspace, completionItemData.filePath, params, token);
        }
        return params;
    }

    protected async onPrepareRenameRequest(
        params: PrepareRenameParams,
        token: CancellationToken
    ): Promise<Range | { range: Range; placeholder: string } | null> {
        const { filePath, position } = this._uriParser.decodeTextDocumentPosition(params.textDocument, params.position);

        const workspace = await this.getWorkspaceForFile(filePath);
        if (workspace.disableLanguageServices) {
            return null;
        }

        const result = workspace.service.canRenameSymbolAtPosition(
            filePath,
            position,
            workspace.kinds.includes(WellKnownWorkspaceKinds.Default),
            this.allowModuleRename,
            token
        );

        return result?.range ?? null;
    }

    protected async onRenameRequest(
        params: RenameParams,
        token: CancellationToken
    ): Promise<WorkspaceEdit | null | undefined> {
        const { filePath, position } = this._uriParser.decodeTextDocumentPosition(params.textDocument, params.position);

        const workspace = await this.getWorkspaceForFile(filePath);
        if (workspace.disableLanguageServices) {
            return;
        }

        const editActions = workspace.service.renameSymbolAtPosition(
            filePath,
            position,
            params.newName,
            workspace.kinds.includes(WellKnownWorkspaceKinds.Default),
            this.allowModuleRename,
            token
        );

        if (!editActions) {
            return undefined;
        }

        return convertToWorkspaceEdit(workspace.service.fs, editActions);
    }

    protected async onPrepare(
        params: CallHierarchyPrepareParams,
        token: CancellationToken
    ): Promise<CallHierarchyItem[] | null> {
        const { filePath, position } = this._uriParser.decodeTextDocumentPosition(params.textDocument, params.position);

        const workspace = await this.getWorkspaceForFile(filePath);
        if (workspace.disableLanguageServices) {
            return null;
        }

        const callItem = workspace.service.getCallForPosition(filePath, position, token) || null;
        if (!callItem) {
            return null;
        }

        if (!this.canNavigateToFile(callItem.uri, workspace.service.fs)) {
            return null;
        }

        // Convert the file path in the item to proper URI.
        callItem.uri = convertPathToUri(workspace.service.fs, callItem.uri);

        return [callItem];
    }

    protected async onIncomingCalls(params: CallHierarchyIncomingCallsParams, token: CancellationToken) {
        const { filePath, position } = this._uriParser.decodeTextDocumentPosition(params.item, params.item.range.start);

        const workspace = await this.getWorkspaceForFile(filePath);
        if (workspace.disableLanguageServices) {
            return null;
        }

        let callItems = workspace.service.getIncomingCallsForPosition(filePath, position, token) || null;
        if (!callItems || callItems.length === 0) {
            return null;
        }

        callItems = callItems.filter((item) => this.canNavigateToFile(item.from.uri, workspace.service.fs));

        // Convert the file paths in the items to proper URIs.
        callItems.forEach((item) => {
            item.from.uri = convertPathToUri(workspace.service.fs, item.from.uri);
        });

        return callItems;
    }

    protected async onOutgoingCalls(
        params: CallHierarchyOutgoingCallsParams,
        token: CancellationToken
    ): Promise<CallHierarchyOutgoingCall[] | null> {
        const { filePath, position } = this._uriParser.decodeTextDocumentPosition(params.item, params.item.range.start);

        const workspace = await this.getWorkspaceForFile(filePath);
        if (workspace.disableLanguageServices) {
            return null;
        }

        let callItems = workspace.service.getOutgoingCallsForPosition(filePath, position, token) || null;
        if (!callItems || callItems.length === 0) {
            return null;
        }

        callItems = callItems.filter((item) => this.canNavigateToFile(item.to.uri, workspace.service.fs));

        // Convert the file paths in the items to proper URIs.
        callItems.forEach((item) => {
            item.to.uri = convertPathToUri(workspace.service.fs, item.to.uri);
        });

        return callItems;
    }

    protected async onDidOpenTextDocument(params: DidOpenTextDocumentParams, ipythonMode = IPythonMode.None) {
        const filePath = this._uriParser.decodeTextDocumentUri(params.textDocument.uri);

        if (!this._serviceFS.addUriMap(params.textDocument.uri, filePath)) {
            // We do not support opening 1 file with 2 different uri.
            return;
        }

        // Send this open to all the workspaces that might contain this file.
        const workspaces = await this.getContainingWorkspacesForFile(filePath);
        workspaces.forEach((w) => {
            w.service.setFileOpened(filePath, params.textDocument.version, params.textDocument.text, ipythonMode);
        });
    }

    protected async onDidChangeTextDocument(params: DidChangeTextDocumentParams, ipythonMode = IPythonMode.None) {
        this.recordUserInteractionTime();

        const filePath = this._uriParser.decodeTextDocumentUri(params.textDocument.uri);
        if (!this._serviceFS.hasUriMapEntry(params.textDocument.uri, filePath)) {
            // We do not support opening 1 file with 2 different uri.
            return;
        }

        // Send this change to all the workspaces that might contain this file.
        const workspaces = await this.getContainingWorkspacesForFile(filePath);
        workspaces.forEach((w) => {
            w.service.updateOpenFileContents(filePath, params.textDocument.version, params.contentChanges, ipythonMode);
        });
    }

    protected async onDidCloseTextDocument(params: DidCloseTextDocumentParams) {
        const filePath = this._uriParser.decodeTextDocumentUri(params.textDocument.uri);
        if (!this._serviceFS.removeUriMap(params.textDocument.uri, filePath)) {
            // We do not support opening 1 file with 2 different uri.
            return;
        }

        // Send this close to all the workspaces that might contain this file.
        const workspaces = await this.getContainingWorkspacesForFile(filePath);
        workspaces.forEach((w) => {
            w.service.setFileClosed(filePath);
        });
    }

    protected onDidChangeWatchedFiles(params: DidChangeWatchedFilesParams) {
        params.changes.forEach((change) => {
            const filePath = this._serviceFS.realCasePath(this._uriParser.decodeTextDocumentUri(change.uri));
            const eventType: FileWatcherEventType = change.type === 1 ? 'add' : 'change';
            this._serverOptions.fileWatcherHandler.onFileChange(eventType, filePath);
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
                this._connection.workspace.applyEdit({ label: `Command '${params.command}'`, edit: result });
            }

            if (CommandResult.is(result)) {
                // Tell client to apply edits.
                // Await so that we return after the edit is complete.
                await this._connection.workspace.applyEdit({ label: result.label, edit: result.edits });
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
        this._workspaceFactory.clear();
        return Promise.resolve();
    }

    protected resolveWorkspaceCompletionItem(
        workspace: Workspace,
        filePath: string,
        item: CompletionItem,
        token: CancellationToken
    ): void {
        workspace.service.resolveCompletionItem(
            filePath,
            item,
            this.getCompletionOptions(workspace),
            /* nameMap */ undefined,
            token
        );
    }

    protected getWorkspaceCompletionsForPosition(
        workspace: Workspace,
        filePath: string,
        position: Position,
        options: CompletionOptions,
        token: CancellationToken
    ): Promise<CompletionResultsList | undefined> {
        return workspace.service.getCompletionsForPosition(
            filePath,
            position,
            workspace.rootPath,
            options,
            undefined,
            token
        );
    }

    updateSettingsForAllWorkspaces(): void {
        const tasks: Promise<void>[] = [];
        this._workspaceFactory.items().forEach((workspace) => {
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

    protected getCompletionOptions(workspace: Workspace, params?: CompletionParams): CompletionOptions {
        return {
            format: this.client.completionDocFormat,
            snippet: this.client.completionSupportsSnippet,
            lazyEdit: this.client.completionItemResolveSupportsAdditionalTextEdits,
            autoImport: true,
            includeUserSymbolsInAutoImport: false,
            extraCommitChars: false,
            importFormat: ImportFormat.Absolute,
            triggerCharacter: params?.context?.triggerCharacter,
        };
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
            this._serviceFS.pendingRequest(fileDiag.filePath, fileDiag.diagnostics.length > 0);
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
        serverSettings.pythonPath = this._workspaceFactory.applyPythonPath(workspace, serverSettings.pythonPath);

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
                      this._workspaceFactory.hasMultipleWorkspaces(kinds[0])
                          ? multiWorkspaceBackOffTime
                          : defaultBackOffTime
                : () => defaultBackOffTime;

        return this.createAnalyzerService(name, services, libraryReanalysisTimeProvider);
    }

    private _sendDiagnostics(params: PublishDiagnosticsParams[]) {
        for (const param of params) {
            this._connection.sendDiagnostics(param);
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
            return { reporter: reporter, source: CancelAfter(this._serverOptions.cancellationProvider, token) };
        }

        const serverInitiatedReporter = await this._connection.window.createWorkDoneProgress();
        serverInitiatedReporter.begin(
            title,
            /* percentage */ undefined,
            /* message */ undefined,
            /* cancellable */ true
        );

        return {
            reporter: serverInitiatedReporter,
            source: CancelAfter(this._serverOptions.cancellationProvider, token, serverInitiatedReporter.token),
        };
    }

    private _convertDiagnostics(fs: FileSystem, diags: AnalyzerDiagnostic[]): Diagnostic[] {
        const convertedDiags: Diagnostic[] = [];

        diags.forEach((diag) => {
            const severity = convertCategoryToSeverity(diag.category);
            const rule = diag.getRule();
            const vsDiag = Diagnostic.create(diag.range, diag.message, severity, rule, this._serverOptions.productName);

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

    protected recordUserInteractionTime() {
        // Tell all of the services that the user is actively
        // interacting with one or more editors, so they should
        // back off from performing any work.
        this._workspaceFactory.items().forEach((workspace: { service: { recordUserInteractionTime: () => void } }) => {
            workspace.service.recordUserInteractionTime();
        });
    }

    protected getDocumentationUrlForDiagnosticRule(rule: string): string | undefined {
        // Configuration.md is configured to have a link for every rule name.
        return `https://github.com/microsoft/pyright/blob/main/docs/configuration.md#${rule}`;
    }

    protected abstract createProgressReporter(): ProgressReporter;

    protected canNavigateToFile(path: string, fs: FileSystem): boolean {
        return !fs.isInZipOrEgg(path);
    }
}
