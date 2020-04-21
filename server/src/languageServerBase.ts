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
    CodeActionKind,
    CodeActionParams,
    Command,
    CompletionTriggerKind,
    ConfigurationItem,
    ConnectionOptions,
    createConnection,
    Diagnostic,
    DiagnosticRelatedInformation,
    DiagnosticSeverity,
    DiagnosticTag,
    DidChangeWatchedFilesNotification,
    DocumentSymbol,
    ExecuteCommandParams,
    IConnection,
    InitializeResult,
    Location,
    ParameterInformation,
    RemoteConsole,
    RemoteWindow,
    SignatureInformation,
    SymbolInformation,
    TextDocumentSyncKind,
    TextEdit,
    WatchKind,
    WorkspaceEdit,
} from 'vscode-languageserver';

import { AnalysisResults } from './analyzer/analysis';
import { ImportResolver } from './analyzer/importResolver';
import { MaxAnalysisTime } from './analyzer/program';
import { AnalyzerService, configFileNames } from './analyzer/service';
import { BackgroundAnalysisBase } from './backgroundAnalysisBase';
import { CancelAfter, getCancellationStrategyFromArgv } from './common/cancellationUtils';
import { getNestedProperty } from './common/collectionUtils';
import { ConfigOptions } from './common/configOptions';
import { ConsoleInterface } from './common/console';
import { createDeferred, Deferred } from './common/deferred';
import { Diagnostic as AnalyzerDiagnostic, DiagnosticCategory } from './common/diagnostic';
import { LanguageServiceExtension } from './common/extensibility';
import {
    createFromRealFileSystem,
    FileSystem,
    FileWatcher,
    FileWatcherEventHandler,
    FileWatcherEventType,
} from './common/fileSystem';
import { containsPath, convertPathToUri, convertUriToPath } from './common/pathUtils';
import { Position } from './common/textRange';
import { AnalyzerServiceExecutor } from './languageService/analyzerServiceExecutor';
import { CompletionItemData } from './languageService/completionProvider';
import { convertHoverResults } from './languageService/hoverProvider';
import { WorkspaceMap } from './workspaceMap';

export interface ServerSettings {
    venvPath?: string;
    pythonPath?: string;
    typeshedPath?: string;
    openFilesOnly?: boolean;
    typeCheckingMode?: string;
    useLibraryCodeForTypes?: boolean;
    disableLanguageServices?: boolean;
    disableOrganizeImports?: boolean;
    autoSearchPaths?: boolean;
    watchForLibraryChanges?: boolean;
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

interface InternalFileWatcher extends FileWatcher {
    // Paths that are being watched within the workspace
    workspacePaths: string[];

    // Event handler to call
    eventHandler: FileWatcherEventHandler;
}

export abstract class LanguageServerBase implements LanguageServerInterface {
    // Create a connection for the server. The connection type can be changed by the process's arguments
    protected _connection: IConnection = createConnection(this._GetConnectionOptions());
    protected _workspaceMap: WorkspaceMap;
    protected _hasConfigurationCapability = false;
    protected _hasWatchFileCapability = false;
    protected _defaultClientConfig: any;

    // Tracks whether we're currently displaying progress.
    private _isDisplayingProgress = false;

    // Tracks active file system watchers.
    private _fileWatchers: InternalFileWatcher[] = [];

    // Global root path - the basis for all global settings.
    rootPath = '';

    // File system abstraction.
    fs: FileSystem;

    constructor(
        private _productName: string,
        rootDirectory: string,
        private _extension?: LanguageServiceExtension,
        private _maxAnalysisTimeInForeground?: MaxAnalysisTime
    ) {
        this._connection.console.log(`${_productName} language server starting`);
        this.fs = createFromRealFileSystem(this._connection.console, this);

        // Set the working directory to a known location within
        // the extension directory. Otherwise the execution of
        // python can have unintended and surprising results.
        const moduleDirectory = this.fs.getModulePath();
        if (moduleDirectory) {
            this.fs.chdir(moduleDirectory);
        }

        // Stash the base directory into a global variable.
        (global as any).__rootDirectory = rootDirectory;
        this._connection.console.log(`Server root directory: ${rootDirectory}`);

        // Create workspace map.
        this._workspaceMap = new WorkspaceMap(this);

        // Set up callbacks.
        this._setupConnection();

        // Listen on the connection.
        this._connection.listen();
    }

    abstract createBackgroundAnalysis(): BackgroundAnalysisBase | undefined;
    protected abstract async executeCommand(params: ExecuteCommandParams, token: CancellationToken): Promise<any>;
    protected abstract async executeCodeAction(
        params: CodeActionParams,
        token: CancellationToken
    ): Promise<(Command | CodeAction)[] | undefined | null>;

    abstract async getSettings(workspace: WorkspaceServiceInstance): Promise<ServerSettings>;

    protected getConfiguration(workspace: WorkspaceServiceInstance, section: string) {
        if (this._hasConfigurationCapability) {
            const scopeUri = workspace.rootUri ? workspace.rootUri : undefined;
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

    protected createImportResolver(fs: FileSystem, options: ConfigOptions): ImportResolver {
        return new ImportResolver(fs, options);
    }

    protected setExtension(extension: any): void {
        this._extension = extension;
    }

    // Provides access to logging to the client output window.
    get console(): RemoteConsole {
        return this._connection.console;
    }

    // Provides access to the client's window.
    get window(): RemoteWindow {
        return this._connection.window;
    }

    // Creates a service instance that's used for analyzing a
    // program within a workspace.
    createAnalyzerService(name: string): AnalyzerService {
        this._connection.console.log(`Starting service instance "${name}"`);
        const service = new AnalyzerService(
            name,
            this.fs,
            this._connection.console,
            this.createImportResolver.bind(this),
            undefined,
            this._extension,
            this.createBackgroundAnalysis(),
            this._maxAnalysisTimeInForeground
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
            return fs.watch(path, { recursive: true }, listener);
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

    private _setupConnection(): void {
        // After the server has started the client sends an initialize request. The server receives
        // in the passed params the rootPath of the workspace plus the client capabilities.
        this._connection.onInitialize(
            (params): InitializeResult => {
                this.rootPath = params.rootPath || '';

                // Does the client support the `workspace/configuration` request?
                const capabilities = params.capabilities;
                this._hasConfigurationCapability = !!capabilities.workspace?.configuration;
                this._hasWatchFileCapability = !!capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration;

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

                return {
                    capabilities: {
                        // Tell the client that the server works in FULL text document
                        // sync mode (as opposed to incremental).
                        textDocumentSync: TextDocumentSyncKind.Full,
                        definitionProvider: { workDoneProgress: true },
                        referencesProvider: { workDoneProgress: true },
                        documentSymbolProvider: { workDoneProgress: true },
                        workspaceSymbolProvider: { workDoneProgress: true },
                        hoverProvider: { workDoneProgress: true },
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
                            codeActionKinds: [CodeActionKind.QuickFix, CodeActionKind.SourceOrganizeImports],
                            workDoneProgress: true,
                        },
                        executeCommandProvider: {
                            commands: [],
                            workDoneProgress: true,
                        },
                    },
                };
            }
        );

        this._connection.onDidChangeConfiguration((params) => {
            this._connection.console.log(`Received updated settings`);
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

        this._connection.onReferences(async (params, token) => {
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
                token
            );
            if (!locations) {
                return undefined;
            }
            return locations.map((loc) => Location.create(convertPathToUri(loc.path), loc.range));
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

            return {
                signatures: signatureHelpResults.signatures.map((sig) => {
                    let paramInfo: ParameterInformation[] = [];
                    if (sig.parameters) {
                        paramInfo = sig.parameters.map((param) => {
                            return ParameterInformation.create(
                                [param.startOffset, param.endOffset],
                                param.documentation
                            );
                        });
                    }
                    return SignatureInformation.create(sig.label, sig.documentation, ...paramInfo);
                }),
                activeSignature:
                    signatureHelpResults.activeSignature !== undefined ? signatureHelpResults.activeSignature : null,
                // A value of -1 is out of bounds but is legal within the LSP (should be treated
                // as undefined). It produces a better result in VS Code by preventing it from
                // highlighting the first parameter when no parameter works, since the LSP client
                // converts null into zero.
                activeParameter:
                    signatureHelpResults.activeParameter !== undefined ? signatureHelpResults.activeParameter : -1,
            };
        });

        let lastTriggerKind: CompletionTriggerKind | undefined = CompletionTriggerKind.Invoked;
        this._connection.onCompletion(async (params, token) => {
            // we set completion incomplete for the very first invocation and next consecutive call
            // but after that, we mark it as completed so that client doesn't repeatedly call us back.
            // we mark the very first one as incomplete since completion could be invoked without
            // any meaingful character written yet; such as explict completion invocation (ctrl+space)
            // or pd. <= after dot. that might cause us to not include some items (ex, auto-imports)
            // the next consecutive call is so that we have some characters written to help us to pick
            // better completion items.
            // after that, we are not going to introduce new items so we can let client to do the filtering
            // and caching.
            const completionIncomplete =
                lastTriggerKind !== CompletionTriggerKind.TriggerForIncompleteCompletions ||
                params.context?.triggerKind !== CompletionTriggerKind.TriggerForIncompleteCompletions;

            lastTriggerKind = params.context?.triggerKind;

            const filePath = convertUriToPath(params.textDocument.uri);

            const position: Position = {
                line: params.position.line,
                character: params.position.character,
            };

            const workspace = await this.getWorkspaceForFile(filePath);
            if (workspace.disableLanguageServices) {
                return;
            }

            const completions = workspace.serviceInstance.getCompletionsForPosition(
                filePath,
                position,
                workspace.rootPath,
                token
            );

            if (completions) {
                completions.isIncomplete = completionIncomplete;
            }

            return completions;
        });

        this._connection.onCompletionResolve(async (params, token) => {
            // cancellation bugs in vscode and lsp
            // https://github.com/microsoft/vscode-languageserver-node/issues/615
            // https://github.com/microsoft/vscode/issues/95485
            //
            // bugs are if resolver throws cancellation exception, lsp and vscode
            // cache that result and never call us back
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

            const edits: WorkspaceEdit = {
                changes: {},
            };
            editActions.forEach((editAction) => {
                const uri = convertPathToUri(editAction.filePath);
                if (edits.changes![uri] === undefined) {
                    edits.changes![uri] = [];
                }

                const textEdit: TextEdit = {
                    range: editAction.range,
                    newText: editAction.replacementText,
                };
                edits.changes![uri].push(textEdit);
            });

            return edits;
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
                            globPattern: '**/*.{py,pyi,pyd}',
                            kind: WatchKind.Create | WatchKind.Change | WatchKind.Delete,
                        },
                    ],
                });
            }
        });

        // We support running only one command at a time.
        let lastCancellationSource: CancellationTokenSource;
        this._connection.onExecuteCommand(async (params, token) => {
            if (lastCancellationSource) {
                // Cancel running command if there is one.
                lastCancellationSource.cancel();
            }

            const progress = await this._connection.window.createWorkDoneProgress();
            const source = CancelAfter(token, progress.token);
            lastCancellationSource = source;

            try {
                return await this.executeCommand(params, source.token);
            } finally {
                progress.done();
                source.dispose();
            }
        });
    }

    updateSettingsForAllWorkspaces(): void {
        this._workspaceMap.forEach((workspace) => {
            this.updateSettingsForWorkspace(workspace).ignoreErrors();
        });
    }

    protected onAnalysisCompletedHandler(results: AnalysisResults): void {
        results.diagnostics.forEach((fileDiag) => {
            const diagnostics = this._convertDiagnostics(fileDiag.diagnostics);

            // Send the computed diagnostics to the client.
            this._connection.sendDiagnostics({
                uri: convertPathToUri(fileDiag.filePath),
                diagnostics,
            });

            if (results.filesRequiringAnalysis > 0) {
                if (!results.checkingOnlyOpenFiles) {
                    // Display a progress spinner if we're checking the entire program.
                    if (!this._isDisplayingProgress) {
                        this._isDisplayingProgress = true;
                        this._connection.sendNotification('pyright/beginProgress');
                    }

                    const fileOrFiles = results.filesRequiringAnalysis !== 1 ? 'files' : 'file';
                    this._connection.sendNotification(
                        'pyright/reportProgress',
                        `${results.filesRequiringAnalysis} ${fileOrFiles} to analyze`
                    );
                }
            } else {
                if (this._isDisplayingProgress) {
                    this._isDisplayingProgress = false;
                    this._connection.sendNotification('pyright/endProgress');
                }
            }
        });
    }

    async updateSettingsForWorkspace(workspace: WorkspaceServiceInstance): Promise<void> {
        const serverSettings = await this.getSettings(workspace);
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

    private _GetConnectionOptions(): ConnectionOptions {
        return { cancellationStrategy: getCancellationStrategyFromArgv(process.argv) };
    }

    private _convertDiagnostics(diags: AnalyzerDiagnostic[]): Diagnostic[] {
        return diags.map((diag) => {
            const severity =
                diag.category === DiagnosticCategory.Error ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning;

            let source = this._productName;
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
    }

    protected recordUserInteractionTime() {
        // Tell all of the services that the user is actively
        // interacting with one or more editors, so they should
        // back off from performing any work.
        this._workspaceMap.forEach((workspace) => {
            workspace.serviceInstance.recordUserInteractionTime();
        });
    }
}
