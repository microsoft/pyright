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
    CancellationToken,
    CancellationTokenSource,
    CodeAction,
    CodeActionParams,
    Command,
    CompletionItem,
    CompletionList,
    CompletionParams,
    CompletionTriggerKind,
    ConfigurationItem,
    Connection,
    Diagnostic,
    DiagnosticRelatedInformation,
    DiagnosticSeverity,
    DiagnosticTag,
    DidChangeWatchedFilesNotification,
    DocumentSymbol,
    ExecuteCommandParams,
    InitializeParams,
    InitializeResult,
    Location,
    MarkupKind,
    ParameterInformation,
    RemoteWindow,
    SignatureHelpTriggerKind,
    SignatureInformation,
    SymbolInformation,
    TextDocumentPositionParams,
    TextDocumentSyncKind,
    WatchKind,
    WorkDoneProgressReporter,
    WorkspaceEdit,
    WorkspaceFolder,
} from 'vscode-languageserver';
import { attachWorkDone } from 'vscode-languageserver/lib/common/progress';

import { AnalysisResults } from './analyzer/analysis';
import { BackgroundAnalysisProgram } from './analyzer/backgroundAnalysisProgram';
import { ImportResolver } from './analyzer/importResolver';
import { MaxAnalysisTime } from './analyzer/program';
import { AnalyzerService, configFileNames } from './analyzer/service';
import type { BackgroundAnalysisBase } from './backgroundAnalysisBase';
import { CommandResult } from './commands/commandResult';
import { CancelAfter, CancellationProvider } from './common/cancellationUtils';
import { getNestedProperty } from './common/collectionUtils';
import {
    DiagnosticSeverityOverrides,
    DiagnosticSeverityOverridesMap,
    getDiagnosticSeverityOverrides,
} from './common/commandLineOptions';
import { ConfigOptions, getDiagLevelDiagnosticRules } from './common/configOptions';
import { ConsoleInterface, ConsoleWithLogLevel, LogLevel } from './common/console';
import { createDeferred, Deferred } from './common/deferred';
import { Diagnostic as AnalyzerDiagnostic, DiagnosticCategory } from './common/diagnostic';
import { DiagnosticRule } from './common/diagnosticRules';
import { LanguageServiceExtension } from './common/extensibility';
import { FileSystem, FileWatcherEventType, FileWatcherProvider } from './common/fileSystem';
import { Host } from './common/host';
import { convertPathToUri, convertUriToPath } from './common/pathUtils';
import { ProgressReporter, ProgressReportTracker } from './common/progressReporter';
import { DocumentRange, Position } from './common/textRange';
import { convertWorkspaceEdits } from './common/workspaceEditUtils';
import { AnalyzerServiceExecutor } from './languageService/analyzerServiceExecutor';
import { CompletionItemData, CompletionResults } from './languageService/completionProvider';
import { DefinitionFilter } from './languageService/definitionProvider';
import { convertToFlatSymbols, WorkspaceSymbolCallback } from './languageService/documentSymbolProvider';
import { convertHoverResults } from './languageService/hoverProvider';
import { ReferenceCallback } from './languageService/referencesProvider';
import { Localizer, setLocaleOverride } from './localization/localize';
import { PyrightFileSystem } from './pyrightFileSystem';
import { WorkspaceMap } from './workspaceMap';

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
}

export interface WorkspaceServiceInstance {
    workspaceName: string;
    rootPath: string;
    rootUri: string;
    serviceInstance: AnalyzerService;
    disableLanguageServices: boolean;
    disableOrganizeImports: boolean;
    isInitialized: Deferred<boolean>;
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
    getWorkspaceForFile(filePath: string): Promise<WorkspaceServiceInstance>;
    getSettings(workspace: WorkspaceServiceInstance): Promise<ServerSettings>;
    createBackgroundAnalysis(): BackgroundAnalysisBase | undefined;
    reanalyze(): void;
    restart(): void;

    readonly rootPath: string;
    readonly console: ConsoleInterface;
    readonly window: WindowInterface;
    readonly fs: FileSystem;
    readonly supportAdvancedEdits: boolean;
}

export interface ServerOptions {
    productName: string;
    rootDirectory: string;
    version: string;
    workspaceMap: WorkspaceMap;
    fileSystem: FileSystem;
    fileWatcherProvider: FileWatcherProvider;
    cancellationProvider: CancellationProvider;
    extension?: LanguageServiceExtension;
    maxAnalysisTimeInForeground?: MaxAnalysisTime;
    disableChecker?: boolean;
    supportedCommands?: string[];
    supportedCodeActions?: string[];
}

interface ClientCapabilities {
    hasConfigurationCapability: boolean;
    hasVisualStudioExtensionsCapability: boolean;
    hasWorkspaceFoldersCapability: boolean;
    hasWatchFileCapability: boolean;
    hasActiveParameterCapability: boolean;
    hasSignatureLabelOffsetCapability: boolean;
    hasHierarchicalDocumentSymbolCapability: boolean;
    hasWindowProgressCapability: boolean;
    hasGoToDeclarationCapability: boolean;
    hasDocumentChangeCapability: boolean;
    hasDocumentAnnotationCapability: boolean;
    hoverContentFormat: MarkupKind;
    completionDocFormat: MarkupKind;
    completionSupportsSnippet: boolean;
    signatureDocFormat: MarkupKind;
    supportsDeprecatedDiagnosticTag: boolean;
    supportsUnnecessaryDiagnosticTag: boolean;
    completionItemResolveSupportsAdditionalTextEdits: boolean;
}

const nullProgressReporter = attachWorkDone(undefined as any, undefined);

export abstract class LanguageServerBase implements LanguageServerInterface {
    protected _defaultClientConfig: any;
    protected _workspaceMap: WorkspaceMap;
    protected _fileWatcherProvider: FileWatcherProvider;

    // We support running only one "find all reference" at a time.
    private _pendingFindAllRefsCancellationSource: CancellationTokenSource | undefined;

    // We support running only one command at a time.
    private _pendingCommandCancellationSource: CancellationTokenSource | undefined;

    private _progressReporter: ProgressReporter;

    private _lastTriggerKind: CompletionTriggerKind | undefined = CompletionTriggerKind.Invoked;

    // Global root path - the basis for all global settings.
    rootPath = '';

    protected client: ClientCapabilities = {
        hasConfigurationCapability: false,
        hasVisualStudioExtensionsCapability: false,
        hasWorkspaceFoldersCapability: false,
        hasWatchFileCapability: false,
        hasActiveParameterCapability: false,
        hasSignatureLabelOffsetCapability: false,
        hasHierarchicalDocumentSymbolCapability: false,
        hasWindowProgressCapability: false,
        hasGoToDeclarationCapability: false,
        hasDocumentChangeCapability: false,
        hasDocumentAnnotationCapability: false,
        hoverContentFormat: MarkupKind.PlainText,
        completionDocFormat: MarkupKind.PlainText,
        completionSupportsSnippet: false,
        signatureDocFormat: MarkupKind.PlainText,
        supportsDeprecatedDiagnosticTag: false,
        supportsUnnecessaryDiagnosticTag: false,
        completionItemResolveSupportsAdditionalTextEdits: false,
    };

    // File system abstraction.
    fs: FileSystem;

    constructor(
        protected _serverOptions: ServerOptions,
        protected _connection: Connection,
        readonly console: ConsoleInterface
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

        this._workspaceMap = this._serverOptions.workspaceMap;
        this._fileWatcherProvider = this._serverOptions.fileWatcherProvider;
        this.fs = new PyrightFileSystem(this._serverOptions.fileSystem);

        // Set the working directory to a known location within
        // the extension directory. Otherwise the execution of
        // python can have unintended and surprising results.
        const moduleDirectory = this.fs.getModulePath();
        if (moduleDirectory) {
            this.fs.chdir(moduleDirectory);
        }

        // Set up callbacks.
        this.setupConnection(_serverOptions.supportedCommands ?? [], _serverOptions.supportedCodeActions ?? []);

        this._progressReporter = new ProgressReportTracker(this.createProgressReporter());

        // Listen on the connection.
        this._connection.listen();
    }

    abstract createBackgroundAnalysis(): BackgroundAnalysisBase | undefined;

    protected abstract executeCommand(params: ExecuteCommandParams, token: CancellationToken): Promise<any>;

    protected abstract isLongRunningCommand(command: string): boolean;

    protected abstract executeCodeAction(
        params: CodeActionParams,
        token: CancellationToken
    ): Promise<(Command | CodeAction)[] | undefined | null>;

    abstract getSettings(workspace: WorkspaceServiceInstance): Promise<ServerSettings>;

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
        console: ConsoleInterface,
        configOptions: ConfigOptions,
        importResolver: ImportResolver,
        extension?: LanguageServiceExtension,
        backgroundAnalysis?: BackgroundAnalysisBase,
        maxAnalysisTime?: MaxAnalysisTime
    ): BackgroundAnalysisProgram {
        return new BackgroundAnalysisProgram(
            console,
            configOptions,
            importResolver,
            extension,
            backgroundAnalysis,
            maxAnalysisTime
        );
    }

    protected setExtension(extension: any): void {
        this._serverOptions.extension = extension;
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
    createAnalyzerService(name: string): AnalyzerService {
        this.console.log(`Starting service instance "${name}"`);
        const service = new AnalyzerService(
            name,
            this.fs,
            this.console,
            this.createHost.bind(this),
            this.createImportResolver.bind(this),
            undefined,
            this._serverOptions.extension,
            this.createBackgroundAnalysis(),
            this._serverOptions.maxAnalysisTimeInForeground,
            this.createBackgroundAnalysisProgram.bind(this),
            this._serverOptions.cancellationProvider
        );

        service.setCompletionCallback((results) => this.onAnalysisCompletedHandler(results));

        return service;
    }

    async getWorkspaceForFile(filePath: string): Promise<WorkspaceServiceInstance> {
        const workspace = this._workspaceMap.getWorkspaceForFile(this, filePath);
        await workspace.isInitialized.promise;
        return workspace;
    }

    reanalyze() {
        this._workspaceMap.forEach((workspace) => {
            workspace.serviceInstance.invalidateAndForceReanalysis();
        });
    }

    restart() {
        this._workspaceMap.forEach((workspace) => {
            workspace.serviceInstance.restart();
        });
    }

    protected setupConnection(supportedCommands: string[], supportedCodeActions: string[]): void {
        // After the server has started the client sends an initialize request. The server receives
        // in the passed params the rootPath of the workspace plus the client capabilities.
        this._connection.onInitialize((params) => this.initialize(params, supportedCommands, supportedCodeActions));

        this._connection.onDidChangeConfiguration((params) => {
            this.console.log(`Received updated settings`);
            if (params?.settings) {
                this._defaultClientConfig = params?.settings;
            }
            this.updateSettingsForAllWorkspaces();
        });

        this._connection.onCodeAction((params, token) => this.executeCodeAction(params, token));

        const getDefinitions = async (
            params: TextDocumentPositionParams,
            token: CancellationToken,
            filter: DefinitionFilter
        ) => {
            this.recordUserInteractionTime();

            const filePath = convertUriToPath(this.fs, params.textDocument.uri);

            const position: Position = {
                line: params.position.line,
                character: params.position.character,
            };

            const workspace = await this.getWorkspaceForFile(filePath);
            if (workspace.disableLanguageServices) {
                return undefined;
            }

            const locations = workspace.serviceInstance.getDefinitionForPosition(filePath, position, filter, token);
            if (!locations) {
                return undefined;
            }
            return locations
                .filter((loc) => !this.fs.isInZipOrEgg(loc.path))
                .map((loc) => Location.create(convertPathToUri(this.fs, loc.path), loc.range));
        };

        this._connection.onDefinition((params, token) =>
            getDefinitions(
                params,
                token,
                this.client.hasGoToDeclarationCapability ? DefinitionFilter.PreferSource : DefinitionFilter.All
            )
        );

        this._connection.onDeclaration((params, token) =>
            getDefinitions(
                params,
                token,
                this.client.hasGoToDeclarationCapability ? DefinitionFilter.PreferStubs : DefinitionFilter.All
            )
        );

        this._connection.onReferences(async (params, token, workDoneReporter, resultReporter) => {
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
                const filePath = convertUriToPath(this.fs, params.textDocument.uri);
                const position: Position = {
                    line: params.position.line,
                    character: params.position.character,
                };

                const workspace = await this.getWorkspaceForFile(filePath);
                if (workspace.disableLanguageServices) {
                    return;
                }

                const convert = (locs: DocumentRange[]): Location[] => {
                    return locs
                        .filter((loc) => !this.fs.isInZipOrEgg(loc.path))
                        .map((loc) => Location.create(convertPathToUri(this.fs, loc.path), loc.range));
                };

                const locations: Location[] = [];
                const reporter: ReferenceCallback = resultReporter
                    ? (locs) => resultReporter.report(convert(locs))
                    : (locs) => locations.push(...convert(locs));

                workspace.serviceInstance.reportReferencesForPosition(
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
        });

        this._connection.onDocumentSymbol(async (params, token) => {
            this.recordUserInteractionTime();

            const filePath = convertUriToPath(this.fs, params.textDocument.uri);

            const workspace = await this.getWorkspaceForFile(filePath);
            if (workspace.disableLanguageServices) {
                return undefined;
            }

            const symbolList: DocumentSymbol[] = [];
            workspace.serviceInstance.addSymbolsForDocument(filePath, symbolList, token);
            if (this.client.hasHierarchicalDocumentSymbolCapability) {
                return symbolList;
            }

            return convertToFlatSymbols(params.textDocument.uri, symbolList);
        });

        this._connection.onWorkspaceSymbol(async (params, token, _, resultReporter) => {
            const symbolList: SymbolInformation[] = [];

            const reporter: WorkspaceSymbolCallback = resultReporter
                ? (symbols) => resultReporter.report(symbols)
                : (symbols) => symbolList.push(...symbols);

            for (const workspace of this._workspaceMap.values()) {
                await workspace.isInitialized.promise;
                if (!workspace.disableLanguageServices) {
                    workspace.serviceInstance.reportSymbolsForWorkspace(params.query, reporter, token);
                }
            }

            return symbolList;
        });

        this._connection.onHover(async (params, token) => {
            const filePath = convertUriToPath(this.fs, params.textDocument.uri);

            const position: Position = {
                line: params.position.line,
                character: params.position.character,
            };

            const workspace = await this.getWorkspaceForFile(filePath);
            const hoverResults = workspace.serviceInstance.getHoverForPosition(
                filePath,
                position,
                this.client.hoverContentFormat,
                token
            );
            return convertHoverResults(this.client.hoverContentFormat, hoverResults);
        });

        this._connection.onDocumentHighlight(async (params, token) => {
            const filePath = convertUriToPath(this.fs, params.textDocument.uri);

            const position: Position = {
                line: params.position.line,
                character: params.position.character,
            };

            const workspace = await this.getWorkspaceForFile(filePath);
            return workspace.serviceInstance.getDocumentHighlight(filePath, position, token);
        });

        this._connection.onSignatureHelp(async (params, token) => {
            const filePath = convertUriToPath(this.fs, params.textDocument.uri);

            const position: Position = {
                line: params.position.line,
                character: params.position.character,
            };

            const workspace = await this.getWorkspaceForFile(filePath);
            if (workspace.disableLanguageServices) {
                return;
            }
            const signatureHelpResults = workspace.serviceInstance.getSignatureHelpForPosition(
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

                const sigInfo = SignatureInformation.create(sig.label, undefined, ...paramInfo);
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
                sig.activeParameter !== undefined ||
                (!signatureHelpResults.callHasParameters && !sig.parameters?.length);

            let activeSignature: number | null = signatures.findIndex(isActive);
            if (activeSignature === -1) {
                activeSignature = null;
            }

            let activeParameter = activeSignature !== null ? signatures[activeSignature].activeParameter! : null;

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
                const prevActiveSignature = params.context.activeSignatureHelp?.activeSignature ?? null;
                if (prevActiveSignature !== null && prevActiveSignature < signatures.length) {
                    const sig = signatures[prevActiveSignature];
                    if (isActive(sig)) {
                        activeSignature = prevActiveSignature;
                        activeParameter = sig.activeParameter ?? null;
                    }
                }
            }

            if (this.client.hasActiveParameterCapability || activeSignature === null) {
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
        });

        this._connection.onCompletion((params, token) => this.onCompletion(params, token));

        this._connection.onCompletionResolve(async (params, token) => {
            // Cancellation bugs in vscode and LSP:
            // https://github.com/microsoft/vscode-languageserver-node/issues/615
            // https://github.com/microsoft/vscode/issues/95485
            //
            // If resolver throws cancellation exception, LSP and VSCode
            // cache that result and never call us back.
            const completionItemData = params.data as CompletionItemData;
            if (completionItemData && completionItemData.filePath) {
                const workspace = await this.getWorkspaceForFile(completionItemData.workspacePath);
                this.resolveWorkspaceCompletionItem(workspace, completionItemData.filePath, params, token);
            }
            return params;
        });

        this._connection.onRenameRequest(async (params, token) => {
            const filePath = convertUriToPath(this.fs, params.textDocument.uri);

            const position: Position = {
                line: params.position.line,
                character: params.position.character,
            };

            const workspace = await this.getWorkspaceForFile(filePath);
            if (workspace.disableLanguageServices) {
                return;
            }

            const editActions = workspace.serviceInstance.renameSymbolAtPosition(
                filePath,
                position,
                params.newName,
                workspace.rootPath === '',
                token
            );

            if (!editActions) {
                return undefined;
            }

            return convertWorkspaceEdits(this.fs, editActions);
        });

        this._connection.languages.callHierarchy.onPrepare(async (params, token) => {
            const filePath = convertUriToPath(this.fs, params.textDocument.uri);

            const position: Position = {
                line: params.position.line,
                character: params.position.character,
            };

            const workspace = await this.getWorkspaceForFile(filePath);
            if (workspace.disableLanguageServices) {
                return null;
            }

            const callItem = workspace.serviceInstance.getCallForPosition(filePath, position, token) || null;
            if (!callItem) {
                return null;
            }

            if (this.fs.isInZipOrEgg(callItem.uri)) {
                return null;
            }

            // Convert the file path in the item to proper URI.
            callItem.uri = convertPathToUri(this.fs, callItem.uri);

            return [callItem];
        });

        this._connection.languages.callHierarchy.onIncomingCalls(async (params, token) => {
            const filePath = convertUriToPath(this.fs, params.item.uri);

            const position: Position = {
                line: params.item.range.start.line,
                character: params.item.range.start.character,
            };

            const workspace = await this.getWorkspaceForFile(filePath);
            if (workspace.disableLanguageServices) {
                return null;
            }

            let callItems = workspace.serviceInstance.getIncomingCallsForPosition(filePath, position, token) || null;
            if (!callItems || callItems.length === 0) {
                return null;
            }

            callItems = callItems.filter((item) => !this.fs.isInZipOrEgg(item.from.uri));

            // Convert the file paths in the items to proper URIs.
            callItems.forEach((item) => {
                item.from.uri = convertPathToUri(this.fs, item.from.uri);
            });

            return callItems;
        });

        this._connection.languages.callHierarchy.onOutgoingCalls(async (params, token) => {
            const filePath = convertUriToPath(this.fs, params.item.uri);

            const position: Position = {
                line: params.item.range.start.line,
                character: params.item.range.start.character,
            };

            const workspace = await this.getWorkspaceForFile(filePath);
            if (workspace.disableLanguageServices) {
                return null;
            }

            let callItems = workspace.serviceInstance.getOutgoingCallsForPosition(filePath, position, token) || null;
            if (!callItems || callItems.length === 0) {
                return null;
            }

            callItems = callItems.filter((item) => !this.fs.isInZipOrEgg(item.to.uri));

            // Convert the file paths in the items to proper URIs.
            callItems.forEach((item) => {
                item.to.uri = convertPathToUri(this.fs, item.to.uri);
            });

            return callItems;
        });

        this._connection.onDidOpenTextDocument(async (params) => {
            const filePath = convertUriToPath(this.fs, params.textDocument.uri);
            if (!(this.fs as PyrightFileSystem).addUriMap(params.textDocument.uri, filePath)) {
                // We do not support opening 1 file with 2 different uri.
                return;
            }

            const workspace = await this.getWorkspaceForFile(filePath);
            workspace.serviceInstance.setFileOpened(filePath, params.textDocument.version, params.textDocument.text);
        });

        this._connection.onDidChangeTextDocument(async (params) => {
            this.recordUserInteractionTime();

            const filePath = convertUriToPath(this.fs, params.textDocument.uri);
            if (!(this.fs as PyrightFileSystem).hasUriMapEntry(params.textDocument.uri, filePath)) {
                // We do not support opening 1 file with 2 different uri.
                return;
            }

            const workspace = await this.getWorkspaceForFile(filePath);
            workspace.serviceInstance.updateOpenFileContents(
                filePath,
                params.textDocument.version,
                params.contentChanges
            );
        });

        this._connection.onDidCloseTextDocument(async (params) => {
            const filePath = convertUriToPath(this.fs, params.textDocument.uri);
            if (!(this.fs as PyrightFileSystem).removeUriMap(params.textDocument.uri, filePath)) {
                // We do not support opening 1 file with 2 different uri.
                return;
            }

            const workspace = await this.getWorkspaceForFile(filePath);
            workspace.serviceInstance.setFileClosed(filePath);
        });

        this._connection.onDidChangeWatchedFiles((params) => {
            params.changes.forEach((change) => {
                const filePath = convertUriToPath(this.fs, change.uri);
                const eventType: FileWatcherEventType = change.type === 1 ? 'add' : 'change';
                this._fileWatcherProvider.onFileChange(eventType, filePath);
            });
        });

        this._connection.onInitialized(() => {
            if (this.client.hasWorkspaceFoldersCapability) {
                this._connection.workspace.onDidChangeWorkspaceFolders((event) => {
                    event.removed.forEach((workspace) => {
                        const rootPath = convertUriToPath(this.fs, workspace.uri);
                        this._workspaceMap.delete(rootPath);
                    });

                    event.added.forEach(async (workspace) => {
                        const rootPath = convertUriToPath(this.fs, workspace.uri);
                        const newWorkspace = this.createWorkspaceServiceInstance(workspace, rootPath);
                        this._workspaceMap.set(rootPath, newWorkspace);
                        await this.updateSettingsForWorkspace(newWorkspace);
                    });
                });
            }

            // Set up our file watchers.
            if (this.client.hasWatchFileCapability) {
                this._connection.client.register(DidChangeWatchedFilesNotification.type, {
                    watchers: [
                        ...configFileNames.map((fileName) => {
                            return {
                                globPattern: `**/${fileName}`,
                                kind: WatchKind.Create | WatchKind.Change | WatchKind.Delete,
                            };
                        }),
                        {
                            globPattern: '**',
                            kind: WatchKind.Create | WatchKind.Change | WatchKind.Delete,
                        },
                    ],
                });
            }
        });

        this._connection.onExecuteCommand(async (params, token, reporter) => {
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
                const progress = await this._getProgressReporter(
                    reporter,
                    Localizer.CodeAction.executingCommand(),
                    token
                );

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
        });
    }

    protected resolveWorkspaceCompletionItem(
        workspace: WorkspaceServiceInstance,
        filePath: string,
        item: CompletionItem,
        token: CancellationToken
    ): void {
        workspace.serviceInstance.resolveCompletionItem(filePath, item, this.getCompletionOptions(), undefined, token);
    }

    protected getWorkspaceCompletionsForPosition(
        workspace: WorkspaceServiceInstance,
        filePath: string,
        position: Position,
        workspacePath: string,
        token: CancellationToken
    ): Promise<CompletionResults | undefined> {
        return workspace.serviceInstance.getCompletionsForPosition(
            filePath,
            position,
            workspacePath,
            this.getCompletionOptions(),
            undefined,
            token
        );
    }

    updateSettingsForAllWorkspaces(): void {
        this._workspaceMap.forEach((workspace) => {
            this.updateSettingsForWorkspace(workspace).ignoreErrors();
        });
    }

    protected getCompletionOptions() {
        return {
            format: this.client.completionDocFormat,
            snippet: this.client.completionSupportsSnippet,
            lazyEdit: this.client.completionItemResolveSupportsAdditionalTextEdits,
        };
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
        this.client.hasWorkspaceFoldersCapability = !!capabilities.workspace?.workspaceFolders;
        this.client.hasVisualStudioExtensionsCapability = !!(capabilities as any).supportsVisualStudioExtensions;
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
        this.client.hasWindowProgressCapability = !!capabilities.window?.workDoneProgress;
        this.client.hasGoToDeclarationCapability = !!capabilities.textDocument?.declaration;
        this.client.completionItemResolveSupportsAdditionalTextEdits =
            !!capabilities.textDocument?.completion?.completionItem?.resolveSupport?.properties.some(
                (p) => p === 'additionalTextEdits'
            );

        // Create a service instance for each of the workspace folders.
        if (params.workspaceFolders) {
            params.workspaceFolders.forEach((folder) => {
                const path = convertUriToPath(this.fs, folder.uri);
                this._workspaceMap.set(path, this.createWorkspaceServiceInstance(folder, path));
            });
        } else if (params.rootPath) {
            this._workspaceMap.set(params.rootPath, this.createWorkspaceServiceInstance(undefined, params.rootPath));
        }

        const result: InitializeResult = {
            capabilities: {
                textDocumentSync: TextDocumentSyncKind.Incremental,
                definitionProvider: { workDoneProgress: true },
                declarationProvider: { workDoneProgress: true },
                referencesProvider: { workDoneProgress: true },
                documentSymbolProvider: { workDoneProgress: true },
                workspaceSymbolProvider: { workDoneProgress: true },
                hoverProvider: { workDoneProgress: true },
                documentHighlightProvider: { workDoneProgress: true },
                renameProvider: { workDoneProgress: true },
                completionProvider: {
                    triggerCharacters: this.client.hasVisualStudioExtensionsCapability ? ['.', '[', '@'] : ['.', '['],
                    resolveProvider: true,
                    workDoneProgress: true,
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
            },
        };

        return result;
    }

    protected createWorkspaceServiceInstance(
        workspace: WorkspaceFolder | undefined,
        rootPath: string
    ): WorkspaceServiceInstance {
        return {
            workspaceName: workspace?.name ?? '',
            rootPath,
            rootUri: workspace?.uri ?? '',
            serviceInstance: this.createAnalyzerService(workspace?.name ?? rootPath),
            disableLanguageServices: false,
            disableOrganizeImports: false,
            isInitialized: createDeferred<boolean>(),
        };
    }

    protected onAnalysisCompletedHandler(results: AnalysisResults): void {
        // Send the computed diagnostics to the client.
        results.diagnostics.forEach((fileDiag) => {
            if (this.fs.isInZipOrEgg(fileDiag.filePath)) {
                return;
            }

            this._connection.sendDiagnostics({
                uri: convertPathToUri(this.fs, fileDiag.filePath),
                version: fileDiag.version,
                diagnostics: this._convertDiagnostics(fileDiag.diagnostics),
            });

            (this.fs as PyrightFileSystem).pendingRequest(fileDiag.filePath, fileDiag.diagnostics.length > 0);
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
        workspace: WorkspaceServiceInstance,
        serverSettings?: ServerSettings
    ): Promise<void> {
        serverSettings = serverSettings ?? (await this.getSettings(workspace));

        // Set logging level first.
        (this.console as ConsoleWithLogLevel).level = serverSettings.logLevel ?? LogLevel.Info;

        this.updateOptionsAndRestartService(workspace, serverSettings);
        workspace.disableLanguageServices = !!serverSettings.disableLanguageServices;
        workspace.disableOrganizeImports = !!serverSettings.disableOrganizeImports;

        // The workspace is now open for business.
        workspace.isInitialized.resolve(true);
    }

    updateOptionsAndRestartService(
        workspace: WorkspaceServiceInstance,
        serverSettings: ServerSettings,
        typeStubTargetImportName?: string
    ) {
        AnalyzerServiceExecutor.runWithOptions(this.rootPath, workspace, serverSettings, typeStubTargetImportName);
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

        const filePath = convertUriToPath(this.fs, params.textDocument.uri);
        const position: Position = {
            line: params.position.line,
            character: params.position.character,
        };

        const workspace = await this.getWorkspaceForFile(filePath);
        if (workspace.disableLanguageServices) {
            return;
        }

        const completions = await this.getWorkspaceCompletionsForPosition(
            workspace,
            filePath,
            position,
            workspace.rootPath,
            token
        );

        if (completions && completions.completionList) {
            completions.completionList.isIncomplete = completionIncomplete;
        }

        return completions?.completionList;
    }

    protected convertLogLevel(logLevelValue?: string): LogLevel {
        if (!logLevelValue) {
            return LogLevel.Info;
        }

        switch (logLevelValue.toLowerCase()) {
            case 'error':
                return LogLevel.Error;

            case 'warning':
                return LogLevel.Warn;

            case 'information':
                return LogLevel.Info;

            case 'trace':
                return LogLevel.Log;

            default:
                return LogLevel.Info;
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
            return { reporter: reporter, source: CancelAfter(token) };
        }

        const serverInitiatedReporter = await this._connection.window.createWorkDoneProgress();
        serverInitiatedReporter.begin(title, undefined, undefined, true);

        return {
            reporter: serverInitiatedReporter,
            source: CancelAfter(token, serverInitiatedReporter.token),
        };
    }

    private _convertDiagnostics(diags: AnalyzerDiagnostic[]): Diagnostic[] {
        const convertedDiags: Diagnostic[] = [];

        diags.forEach((diag) => {
            const severity = convertCategoryToSeverity(diag.category);
            const rule = diag.getRule();
            const vsDiag = Diagnostic.create(diag.range, diag.message, severity, rule, this._serverOptions.productName);

            if (diag.category === DiagnosticCategory.UnusedCode) {
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
                    .filter((info) => !this.fs.isInZipOrEgg(info.filePath))
                    .map((info) =>
                        DiagnosticRelatedInformation.create(
                            Location.create(convertPathToUri(this.fs, info.filePath), info.range),
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
                    return DiagnosticSeverity.Information;

                case DiagnosticCategory.UnusedCode:
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
        this._workspaceMap.forEach((workspace: { serviceInstance: { recordUserInteractionTime: () => void } }) => {
            workspace.serviceInstance.recordUserInteractionTime();
        });
    }

    protected getDocumentationUrlForDiagnosticRule(rule: string): string | undefined {
        // For now, return the same URL for all rules. We can separate these
        // in the future.
        return 'https://github.com/microsoft/pyright/blob/main/docs/configuration.md';
    }

    protected abstract createProgressReporter(): ProgressReporter;

    // Expands certain predefined variables supported within VS Code settings.
    // Ideally, VS Code would provide an API for doing this expansion, but
    // it doesn't. We'll handle the most common variables here as a convenience.
    protected expandPathVariables(rootPath: string, value: string): string {
        const regexp = /\$\{(.*?)\}/g;
        return value.replace(regexp, (match: string, name: string) => {
            const trimmedName = name.trim();
            if (trimmedName === 'workspaceFolder') {
                return rootPath;
            }
            if (trimmedName === 'env:HOME' && process.env.HOME !== undefined) {
                return process.env.HOME;
            }

            return match;
        });
    }
}
