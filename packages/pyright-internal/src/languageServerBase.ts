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

import * as fs from 'fs';
import {
    CancellationToken,
    CancellationTokenSource,
    CodeAction,
    CodeActionParams,
    Command,
    CompletionList,
    CompletionParams,
    CompletionTriggerKind,
    ConfigurationItem,
    Connection,
    ConnectionOptions,
    createConnection,
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
    ParameterInformation,
    RemoteWindow,
    SignatureHelpTriggerKind,
    SignatureInformation,
    SymbolInformation,
    TextDocumentSyncKind,
    WatchKind,
    WorkDoneProgressReporter,
    WorkspaceEdit,
} from 'vscode-languageserver/node';

import { AnalysisResults } from './analyzer/analysis';
import { ImportResolver } from './analyzer/importResolver';
import { MaxAnalysisTime } from './analyzer/program';
import { AnalyzerService, configFileNames } from './analyzer/service';
import { BackgroundAnalysisBase } from './backgroundAnalysisBase';
import { CancelAfter, getCancellationStrategyFromArgv } from './common/cancellationUtils';
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
import {
    createFromRealFileSystem,
    FileSystem,
    FileWatcher,
    FileWatcherEventHandler,
    FileWatcherEventType,
} from './common/fileSystem';
import { containsPath, convertPathToUri, convertUriToPath } from './common/pathUtils';
import { ProgressReporter, ProgressReportTracker } from './common/progressReporter';
import { convertWorkspaceEdits } from './common/textEditUtils';
import { Position } from './common/textRange';
import { AnalyzerServiceExecutor } from './languageService/analyzerServiceExecutor';
import { CompletionItemData } from './languageService/completionProvider';
import { convertHoverResults } from './languageService/hoverProvider';
import { Localizer } from './localization/localize';
import { WorkspaceMap } from './workspaceMap';

export interface ServerSettings {
    venvPath?: string;
    pythonPath?: string;
    typeshedPath?: string;
    stubPath?: string;
    openFilesOnly?: boolean;
    typeCheckingMode?: string;
    useLibraryCodeForTypes?: boolean;
    disableLanguageServices?: boolean;
    disableOrganizeImports?: boolean;
    autoSearchPaths?: boolean;
    extraPaths?: string[];
    watchForSourceChanges?: boolean;
    watchForLibraryChanges?: boolean;
    diagnosticSeverityOverrides?: DiagnosticSeverityOverridesMap;
    logLevel?: LogLevel;
    autoImportCompletions?: boolean;
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

export interface WindowInterface {
    showErrorMessage(message: string): void;
    showWarningMessage(message: string): void;
    showInformationMessage(message: string): void;
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
}

// This is a subset of the LSP Connection, defined to not expose the LSP library
// in the public interface.
export interface ProgressReporterConnection {
    sendNotification: (method: string, params?: any) => void;
}

export interface ServerOptions {
    productName: string;
    rootDirectory: string;
    version: string;
    extension?: LanguageServiceExtension;
    maxAnalysisTimeInForeground?: MaxAnalysisTime;
    supportedCommands?: string[];
    supportedCodeActions?: string[];
    progressReporterFactory?: (connection: ProgressReporterConnection) => ProgressReporter;
}

interface InternalFileWatcher extends FileWatcher {
    // Paths that are being watched within the workspace
    workspacePaths: string[];

    // Event handler to call
    eventHandler: FileWatcherEventHandler;
}

export abstract class LanguageServerBase implements LanguageServerInterface {
    // Create a connection for the server. The connection type can be changed by the process's arguments
    protected _connection: Connection = createConnection(this._GetConnectionOptions());
    protected _workspaceMap: WorkspaceMap;
    protected _hasConfigurationCapability = false;
    protected _hasVisualStudioExtensionsCapability = false;
    protected _hasWorkspaceFoldersCapability = false;
    protected _hasWatchFileCapability = false;
    protected _hasActiveParameterCapability = false;
    protected _hasSignatureLabelOffsetCapability = false;
    protected _defaultClientConfig: any;

    // Tracks active file system watchers.
    private _fileWatchers: InternalFileWatcher[] = [];

    // We support running only one "find all reference" at a time.
    private _pendingFindAllRefsCancellationSource: CancellationTokenSource | undefined;

    // We support running only one command at a time.
    private _pendingCommandCancellationSource: CancellationTokenSource | undefined;

    private _progressReporter: ProgressReporter;

    private _lastTriggerKind: CompletionTriggerKind | undefined = CompletionTriggerKind.Invoked;

    // Global root path - the basis for all global settings.
    rootPath = '';

    // File system abstraction.
    fs: FileSystem;

    readonly console: ConsoleInterface;

    constructor(private _serverOptions: ServerOptions) {
        this.console = new ConsoleWithLogLevel(this._connection.console);

        this.console.info(
            `${_serverOptions.productName} language server ${
                _serverOptions.version && _serverOptions.version + ' '
            }starting`
        );

        this.fs = createFromRealFileSystem(this.console, this);

        // Set the working directory to a known location within
        // the extension directory. Otherwise the execution of
        // python can have unintended and surprising results.
        const moduleDirectory = this.fs.getModulePath();
        if (moduleDirectory) {
            this.fs.chdir(moduleDirectory);
        }

        // Stash the base directory into a global variable.
        (global as any).__rootDirectory = _serverOptions.rootDirectory;
        this.console.info(`Server root directory: ${_serverOptions.rootDirectory}`);

        // Create workspace map.
        this._workspaceMap = new WorkspaceMap(this);

        // Set up callbacks.
        this._setupConnection(_serverOptions.supportedCommands ?? [], _serverOptions.supportedCodeActions ?? []);

        this._progressReporter = new ProgressReportTracker(
            this._serverOptions.progressReporterFactory
                ? this._serverOptions.progressReporterFactory(this._connection)
                : undefined
        );

        // Listen on the connection.
        this._connection.listen();
    }

    abstract createBackgroundAnalysis(): BackgroundAnalysisBase | undefined;

    protected abstract async executeCommand(params: ExecuteCommandParams, token: CancellationToken): Promise<any>;
    protected isLongRunningCommand(command: string): boolean {
        // By default, all commands are considered "long-running" and should
        // display a cancelable progress dialog. Servers can override this
        // to avoid showing the progress dialog for commands that are
        // guaranteed to be quick.
        return true;
    }

    protected abstract async executeCodeAction(
        params: CodeActionParams,
        token: CancellationToken
    ): Promise<(Command | CodeAction)[] | undefined | null>;

    abstract async getSettings(workspace: WorkspaceServiceInstance): Promise<ServerSettings>;

    protected async getConfiguration(scopeUri: string | undefined, section: string) {
        if (this._hasConfigurationCapability) {
            const item: ConfigurationItem = {
                scopeUri,
                section,
            };
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

    protected createImportResolver(fs: FileSystem, options: ConfigOptions): ImportResolver {
        return new ImportResolver(fs, options);
    }

    protected setExtension(extension: any): void {
        this._serverOptions.extension = extension;
    }

    // Provides access to the client's window.
    get window(): RemoteWindow {
        return this._connection.window;
    }

    // Creates a service instance that's used for analyzing a
    // program within a workspace.
    createAnalyzerService(name: string): AnalyzerService {
        this.console.log(`Starting service instance "${name}"`);
        const service = new AnalyzerService(
            name,
            this.fs,
            this.console,
            this.createImportResolver.bind(this),
            undefined,
            this._serverOptions.extension,
            this.createBackgroundAnalysis(),
            this._serverOptions.maxAnalysisTimeInForeground
        );

        service.setCompletionCallback((results) => this.onAnalysisCompletedHandler(results));

        return service;
    }

    async getWorkspaceForFile(filePath: string): Promise<WorkspaceServiceInstance> {
        const workspace = this._workspaceMap.getWorkspaceForFile(filePath);
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

    createFileWatcher(paths: string[], listener: FileWatcherEventHandler): FileWatcher {
        // Capture "this" so we can reference it within the "close" method below.
        const lsBase = this;

        // Determine which paths are located within one or more workspaces.
        // Those are already covered by existing file watchers handled by
        // the client.
        const workspacePaths: string[] = [];
        const nonWorkspacePaths: string[] = [];
        const workspaces = this._workspaceMap.getNonDefaultWorkspaces();

        paths.forEach((path) => {
            if (workspaces.some((workspace) => containsPath(workspace.rootPath, path))) {
                workspacePaths.push(path);
            } else {
                nonWorkspacePaths.push(path);
            }
        });

        // For any non-workspace paths, use the node file watcher.
        const nodeWatchers = nonWorkspacePaths.map((path) => {
            return fs.watch(path, { recursive: true }, (event, filename) =>
                listener(event as FileWatcherEventType, filename)
            );
        });

        const fileWatcher: InternalFileWatcher = {
            close() {
                // Stop listening for workspace paths.
                lsBase._fileWatchers = lsBase._fileWatchers.filter((watcher) => watcher !== fileWatcher);

                // Close the node watchers.
                nodeWatchers.forEach((watcher) => {
                    watcher.close();
                });
            },
            workspacePaths,
            eventHandler: listener,
        };

        // Record the file watcher.
        this._fileWatchers.push(fileWatcher);

        return fileWatcher;
    }

    private _setupConnection(supportedCommands: string[], supportedCodeActions: string[]): void {
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

        this._connection.onDefinition(async (params, token) => {
            this.recordUserInteractionTime();

            const filePath = convertUriToPath(params.textDocument.uri);

            const position: Position = {
                line: params.position.line,
                character: params.position.character,
            };

            const workspace = await this.getWorkspaceForFile(filePath);
            if (workspace.disableLanguageServices) {
                return;
            }
            const locations = workspace.serviceInstance.getDefinitionForPosition(filePath, position, token);
            if (!locations) {
                return undefined;
            }
            return locations.map((loc) => Location.create(convertPathToUri(loc.path), loc.range));
        });

        this._connection.onReferences(async (params, token, reporter) => {
            if (this._pendingFindAllRefsCancellationSource) {
                this._pendingFindAllRefsCancellationSource.cancel();
                this._pendingFindAllRefsCancellationSource = undefined;
            }

            // VS Code doesn't support cancellation of "final all references".
            // We provide a progress bar a cancellation button so the user can cancel
            // any long-running actions.
            const progress = await this._getProgressReporter(
                params.workDoneToken,
                reporter,
                Localizer.CodeAction.findingReferences()
            );
            const source = CancelAfter(token, progress.token);
            this._pendingFindAllRefsCancellationSource = source;

            try {
                const filePath = convertUriToPath(params.textDocument.uri);
                const position: Position = {
                    line: params.position.line,
                    character: params.position.character,
                };

                const workspace = await this.getWorkspaceForFile(filePath);
                if (workspace.disableLanguageServices) {
                    return;
                }

                const locations = workspace.serviceInstance.getReferencesForPosition(
                    filePath,
                    position,
                    params.context.includeDeclaration,
                    source.token
                );

                if (!locations) {
                    return undefined;
                }

                return locations.map((loc) => Location.create(convertPathToUri(loc.path), loc.range));
            } finally {
                progress.reporter.done();
                source.dispose();
            }
        });

        this._connection.onDocumentSymbol(async (params, token) => {
            this.recordUserInteractionTime();

            const filePath = convertUriToPath(params.textDocument.uri);

            const workspace = await this.getWorkspaceForFile(filePath);
            if (workspace.disableLanguageServices) {
                return undefined;
            }

            const symbolList: DocumentSymbol[] = [];
            workspace.serviceInstance.addSymbolsForDocument(filePath, symbolList, token);
            return symbolList;
        });

        this._connection.onWorkspaceSymbol(async (params, token) => {
            const symbolList: SymbolInformation[] = [];

            this._workspaceMap.forEach(async (workspace) => {
                await workspace.isInitialized.promise;
                if (!workspace.disableLanguageServices) {
                    workspace.serviceInstance.addSymbolsForWorkspace(symbolList, params.query, token);
                }
            });

            return symbolList;
        });

        this._connection.onHover(async (params, token) => {
            const filePath = convertUriToPath(params.textDocument.uri);

            const position: Position = {
                line: params.position.line,
                character: params.position.character,
            };

            const workspace = await this.getWorkspaceForFile(filePath);
            const hoverResults = workspace.serviceInstance.getHoverForPosition(filePath, position, token);
            return convertHoverResults(hoverResults);
        });

        this._connection.onDocumentHighlight(async (params, token) => {
            const filePath = convertUriToPath(params.textDocument.uri);

            const position: Position = {
                line: params.position.line,
                character: params.position.character,
            };

            const workspace = await this.getWorkspaceForFile(filePath);
            return workspace.serviceInstance.getDocumentHighlight(filePath, position, token);
        });

        this._connection.onSignatureHelp(async (params, token) => {
            const filePath = convertUriToPath(params.textDocument.uri);

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
                            this._hasSignatureLabelOffsetCapability ? [param.startOffset, param.endOffset] : param.text,
                            param.documentation
                        )
                    );
                }

                const sigInfo = SignatureInformation.create(sig.label, sig.documentation, ...paramInfo);
                sigInfo.activeParameter = sig.activeParameter;
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

            if (this._hasActiveParameterCapability || activeSignature === null) {
                // A value of -1 is out of bounds but is legal within the LSP (should be treated
                // as undefined). It produces a better result in VS Code by preventing it from
                // highlighting the first parameter when no parameter works, since the LSP client
                // converts null into zero.
                activeParameter = -1;
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
                workspace.serviceInstance.resolveCompletionItem(completionItemData.filePath, params, token);
            }
            return params;
        });

        this._connection.onRenameRequest(async (params, token) => {
            const filePath = convertUriToPath(params.textDocument.uri);

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
                token
            );

            if (!editActions) {
                return undefined;
            }

            return convertWorkspaceEdits(editActions);
        });

        this._connection.languages.callHierarchy.onPrepare(async (params, token) => {
            const filePath = convertUriToPath(params.textDocument.uri);

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

            // Convert the file path in the item to proper URI.
            callItem.uri = convertPathToUri(callItem.uri);

            return [callItem];
        });

        this._connection.languages.callHierarchy.onIncomingCalls(async (params, token) => {
            const filePath = convertUriToPath(params.item.uri);

            const position: Position = {
                line: params.item.range.start.line,
                character: params.item.range.start.character,
            };

            const workspace = await this.getWorkspaceForFile(filePath);
            if (workspace.disableLanguageServices) {
                return null;
            }

            const callItems = workspace.serviceInstance.getIncomingCallsForPosition(filePath, position, token) || null;
            if (!callItems || callItems.length === 0) {
                return null;
            }

            // Convert the file paths in the items to proper URIs.
            callItems.forEach((item) => {
                item.from.uri = convertPathToUri(item.from.uri);
            });

            return callItems;
        });

        this._connection.languages.callHierarchy.onOutgoingCalls(async (params, token) => {
            const filePath = convertUriToPath(params.item.uri);

            const position: Position = {
                line: params.item.range.start.line,
                character: params.item.range.start.character,
            };

            const workspace = await this.getWorkspaceForFile(filePath);
            if (workspace.disableLanguageServices) {
                return null;
            }

            const callItems = workspace.serviceInstance.getOutgoingCallsForPosition(filePath, position, token) || null;
            if (!callItems || callItems.length === 0) {
                return null;
            }

            // Convert the file paths in the items to proper URIs.
            callItems.forEach((item) => {
                item.to.uri = convertPathToUri(item.to.uri);
            });

            return callItems;
        });

        this._connection.onDidOpenTextDocument(async (params) => {
            const filePath = convertUriToPath(params.textDocument.uri);
            const workspace = await this.getWorkspaceForFile(filePath);
            workspace.serviceInstance.setFileOpened(filePath, params.textDocument.version, params.textDocument.text);
        });

        this._connection.onDidChangeTextDocument(async (params) => {
            this.recordUserInteractionTime();

            const filePath = convertUriToPath(params.textDocument.uri);
            const workspace = await this.getWorkspaceForFile(filePath);
            workspace.serviceInstance.updateOpenFileContents(
                filePath,
                params.textDocument.version,
                params.contentChanges[0].text
            );
        });

        this._connection.onDidCloseTextDocument(async (params) => {
            const filePath = convertUriToPath(params.textDocument.uri);
            const workspace = await this.getWorkspaceForFile(filePath);
            workspace.serviceInstance.setFileClosed(filePath);
        });

        this._connection.onDidChangeWatchedFiles((params) => {
            params.changes.forEach((change) => {
                const filePath = convertUriToPath(change.uri);
                const eventType: FileWatcherEventType = change.type === 1 ? 'add' : 'change';
                this._fileWatchers.forEach((watcher) => {
                    if (watcher.workspacePaths.some((dirPath) => containsPath(dirPath, filePath))) {
                        watcher.eventHandler(eventType, filePath);
                    }
                });
            });
        });

        this._connection.onInitialized(() => {
            if (this._hasWorkspaceFoldersCapability) {
                this._connection.workspace.onDidChangeWorkspaceFolders((event) => {
                    event.removed.forEach((workspace) => {
                        const rootPath = convertUriToPath(workspace.uri);
                        this._workspaceMap.delete(rootPath);
                    });

                    event.added.forEach(async (workspace) => {
                        const rootPath = convertUriToPath(workspace.uri);
                        const newWorkspace: WorkspaceServiceInstance = {
                            workspaceName: workspace.name,
                            rootPath,
                            rootUri: workspace.uri,
                            serviceInstance: this.createAnalyzerService(workspace.name),
                            disableLanguageServices: false,
                            disableOrganizeImports: false,
                            isInitialized: createDeferred<boolean>(),
                        };
                        this._workspaceMap.set(rootPath, newWorkspace);
                        await this.updateSettingsForWorkspace(newWorkspace);
                    });
                });
            }

            // Set up our file watchers.
            if (this._hasWatchFileCapability) {
                this._connection.client.register(DidChangeWatchedFilesNotification.type, {
                    watchers: [
                        ...configFileNames.map((fileName) => {
                            return {
                                globPattern: `**/${fileName}`,
                                kind: WatchKind.Create | WatchKind.Change | WatchKind.Delete,
                            };
                        }),
                        {
                            globPattern: '**/*.{py,pyi}',
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
                    this._connection.workspace.applyEdit(result);
                }
            };

            if (this.isLongRunningCommand(params.command)) {
                // Create a progress dialog for long-running commands.
                const progress = await this._getProgressReporter(
                    params.workDoneToken,
                    reporter,
                    Localizer.CodeAction.executingCommand()
                );
                const source = CancelAfter(token, progress.token);
                this._pendingCommandCancellationSource = source;

                try {
                    executeCommand(source.token);
                } finally {
                    progress.reporter.done();
                    source.dispose();
                }
            } else {
                executeCommand(token);
            }
        });
    }

    updateSettingsForAllWorkspaces(): void {
        this._workspaceMap.forEach((workspace) => {
            this.updateSettingsForWorkspace(workspace).ignoreErrors();
        });
    }

    protected initialize(
        params: InitializeParams,
        supportedCommands: string[],
        supportedCodeActions: string[]
    ): InitializeResult {
        this.rootPath = params.rootPath || '';

        const capabilities = params.capabilities;
        this._hasConfigurationCapability = !!capabilities.workspace?.configuration;
        this._hasWatchFileCapability = !!capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration;
        this._hasWorkspaceFoldersCapability = !!capabilities.workspace?.workspaceFolders;
        this._hasVisualStudioExtensionsCapability = !!(capabilities as any).supportsVisualStudioExtensions;
        this._hasActiveParameterCapability = !!capabilities.textDocument?.signatureHelp?.signatureInformation
            ?.activeParameterSupport;
        this._hasSignatureLabelOffsetCapability = !!capabilities.textDocument?.signatureHelp?.signatureInformation
            ?.parameterInformation?.labelOffsetSupport;

        // Create a service instance for each of the workspace folders.
        if (params.workspaceFolders) {
            params.workspaceFolders.forEach((folder) => {
                const path = convertUriToPath(folder.uri);
                this._workspaceMap.set(path, {
                    workspaceName: folder.name,
                    rootPath: path,
                    rootUri: folder.uri,
                    serviceInstance: this.createAnalyzerService(folder.name),
                    disableLanguageServices: false,
                    disableOrganizeImports: false,
                    isInitialized: createDeferred<boolean>(),
                });
            });
        } else if (params.rootPath) {
            this._workspaceMap.set(params.rootPath, {
                workspaceName: '',
                rootPath: params.rootPath,
                rootUri: '',
                serviceInstance: this.createAnalyzerService(params.rootPath),
                disableLanguageServices: false,
                disableOrganizeImports: false,
                isInitialized: createDeferred<boolean>(),
            });
        }

        const result: InitializeResult = {
            capabilities: {
                // Tell the client that the server works in FULL text document
                // sync mode (as opposed to incremental).
                textDocumentSync: TextDocumentSyncKind.Full,
                definitionProvider: { workDoneProgress: true },
                referencesProvider: { workDoneProgress: true },
                documentSymbolProvider: { workDoneProgress: true },
                workspaceSymbolProvider: { workDoneProgress: true },
                hoverProvider: { workDoneProgress: true },
                documentHighlightProvider: { workDoneProgress: true },
                renameProvider: { workDoneProgress: true },
                completionProvider: {
                    triggerCharacters: ['.', '['],
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

    protected onAnalysisCompletedHandler(results: AnalysisResults): void {
        // Send the computed diagnostics to the client.
        results.diagnostics.forEach((fileDiag) => {
            this._connection.sendDiagnostics({
                uri: convertPathToUri(fileDiag.filePath),
                diagnostics: this._convertDiagnostics(fileDiag.diagnostics),
            });
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

    async updateSettingsForWorkspace(workspace: WorkspaceServiceInstance): Promise<void> {
        const serverSettings = await this.getSettings(workspace);

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

        const filePath = convertUriToPath(params.textDocument.uri);
        const position: Position = {
            line: params.position.line,
            character: params.position.character,
        };

        const workspace = await this.getWorkspaceForFile(filePath);
        if (workspace.disableLanguageServices) {
            return;
        }

        const completions = await workspace.serviceInstance.getCompletionsForPosition(
            filePath,
            position,
            workspace.rootPath,
            token
        );

        if (completions) {
            completions.isIncomplete = completionIncomplete;
        }

        return completions;
    }

    protected convertLogLevel(logLevel?: string): LogLevel {
        if (!logLevel) {
            return LogLevel.Info;
        }

        switch (logLevel.toLowerCase()) {
            case 'error':
                return LogLevel.Error;

            case 'warning':
                return LogLevel.Warn;

            case 'info':
                return LogLevel.Info;

            case 'trace':
                return LogLevel.Log;

            default:
                return LogLevel.Info;
        }
    }

    private async _getProgressReporter(
        workDoneToken: string | number | undefined,
        clientReporter: WorkDoneProgressReporter,
        title: string
    ) {
        if (workDoneToken) {
            return { reporter: clientReporter, token: CancellationToken.None };
        }

        const serverInitiatedReporter = await this._connection.window.createWorkDoneProgress();
        serverInitiatedReporter.begin(title, undefined, undefined, true);

        return {
            reporter: serverInitiatedReporter,
            token: serverInitiatedReporter.token,
        };
    }

    private _GetConnectionOptions(): ConnectionOptions {
        return { cancellationStrategy: getCancellationStrategyFromArgv(process.argv) };
    }

    private _convertDiagnostics(diags: AnalyzerDiagnostic[]): Diagnostic[] {
        return diags.map((diag) => {
            const severity = convertCategoryToSeverity(diag.category);

            let source = this._serverOptions.productName;
            const rule = diag.getRule();
            if (rule) {
                source = `${source} (${rule})`;
            }

            const vsDiag = Diagnostic.create(diag.range, diag.message, severity, undefined, source);

            if (diag.category === DiagnosticCategory.UnusedCode) {
                vsDiag.tags = [DiagnosticTag.Unnecessary];
                vsDiag.severity = DiagnosticSeverity.Hint;
            }

            const relatedInfo = diag.getRelatedInfo();
            if (relatedInfo.length > 0) {
                vsDiag.relatedInformation = relatedInfo.map((info) => {
                    return DiagnosticRelatedInformation.create(
                        Location.create(convertPathToUri(info.filePath), info.range),
                        info.message
                    );
                });
            }

            return vsDiag;
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
                    return DiagnosticSeverity.Hint;
            }
        }
    }

    protected recordUserInteractionTime() {
        // Tell all of the services that the user is actively
        // interacting with one or more editors, so they should
        // back off from performing any work.
        this._workspaceMap.forEach((workspace: { serviceInstance: { recordUserInteractionTime: () => void } }) => {
            workspace.serviceInstance.recordUserInteractionTime();
        });
    }
}
