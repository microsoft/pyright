/*
 * server.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Defines a language server that is also a type server. The language-server parts are used
 * to initialize and manage documents; the type-server parts answer Type Server Protocol
 * (TSP) requests with type information for those documents.
 *
 * This is the Pyright-native port of Pylance's `type-server/src/server/typeServer.ts`. It
 * is rebased onto Pyright's own infrastructure (`LanguageServerBase`, `WorkspaceFactory`,
 * `ImportResolver`, `BackgroundAnalysisProgram`) instead of the Pylance subclasses. Type
 * queries are answered synchronously by Pyright's evaluator through the `ProgramWrapper`;
 * cancellation is file/token based like the rest of Pyright, so long-running queries can
 * still be interrupted mid-request.
 *
 * Feature notes:
 *   - Telemetry and profiling are intentionally omitted (Pyright has no telemetry).
 *   - Notebook support and the virtual-file-redirect supplemental are layered in by later
 *     phases; the seams (`_notebookManager`, overlay file system) are left in place.
 */

import { CancellationToken, Connection, Diagnostic, WorkDoneProgressServerReporter } from 'vscode-languageserver';
import {
    CodeActionParams,
    DidChangeNotebookDocumentParams,
    DidCloseNotebookDocumentParams,
    DidOpenNotebookDocumentParams,
    DidOpenTextDocumentParams,
    DocumentDiagnosticParams,
    DocumentDiagnosticReport,
    ExecuteCommandParams,
    InitializeParams,
    InitializeResult,
} from 'vscode-languageserver-protocol';
import { CodeAction, Command } from 'vscode-languageserver-types';

import { AnalysisResults } from '../analyzer/analysis';
import { getFileInfo } from '../analyzer/analyzerNodeInfo';
import { InvalidatedReason } from '../analyzer/backgroundAnalysisProgram';
import { Declaration } from '../analyzer/declaration';
import { ImportResolver } from '../analyzer/importResolver';
import { isPythonBinary } from '../analyzer/pythonPathUtils';
import { IPythonMode } from '../analyzer/sourceFile';
import { Type } from '../analyzer/types';
import { IBackgroundAnalysis } from '../backgroundAnalysisBase';
import { ConfigOptions } from '../common/configOptions';
import { convertLogLevel, LogLevel } from '../common/console';
import { isDefined, isString } from '../common/core';
import { Diagnostic as AnalyzerDiagnostic } from '../common/diagnostic';
import { resolvePathWithEnvVariables } from '../common/envVarUtils';
import { FullAccessHost } from '../common/fullAccessHost';
import { Host } from '../common/host';
import { ServerOptions, ServerSettings } from '../common/languageServerInterface';
import { ProgressReporter } from '../common/progressReporter';
import { ServiceProvider } from '../common/serviceProvider';
import { Uri } from '../common/uri/uri';
import { LanguageServerBase } from '../languageServerBase';
import { canNavigateToFile } from '../languageService/navigationUtils';
import { ParseNode } from '../parser/parseNodes';
import { WellKnownWorkspaceKinds, Workspace } from '../workspaceFactory';

import { ServerCanceledException } from './cancellation';
import { convertFromPyrightDiagnostic } from './diagnosticUtils';
import { AnyNotebookDocumentSelector } from './notebookCellChain';
import { NotebookDocumentHandler } from './notebookDocumentHandler';
import { INotebookUriMapper, NotebookUriMapper } from './notebookUriMapper';
import { makeProgram, ProgramWrapper } from './programWrapper';
import { TspSupplemental } from './protocol/tspSupplemental';
import { TypeServerProtocol } from './protocol/typeServerProtocol';
import { convertLspUriStringToUri } from './serverUtils';
import { fromProtocolDecl, fromProtocolNode } from './typeServerConversionTypes';
import { ProtocolTypeFactory } from './typeServerConversionUtils';
import { isDeclaration } from './typeEvalUtils';
import { ITypeCache, TypeCache } from './typeCache';
import { TypeServerFileSystem } from './typeServerFileSystem';
import { TypeServerServiceKeys } from './typeServerServiceKeys';

export class TypeServer extends LanguageServerBase {
    private readonly _handleToUriMap = new Map<number, Uri>();
    private _initializedComplete = false;
    private _globalTypeCache: ITypeCache;
    private _notebookManager: NotebookDocumentHandler | undefined;
    private readonly _uriMapper: INotebookUriMapper | undefined;

    constructor(serverOptions: ServerOptions, connection: Connection) {
        super(serverOptions, connection);
        this._uriMapper = serverOptions.serviceProvider.tryGet(TypeServerServiceKeys.uriMapper);
        this._globalTypeCache = new TypeCache(serverOptions.serviceProvider, this._getParserOutput.bind(this));
        this._globalTypeCache.snapshotChanged(this._onSnapshotChanged.bind(this));
    }

    override dispose() {
        super.dispose();
    }

    override async getWorkspaceForFile(fileUri: Uri, pythonPath?: Uri): Promise<Workspace> {
        // If this is a notebook cell and no python path was passed in, use the last known
        // python path for the containing notebook so cells resolve to the workspace with the
        // matching pythonPath.
        if (NotebookUriMapper.isNotebookCell(fileUri) && this._notebookManager) {
            const notebookData = await this._notebookManager.getNotebookDataForCell(fileUri);
            if (pythonPath === undefined) {
                pythonPath = notebookData?.pythonPath;
            }

            // Map the vscode-notebook-cell: URI to its file-scheme equivalent so the workspace
            // factory can match it against workspace root URIs.
            fileUri = this._uriMapper!.getMappedCellUri(fileUri);
        }

        return this.workspaceFactory.getWorkspaceForFile(fileUri, pythonPath);
    }

    override async getContainingWorkspacesForFile(fileUri: Uri): Promise<Workspace[]> {
        // If this is a notebook cell we should wait for the notebook to open first.
        if (NotebookUriMapper.isNotebookCell(fileUri) && this._notebookManager) {
            await this._notebookManager.getNotebookDataForCell(fileUri);

            // Map the vscode-notebook-cell: URI to its file-scheme equivalent so the workspace
            // factory can match it against workspace root URIs.
            fileUri = this._uriMapper!.getMappedCellUri(fileUri);
        }

        return this.workspaceFactory.getContainingWorkspacesForFile(fileUri);
    }

    override async getSettings(workspace: Workspace): Promise<ServerSettings> {
        const serverSettings: ServerSettings = {
            autoSearchPaths: true,
            disableLanguageServices: false,
            openFilesOnly: true,
            useLibraryCodeForTypes: true,
            watchForSourceChanges: true,
            watchForLibraryChanges: true,
            watchForConfigChanges: true,
            typeCheckingMode: 'off',
            diagnosticSeverityOverrides: {},
            diagnosticBooleanOverrides: {},
            logLevel: LogLevel.Info,
            autoImportCompletions: true,
            indexing: true,
            includeFileSpecs: [],
            excludeFileSpecs: [],
            ignoreFileSpecs: [],
            taskListTokens: [],
        };

        try {
            const workspaces = this.workspaceFactory.getNonDefaultWorkspaces(WellKnownWorkspaceKinds.Regular);

            const pythonSection = await this.getConfiguration(workspace.rootUri, 'python');
            if (pythonSection) {
                const pythonPath = pythonSection.pythonPath;
                if (pythonPath && isString(pythonPath) && !isPythonBinary(pythonPath)) {
                    serverSettings.pythonPath = resolvePathWithEnvVariables(workspace, pythonPath, workspaces);
                }

                const venvPath = pythonSection.venvPath;
                if (venvPath && isString(venvPath)) {
                    serverSettings.venvPath = resolvePathWithEnvVariables(workspace, venvPath, workspaces);
                }
            }

            const pythonAnalysisSection = await this.getConfiguration(workspace.rootUri, 'python.analysis');
            if (pythonAnalysisSection) {
                const typeshedPaths = pythonAnalysisSection.typeshedPaths;
                if (typeshedPaths && Array.isArray(typeshedPaths) && typeshedPaths.length > 0) {
                    const typeshedPath = typeshedPaths[0];
                    if (typeshedPath && isString(typeshedPath)) {
                        serverSettings.typeshedPath = resolvePathWithEnvVariables(workspace, typeshedPath, workspaces);
                    }
                }

                const stubPath = pythonAnalysisSection.stubPath;
                if (stubPath && isString(stubPath)) {
                    serverSettings.stubPath = resolvePathWithEnvVariables(workspace, stubPath, workspaces);
                }

                const diagnosticSeverityOverrides = pythonAnalysisSection.diagnosticSeverityOverrides;
                if (diagnosticSeverityOverrides) {
                    for (const [name, value] of Object.entries(diagnosticSeverityOverrides)) {
                        const ruleName = this.getDiagnosticRuleName(name);
                        const severity = this.getSeverityOverrides(value as string | boolean);
                        if (ruleName && severity) {
                            serverSettings.diagnosticSeverityOverrides![ruleName] = severity!;
                        }
                    }
                }

                if (pythonAnalysisSection.diagnosticMode !== undefined) {
                    serverSettings.openFilesOnly = this.isOpenFilesOnly(pythonAnalysisSection.diagnosticMode);
                } else if (pythonAnalysisSection.openFilesOnly !== undefined) {
                    serverSettings.openFilesOnly = !!pythonAnalysisSection.openFilesOnly;
                }

                if (pythonAnalysisSection.useLibraryCodeForTypes !== undefined) {
                    serverSettings.useLibraryCodeForTypes = !!pythonAnalysisSection.useLibraryCodeForTypes;
                }

                serverSettings.logLevel = convertLogLevel(pythonAnalysisSection.logLevel);
                serverSettings.autoSearchPaths = !!pythonAnalysisSection.autoSearchPaths;

                const extraPaths = pythonAnalysisSection.extraPaths;
                if (extraPaths && Array.isArray(extraPaths) && extraPaths.length > 0) {
                    serverSettings.extraPaths = extraPaths
                        .filter((p) => p && isString(p))
                        .map((p) => resolvePathWithEnvVariables(workspace, p, workspaces))
                        .filter(isDefined);
                }

                serverSettings.includeFileSpecs = this._getStringValues(pythonAnalysisSection.include);
                serverSettings.excludeFileSpecs = this._getStringValues(pythonAnalysisSection.exclude);
                serverSettings.ignoreFileSpecs = this._getStringValues(pythonAnalysisSection.ignore);

                if (pythonAnalysisSection.autoImportCompletions !== undefined) {
                    serverSettings.autoImportCompletions = pythonAnalysisSection.autoImportCompletions;
                }
            } else {
                serverSettings.autoSearchPaths = true;
            }

            const pyrightSection = await this.getConfiguration(workspace.rootUri, 'pyright');
            if (pyrightSection) {
                if (pyrightSection.openFilesOnly !== undefined) {
                    serverSettings.openFilesOnly = !!pyrightSection.openFilesOnly;
                }

                if (pyrightSection.useLibraryCodeForTypes !== undefined) {
                    serverSettings.useLibraryCodeForTypes = !!pyrightSection.useLibraryCodeForTypes;
                }

                serverSettings.disableLanguageServices = !!pyrightSection.disableLanguageServices;
                serverSettings.disableTaggedHints = !!pyrightSection.disableTaggedHints;
                serverSettings.disableOrganizeImports = !!pyrightSection.disableOrganizeImports;

                const typeCheckingMode = pyrightSection.typeCheckingMode;
                if (typeCheckingMode && isString(typeCheckingMode)) {
                    serverSettings.typeCheckingMode = typeCheckingMode;
                }
            }
        } catch (error) {
            this.console.error(`Error reading settings: ${error}`);
        }
        return serverSettings;
    }

    override createBackgroundAnalysis(serviceId: string, workspaceRoot: Uri): IBackgroundAnalysis | undefined {
        // Type server doesn't support background analysis. Just run everything in the main thread.
        return undefined;
    }

    protected override isLongRunningCommand(command: string): boolean {
        return false; // Type server doesn't support long-running commands.
    }

    protected override isRefactoringCommand(command: string): boolean {
        return false; // Type server doesn't support refactoring commands.
    }

    protected override executeCodeAction(
        params: CodeActionParams,
        token: CancellationToken
    ): Promise<(Command | CodeAction)[] | undefined | null> {
        return Promise.resolve([]); // Type server doesn't support code actions.
    }

    protected override createHost(): Host {
        return new FullAccessHost(this.serverOptions.serviceProvider);
    }

    protected override createImportResolver(
        serviceProvider: ServiceProvider,
        options: ConfigOptions,
        host: Host
    ): ImportResolver {
        const importResolver = new ImportResolver(serviceProvider, options, host);

        // In case there was cached information in the file system related to
        // import resolution, invalidate it now.
        importResolver.invalidateCache();

        return importResolver;
    }

    protected createProgressReporter(): ProgressReporter {
        // The old progress notifications are kept for backwards compatibility with
        // clients that do not support work done progress.
        let displayingProgress = false;
        let workDoneProgress: Promise<WorkDoneProgressServerReporter> | undefined;
        return {
            isDisplayingProgress: () => displayingProgress,
            isEnabled: (data: AnalysisResults) => true,
            begin: () => {
                displayingProgress = true;
                if (this.client.hasWindowProgressCapability) {
                    workDoneProgress = this.connection.window.createWorkDoneProgress();
                    workDoneProgress
                        .then((progress) => {
                            progress.begin('');
                        })
                        .catch(() => {});
                } else {
                    void this.connection.sendNotification('pyright/beginProgress');
                }
            },
            report: (message: string) => {
                if (workDoneProgress) {
                    workDoneProgress
                        .then((progress) => {
                            progress.report(message);
                        })
                        .catch(() => {});
                } else {
                    void this.connection.sendNotification('pyright/reportProgress', message);
                }
            },
            end: () => {
                displayingProgress = false;
                if (workDoneProgress) {
                    workDoneProgress
                        .then((progress) => {
                            progress.done();
                        })
                        .catch(() => {});
                    workDoneProgress = undefined;
                } else {
                    void this.connection.sendNotification('pyright/endProgress');
                }
            },
        };
    }

    protected override executeCommand(params: ExecuteCommandParams, token: CancellationToken): Promise<any> {
        // Don't execute any commands (for now) in the type server.
        return Promise.resolve();
    }

    protected override setupConnection(supportedCommands: string[], supportedCodeActions: string[]): void {
        super.setupConnection(supportedCommands, supportedCodeActions);

        // Register for all of the other requests that we support.
        this.connection.onRequest(
            TypeServerProtocol.GetComputedTypeRequest.type,
            this._onGetType.bind(this, (program, input, token) => program.getComputedType(input, token))
        );
        this.connection.onRequest(
            TypeServerProtocol.GetExpectedTypeRequest.type,
            this._onGetType.bind(this, (program, input, token) => {
                const result = program.getExpectedType(input, token);
                return result?.type;
            })
        );
        this.connection.onRequest(
            TypeServerProtocol.GetDeclaredTypeRequest.type,
            this._onGetType.bind(this, (program, input, token) => program.getDeclaredType(input, token))
        );
        this.connection.onRequest(TypeServerProtocol.GetSnapshotRequest.type, this._onGetSnapshot.bind(this));
        this.connection.onRequest(
            TypeServerProtocol.GetSupportedProtocolVersionRequest.type,
            this._onGetSupportedProtocolVersion.bind(this)
        );
        this.connection.onRequest(TypeServerProtocol.ResolveImportRequest.type, this._onResolveImport.bind(this));
        this.connection.onRequest(
            TypeServerProtocol.GetPythonSearchPathsRequest.type,
            this._onGetPythonSearchPaths.bind(this)
        );

        // Register virtual file redirect notifications (Pyright-specific TSP supplemental).
        // These are sent by a client (e.g. Pylance's Django stub generator) when it produces
        // merged virtual files on disk that the type server should analyze in place of the real
        // ones.
        this.connection.onNotification(TspSupplemental.SetVirtualFileRedirectNotification.type, (params) =>
            this._onSetVirtualFileRedirect(params)
        );
        this.connection.onNotification(TspSupplemental.RemoveVirtualFileRedirectNotification.type, (params) =>
            this._onRemoveVirtualFileRedirect(params)
        );

        // Register raw notification handlers for notebook documents. These are registered here
        // (before connection.listen()) so they're ready when the connection starts processing
        // messages. `_notebookManager` is created in `initialize()` (not here) because SWC's
        // TC39 class-field semantics would reinitialize it to undefined after the base class
        // constructor returns; `initialize()` runs before any notifications arrive.
        this.connection.onNotification('notebookDocument/didOpen', (params: DidOpenNotebookDocumentParams) => {
            this._notebookManager?.onDidOpenNotebookDocument(params);
        });
        this.connection.onNotification('notebookDocument/didChange', (params: DidChangeNotebookDocumentParams) => {
            this._notebookManager?.onDidChangeNotebookDocument(params);
        });
        this.connection.onNotification('notebookDocument/didClose', (params: DidCloseNotebookDocumentParams) => {
            this._notebookManager?.onDidCloseNotebookDocument(params);
        });
    }

    protected override async initialize(
        params: InitializeParams,
        supportedCommands: string[],
        supportedCodeActions: string[]
    ): Promise<InitializeResult> {
        // Create the notebook manager here (not in setupConnection) because SWC's TC39
        // class-field semantics reinitialize `_notebookManager` to undefined after the base
        // class constructor returns. This method runs when the Initialize request is processed,
        // which is before any notifications arrive. The manager is only created when a notebook
        // URI mapper is registered in the service provider (notebook support is otherwise off).
        if (this._uriMapper && this._uriMapper instanceof NotebookUriMapper) {
            const uriMapper = this._uriMapper;
            this._notebookManager = new NotebookDocumentHandler(
                uriMapper,
                this.caseSensitiveDetector,
                this.console,
                (fileUri) => this.workspaceFactory.getWorkspaceForFile(fileUri, undefined)
            );
        }

        const result = await super.initialize(params, supportedCommands, supportedCodeActions);

        // Advertise notebook support so the client sends notebookDocument/* notifications.
        if (this._notebookManager) {
            result.capabilities.notebookDocumentSync = AnyNotebookDocumentSelector;
        }

        return result;
    }

    protected override convertLspUriStringToUri(lspUri: string): Uri {
        // Do our own conversion of the LSP URI string to a Uri so notebook cells map to their
        // file-scheme equivalent.
        return convertLspUriStringToUri(lspUri, this.caseSensitiveDetector, this._uriMapper);
    }

    protected override onInitialized() {
        super.onInitialized();

        // The base Pyright server skips updateSettingsForAllWorkspaces() when the client
        // advertises workspace-folders support (it expects a didChangeWorkspaceFolders event
        // instead). A TSP client may advertise workspaceFolders: true but never send that
        // event, so trigger the settings update here when workspaces already exist. Without
        // this, setConfigOptions is never called, the ProgramWrapper hooks never fire, and the
        // snapshot stays at its initial invalid value forever.
        if (this.client.hasWorkspaceFoldersCapability && this.workspaceFactory.items().length > 0) {
            this.updateSettingsForAllWorkspaces();
        }

        this._initializedComplete = true;
    }

    protected override onWorkspaceCreated(workspace: Workspace): void {
        super.onWorkspaceCreated(workspace);

        // Make sure the program is wrapped so that we are tracking snapshots for it and it
        // shares the global type cache.
        const program = workspace.service.backgroundAnalysisProgram.program;
        makeProgram(program, this._globalTypeCache);
    }

    protected override async onDidOpenTextDocument(
        params: DidOpenTextDocumentParams,
        ipythonMode = IPythonMode.None
    ): Promise<void> {
        // Call the base implementation to open the file in all workspaces.
        await super.onDidOpenTextDocument(params, ipythonMode);

        // Warm up the evaluator cache by analyzing the file and initializing prefetched
        // types. This avoids slow first-query scenarios when the file imports large libraries.
        const uri = this.convertLspUriStringToUri(params.textDocument.uri);
        const program = await this._getProgram(uri);
        if (program) {
            program.ensureFileAnalyzed(uri, CancellationToken.None);
        }
    }

    protected override async onDiagnostics(params: DocumentDiagnosticParams, token: CancellationToken) {
        // Override the base class to use the type server's diagnostic converter which
        // properly handles TaskItem diagnostics (with tags and _vs_diagnosticRank). The base
        // LanguageServerBase._convertDiagnostics strips TaskItem entirely.
        const UncomputedDiagnosticsVersion = -1;
        const uri = this.convertLspUriStringToUri(params.textDocument.uri);
        const workspace = await this.getWorkspaceForFile(uri);
        let sourceFile = workspace.service.getSourceFile(uri);
        let diagnosticsVersion = sourceFile?.isCheckingRequired()
            ? UncomputedDiagnosticsVersion
            : sourceFile?.getDiagnosticVersion() ?? UncomputedDiagnosticsVersion;
        const result: DocumentDiagnosticReport = {
            kind: 'full',
            resultId: sourceFile?.getDiagnosticVersion()?.toString(),
            items: [],
        };
        if (
            workspace.disableLanguageServices ||
            !canNavigateToFile(workspace.service.fs, uri) ||
            token.isCancellationRequested
        ) {
            return result;
        }

        this.incrementAnalysisProgress();

        try {
            if (params.previousResultId !== diagnosticsVersion.toString() && sourceFile) {
                let diagnosticsVersionAfter = UncomputedDiagnosticsVersion - 1;
                let serverDiagnostics: AnalyzerDiagnostic[] = [];

                while (diagnosticsVersion !== diagnosticsVersionAfter && !token.isCancellationRequested && sourceFile) {
                    sourceFile = workspace.service.getSourceFile(uri);
                    diagnosticsVersion = sourceFile?.getDiagnosticVersion() ?? UncomputedDiagnosticsVersion;

                    if (sourceFile) {
                        serverDiagnostics = await workspace.service.analyzeFileAndGetDiagnostics(uri, token);
                    }

                    const sourceFileAfter = workspace.service.getSourceFile(uri);
                    diagnosticsVersionAfter = sourceFileAfter?.getDiagnosticVersion() ?? UncomputedDiagnosticsVersion;
                }

                // Use the type server's converter which handles TaskItem diagnostics. Pass
                // `true` for the tag-support flags unconditionally: a TSP child doesn't
                // receive the actual client capabilities, but a foreground server relays
                // these diagnostics directly and the original client does support them.
                const lspDiagnostics = serverDiagnostics
                    .map((d) =>
                        convertFromPyrightDiagnostic(
                            d,
                            workspace.service.fs,
                            /* supportsUnnecessaryDiagnosticTag */ true,
                            /* supportsTaskItemDiagnosticTag */ true
                        )
                    )
                    .filter((d): d is Diagnostic => d !== undefined);

                result.resultId =
                    diagnosticsVersionAfter === UncomputedDiagnosticsVersion
                        ? undefined
                        : diagnosticsVersionAfter.toString();
                result.items = lspDiagnostics;
            } else {
                (result as any).kind = 'unchanged';
                result.resultId =
                    diagnosticsVersion === UncomputedDiagnosticsVersion ? undefined : diagnosticsVersion.toString();
                delete (result as any).items;
            }
        } finally {
            this.decrementAnalysisProgress();
        }

        return result;
    }

    private _getStringValues(values: any) {
        if (!values || !Array.isArray(values) || values.length === 0) {
            return [];
        }

        return values.filter((p) => p && isString(p)) as string[];
    }

    private _getParserOutput(uri: Uri) {
        const workspace = this._getWorkspaceForUri(uri);
        if (workspace) {
            const program = workspace.service.backgroundAnalysisProgram.program;
            if (program) {
                return program.getParserOutput(uri);
            }
        }
        return undefined;
    }

    private _getWorkspaceForUri(uri: Uri): Workspace | undefined {
        // Best-effort synchronous workspace lookup used by the type cache. Prefer a
        // workspace that already tracks the file, otherwise fall back to the first
        // available workspace.
        const nonDefault = this.workspaceFactory.getNonDefaultWorkspaces();
        return nonDefault.find((w) => w.service.isTracked(uri)) ?? nonDefault[0] ?? this.workspaceFactory.items()[0];
    }

    // Preserve the file's existing IPython mode when re-pushing its contents. If we
    // unconditionally passed IPythonMode.None we would reset an open notebook cell's mode
    // and detach it from its cell chain (mirrors ProgramWrapper.updateFileContents).
    private _getExistingIPythonMode(workspace: Workspace, uri: Uri): IPythonMode {
        const fileInfo = workspace.service.backgroundAnalysisProgram.program?.getSourceFileInfo(uri);
        return fileInfo?.ipythonMode ?? IPythonMode.None;
    }

    private async _getProgram(uri: Uri): Promise<ProgramWrapper | undefined> {
        const workspace = await this.getWorkspaceForFile(uri);
        if (workspace) {
            // Pass the global type cache explicitly so the wrapper is guaranteed to share
            // the same `ITypeCache` (and therefore the same snapshot) that `_onGetSnapshot`
            // returns. The `makeProgram` WeakMap normally returns the wrapper created in
            // `onWorkspaceCreated`, but relying on that alone would livelock the client on
            // permanent `ServerCancelled` if a program were ever re-wrapped cache-less.
            return makeProgram(
                workspace.service.backgroundAnalysisProgram.program,
                this._globalTypeCache
            ) as ProgramWrapper;
        }
        return undefined;
    }

    private async _onGetSnapshot() {
        return this._globalTypeCache.snapshot;
    }

    private async _onGetSupportedProtocolVersion(): Promise<string> {
        return TypeServerProtocol.TypeServerVersion.current;
    }

    private async _onGetType(
        typeFetcher: (
            program: ProgramWrapper,
            input: ParseNode | Declaration,
            token: CancellationToken
        ) => Type | undefined,
        params: {
            arg: TypeServerProtocol.Declaration | TypeServerProtocol.Node;
            snapshot: number;
        },
        token: CancellationToken
    ): Promise<TypeServerProtocol.Type | undefined> {
        const arg = params.arg;
        const uri = isProtocolDeclaration(arg)
            ? arg.kind === TypeServerProtocol.DeclarationKind.Regular
                ? arg.node.uri
                : arg.uri
            : arg.uri;

        const fileUri = this.convertLspUriStringToUri(uri);
        const program = await this._getProgram(fileUri);
        if (!program) {
            return undefined;
        }

        // Make sure this is the current snapshot.
        if (program.getSnapshot(token) !== params.snapshot) {
            throw new ServerCanceledException();
        }

        const input = isProtocolDeclaration(arg)
            ? fromProtocolDecl(arg, program, program.symbolLookup)
            : fromProtocolNode<ParseNode>(arg, program);
        if (!input) {
            return undefined;
        }

        const type = typeFetcher(program, input, token);
        if (!type) {
            return undefined;
        }

        let pythonVersion = program.configOptions.getDefaultExecEnvironment().pythonVersion;
        if (!isDeclaration(input)) {
            const fileInfo = getFileInfo(input);
            pythonVersion = fileInfo.executionEnvironment.pythonVersion;
        }

        return program.run((p) => {
            const factory = new ProtocolTypeFactory(p, pythonVersion, input);
            return factory.getType(type);
        }, token);
    }

    private async _onResolveImport(params: TypeServerProtocol.ResolveImportParams, token: CancellationToken) {
        const sourceUri = this.convertLspUriStringToUri(params.sourceUri);
        const program = await this._getProgram(sourceUri);
        if (!program) {
            return undefined;
        }

        // Make sure this is the current snapshot.
        if (program.getSnapshot(token) !== params.snapshot) {
            throw new ServerCanceledException();
        }

        const result = program.resolveImport(sourceUri, params.moduleDescriptor, token);
        if (!result) {
            return undefined;
        }
        return result.toString();
    }

    private async _onGetPythonSearchPaths(
        params: { fromUri: string; snapshot: number },
        token: CancellationToken
    ): Promise<string[] | undefined> {
        const uri = this.convertLspUriStringToUri(params.fromUri);
        const program = uri ? await this._getProgram(uri) : undefined;
        if (!program) {
            return [];
        }

        // Make sure this is the current snapshot.
        if (program.getSnapshot(token) !== params.snapshot) {
            throw new ServerCanceledException();
        }

        const uris = program.getPythonSearchPaths(token);
        return uris ? uris.map((u) => u.toString()) : [];
    }

    private _onSetVirtualFileRedirect(params: TspSupplemental.SetVirtualFileRedirectParams): void {
        const fs = this.fs;
        if (!TypeServerFileSystem.is(fs)) {
            return;
        }

        const realUri = this.convertLspUriStringToUri(params.realUri);
        const virtualUri = this.convertLspUriStringToUri(params.virtualUri);
        fs.virtualOverlay.addFileRedirect(realUri, virtualUri);

        // If the file is currently open, read the virtual content and update Pyright's in-memory
        // buffer. For closed files, the FS overlay redirect is sufficient — Pyright reads from
        // the FS.
        let virtualContent: string | undefined;
        if (this.openFileMap.has(realUri.key)) {
            try {
                virtualContent = fs.readFileSync(realUri, 'utf8');
            } catch (e) {
                this.console.warn(`Failed to read virtual content for ${realUri}: ${e}`);
            }
        }

        // Trigger re-analysis on the workspace that contains this file.
        const workspace = this._getWorkspaceForUri(realUri);
        if (workspace) {
            if (virtualContent !== undefined) {
                const doc = this.openFileMap.get(realUri.key);
                workspace.service.updateOpenFileContents(
                    realUri,
                    doc?.version ?? null,
                    virtualContent,
                    this._getExistingIPythonMode(workspace, realUri)
                );
            }
            workspace.service.invalidateAndScheduleReanalysis(InvalidatedReason.Reanalyzed);
        }
    }

    private _onRemoveVirtualFileRedirect(params: TspSupplemental.RemoveVirtualFileRedirectParams): void {
        const fs = this.fs;
        if (!TypeServerFileSystem.is(fs)) {
            return;
        }

        const realUri = this.convertLspUriStringToUri(params.realUri);
        fs.virtualOverlay.removeFileRedirect(realUri);

        // If the file is currently open, restore from the open document's original text
        // (authoritative), not from disk which may differ. For closed files, just removing the
        // redirect is enough.
        let realContent: string | undefined;
        if (this.openFileMap.has(realUri.key)) {
            const doc = this.openFileMap.get(realUri.key);
            if (doc) {
                // The open document text is the authoritative "real" content.
                realContent = doc.getText();
            } else {
                // Fallback: read from FS (redirect already removed above).
                try {
                    realContent = fs.readFileSync(realUri, 'utf8');
                } catch (e) {
                    this.console.warn(`Failed to read real content for ${realUri}: ${e}`);
                }
            }
        }

        // Trigger re-analysis on the workspace that contains this file.
        const workspace = this._getWorkspaceForUri(realUri);
        if (workspace) {
            if (realContent !== undefined) {
                const doc = this.openFileMap.get(realUri.key);
                workspace.service.updateOpenFileContents(
                    realUri,
                    doc?.version ?? null,
                    realContent,
                    this._getExistingIPythonMode(workspace, realUri)
                );
            }
            workspace.service.invalidateAndScheduleReanalysis(InvalidatedReason.Reanalyzed);
        }
    }

    private _onSnapshotChanged(newSnapshot: number): void {
        // Don't send notifications if the server is disposed.
        if (this.isDisposed) {
            return;
        }

        // Snapshot changed, all uri handles are invalid.
        this._handleToUriMap.clear();

        // Send a notification to all clients that the snapshot has changed.
        void this.connection.sendNotification(TypeServerProtocol.SnapshotChangedNotification.type, {
            old: newSnapshot - 1,
            new: newSnapshot,
        });
    }
}

function isProtocolDeclaration(
    arg: TypeServerProtocol.Declaration | TypeServerProtocol.Node
): arg is TypeServerProtocol.Declaration {
    return (arg as TypeServerProtocol.Declaration).kind !== undefined;
}
