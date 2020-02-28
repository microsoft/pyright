/*
 * languageServerBase.ts
 *
 * Implements common language server functionality.
 */

import './common/extensions';

import {
    CodeAction,
    CodeActionKind,
    CodeActionParams,
    Command,
    ConfigurationItem,
    createConnection,
    Diagnostic,
    DiagnosticRelatedInformation,
    DiagnosticSeverity,
    DiagnosticTag,
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
    TextDocuments,
    TextEdit,
    WorkspaceEdit
} from 'vscode-languageserver';

import { ImportResolver } from './analyzer/importResolver';
import { AnalyzerService } from './analyzer/service';
import { ConfigOptions } from './common/configOptions';
import { ConsoleInterface } from './common/console';
import { Diagnostic as AnalyzerDiagnostic, DiagnosticCategory } from './common/diagnostic';
import { convertPathToUri, convertUriToPath } from './common/pathUtils';
import { Position } from './common/textRange';
import { createFromRealFileSystem, VirtualFileSystem } from './common/vfs';
import { AnalyzerServiceExecutor } from './languageService/analyzerServiceExecutor';
import { CompletionItemData } from './languageService/completionProvider';
import { convertHoverResults } from './languageService/hoverProvider';
import { WorkspaceMap } from './workspaceMap';

export interface ServerSettings {
    venvPath?: string;
    pythonPath?: string;
    typeshedPath?: string;
    openFilesOnly?: boolean;
    useLibraryCodeForTypes?: boolean;
    disableLanguageServices?: boolean;
}

export interface WorkspaceServiceInstance {
    workspaceName: string;
    rootPath: string;
    rootUri: string;
    serviceInstance: AnalyzerService;
    disableLanguageServices: boolean;
}

export interface WindowInterface {
    showErrorMessage(message: string): void;
    showWarningMessage(message: string): void;
    showInformationMessage(message: string): void;
}

export interface LanguageServerInterface {
    getWorkspaceForFile(filePath: string): WorkspaceServiceInstance;
    getSettings(workspace: WorkspaceServiceInstance): Promise<ServerSettings>;
    reanalyze(): void;

    readonly rootPath: string;
    readonly console: ConsoleInterface;
    readonly window: WindowInterface;
    readonly fs: VirtualFileSystem;
}

export abstract class LanguageServerBase implements LanguageServerInterface {
    // Create a connection for the server. The connection type can be changed by the process's arguments
    private _connection: IConnection = createConnection();
    private _workspaceMap: WorkspaceMap;

    // Create a simple text document manager. The text document manager
    // supports full document sync only.
    private _documents: TextDocuments = new TextDocuments();

    // Tracks whether we're currently displaying progress.
    private _isDisplayingProgress = false;

    // Global root path - the basis for all global settings.
    rootPath = '';

    // File system abstraction.
    fs: VirtualFileSystem;

    constructor(private _productName: string, rootDirectory: string) {
        this._connection.console.log(`${_productName} language server starting`);
        // virtual file system to be used. initialized to real file system by default. but can't be overritten
        this.fs = createFromRealFileSystem(this._connection.console);
        // Stash the base directory into a global variable.
        (global as any).__rootDirectory = rootDirectory;
        this._connection.console.log(`Server root directory: ${rootDirectory}`);

        // Create workspace map.
        this._workspaceMap = new WorkspaceMap(this);
        // Make the text document manager listen on the connection
        // for open, change and close text document events.
        this._documents.listen(this._connection);
        // Setup callbacks
        this._setupConnection();
        // Listen on the connection
        this._connection.listen();
    }

    protected abstract async executeCommand(cmdParams: ExecuteCommandParams): Promise<any>;
    protected abstract async executeCodeAction(
        cmdParams: CodeActionParams
    ): Promise<(Command | CodeAction)[] | undefined | null>;
    abstract async getSettings(workspace: WorkspaceServiceInstance): Promise<ServerSettings>;

    protected getConfiguration(workspace: WorkspaceServiceInstance, section: string) {
        const scopeUri = workspace.rootUri ? workspace.rootUri : undefined;
        const item: ConfigurationItem = {
            scopeUri,
            section
        };
        return this._connection.workspace.getConfiguration(item);
    }

    protected createImportResolver(fs: VirtualFileSystem, options: ConfigOptions): ImportResolver {
        return new ImportResolver(fs, options);
    }

    // Provides access to logging to the client output window.
    get console(): RemoteConsole {
        return this._connection.console;
    }

    // provides access to the client windows
    get window(): RemoteWindow {
        return this._connection.window;
    }

    // Creates a service instance that's used for analyzing a
    // program within a workspace.
    createAnalyzerService(name: string): AnalyzerService {
        this._connection.console.log(`Starting service instance "${name}"`);
        const service = new AnalyzerService(name, this.fs, this._connection.console, this.createImportResolver);

        // Don't allow the analysis engine to go too long without
        // reporting results. This will keep it responsive.
        service.setMaxAnalysisDuration({
            openFilesTimeInMs: 50,
            noOpenFilesTimeInMs: 200
        });

        service.setCompletionCallback(results => {
            results.diagnostics.forEach(fileDiag => {
                const diagnostics = this._convertDiagnostics(fileDiag.diagnostics);

                // Send the computed diagnostics to the client.
                this._connection.sendDiagnostics({
                    uri: convertPathToUri(fileDiag.filePath),
                    diagnostics
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
        });

        return service;
    }

    getWorkspaceForFile(filePath: string): WorkspaceServiceInstance {
        return this._workspaceMap.getWorkspaceForFile(filePath);
    }

    reanalyze() {
        this._workspaceMap.forEach(workspace => {
            workspace.serviceInstance.invalidateAndForceReanalysis();
        });
    }

    private _setupConnection(): void {
        // After the server has started the client sends an initialize request. The server receives
        // in the passed params the rootPath of the workspace plus the client capabilities.
        this._connection.onInitialize(
            (params): InitializeResult => {
                this.rootPath = params.rootPath || '';

                // Create a service instance for each of the workspace folders.
                if (params.workspaceFolders) {
                    params.workspaceFolders.forEach(folder => {
                        const path = convertUriToPath(folder.uri);
                        this._workspaceMap.set(path, {
                            workspaceName: folder.name,
                            rootPath: path,
                            rootUri: folder.uri,
                            serviceInstance: this.createAnalyzerService(folder.name),
                            disableLanguageServices: false
                        });
                    });
                } else if (params.rootPath) {
                    this._workspaceMap.set(params.rootPath, {
                        workspaceName: '',
                        rootPath: params.rootPath,
                        rootUri: '',
                        serviceInstance: this.createAnalyzerService(params.rootPath),
                        disableLanguageServices: false
                    });
                }

                return {
                    capabilities: {
                        // Tell the client that the server works in FULL text document
                        // sync mode (as opposed to incremental).
                        textDocumentSync: this._documents.syncKind,
                        definitionProvider: true,
                        referencesProvider: true,
                        documentSymbolProvider: true,
                        workspaceSymbolProvider: true,
                        hoverProvider: true,
                        renameProvider: true,
                        completionProvider: {
                            triggerCharacters: ['.', '['],
                            resolveProvider: true
                        },
                        signatureHelpProvider: {
                            triggerCharacters: ['(', ',', ')']
                        },
                        codeActionProvider: {
                            codeActionKinds: [CodeActionKind.QuickFix, CodeActionKind.SourceOrganizeImports]
                        }
                    }
                };
            }
        );

        this._connection.onDidChangeConfiguration(_ => {
            this._connection.console.log(`Received updated settings`);
            this.updateSettingsForAllWorkspaces();
        });

        this._connection.onCodeAction((params: CodeActionParams) => this.executeCodeAction(params));

        this._connection.onDefinition(params => {
            this.recordUserInteractionTime();

            const filePath = convertUriToPath(params.textDocument.uri);

            const position: Position = {
                line: params.position.line,
                character: params.position.character
            };

            const workspace = this._workspaceMap.getWorkspaceForFile(filePath);
            if (workspace.disableLanguageServices) {
                return;
            }
            const locations = workspace.serviceInstance.getDefinitionForPosition(filePath, position);
            if (!locations) {
                return undefined;
            }
            return locations.map(loc => Location.create(convertPathToUri(loc.path), loc.range));
        });

        this._connection.onReferences(params => {
            const filePath = convertUriToPath(params.textDocument.uri);

            const position: Position = {
                line: params.position.line,
                character: params.position.character
            };

            const workspace = this._workspaceMap.getWorkspaceForFile(filePath);
            if (workspace.disableLanguageServices) {
                return;
            }
            const locations = workspace.serviceInstance.getReferencesForPosition(
                filePath,
                position,
                params.context.includeDeclaration
            );
            if (!locations) {
                return undefined;
            }
            return locations.map(loc => Location.create(convertPathToUri(loc.path), loc.range));
        });

        this._connection.onDocumentSymbol(params => {
            this.recordUserInteractionTime();

            const filePath = convertUriToPath(params.textDocument.uri);

            const workspace = this._workspaceMap.getWorkspaceForFile(filePath);
            if (workspace.disableLanguageServices) {
                return undefined;
            }

            const symbolList: DocumentSymbol[] = [];
            workspace.serviceInstance.addSymbolsForDocument(filePath, symbolList);
            return symbolList;
        });

        this._connection.onWorkspaceSymbol(params => {
            const symbolList: SymbolInformation[] = [];

            this._workspaceMap.forEach(workspace => {
                if (!workspace.disableLanguageServices) {
                    workspace.serviceInstance.addSymbolsForWorkspace(symbolList, params.query);
                }
            });

            return symbolList;
        });

        this._connection.onHover(params => {
            const filePath = convertUriToPath(params.textDocument.uri);

            const position: Position = {
                line: params.position.line,
                character: params.position.character
            };

            const workspace = this._workspaceMap.getWorkspaceForFile(filePath);
            const hoverResults = workspace.serviceInstance.getHoverForPosition(filePath, position);
            return convertHoverResults(hoverResults);
        });

        this._connection.onSignatureHelp(params => {
            const filePath = convertUriToPath(params.textDocument.uri);

            const position: Position = {
                line: params.position.line,
                character: params.position.character
            };

            const workspace = this._workspaceMap.getWorkspaceForFile(filePath);
            if (workspace.disableLanguageServices) {
                return;
            }
            const signatureHelpResults = workspace.serviceInstance.getSignatureHelpForPosition(filePath, position);
            if (!signatureHelpResults) {
                return undefined;
            }

            return {
                signatures: signatureHelpResults.signatures.map(sig => {
                    let paramInfo: ParameterInformation[] = [];
                    if (sig.parameters) {
                        paramInfo = sig.parameters.map(param => {
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
                activeParameter:
                    signatureHelpResults.activeParameter !== undefined ? signatureHelpResults.activeParameter : null
            };
        });

        this._connection.onCompletion(params => {
            const filePath = convertUriToPath(params.textDocument.uri);

            const position: Position = {
                line: params.position.line,
                character: params.position.character
            };

            const workspace = this._workspaceMap.getWorkspaceForFile(filePath);
            if (workspace.disableLanguageServices) {
                return;
            }

            const completions = workspace.serviceInstance.getCompletionsForPosition(
                filePath,
                position,
                workspace.rootPath
            );

            // Always mark as incomplete so we get called back when the
            // user continues typing. Without this, the editor will assume
            // that it has received a complete list and will filter that list
            // on its own.
            if (completions) {
                completions.isIncomplete = true;
            }

            return completions;
        });

        this._connection.onCompletionResolve(params => {
            const completionItemData = params.data as CompletionItemData;
            if (completionItemData) {
                const workspace = this._workspaceMap.get(completionItemData.workspacePath);
                if (workspace && completionItemData.filePath) {
                    workspace.serviceInstance.resolveCompletionItem(completionItemData.filePath, params);
                }
            }
            return params;
        });

        this._connection.onRenameRequest(params => {
            const filePath = convertUriToPath(params.textDocument.uri);

            const position: Position = {
                line: params.position.line,
                character: params.position.character
            };

            const workspace = this._workspaceMap.getWorkspaceForFile(filePath);
            if (workspace.disableLanguageServices) {
                return;
            }
            const editActions = workspace.serviceInstance.renameSymbolAtPosition(filePath, position, params.newName);

            if (!editActions) {
                return undefined;
            }

            const edits: WorkspaceEdit = {
                changes: {}
            };
            editActions.forEach(editAction => {
                const uri = convertPathToUri(editAction.filePath);
                if (edits.changes![uri] === undefined) {
                    edits.changes![uri] = [];
                }

                const textEdit: TextEdit = {
                    range: editAction.range,
                    newText: editAction.replacementText
                };
                edits.changes![uri].push(textEdit);
            });

            return edits;
        });

        this._connection.onDidOpenTextDocument(params => {
            const filePath = convertUriToPath(params.textDocument.uri);
            const service = this._workspaceMap.getWorkspaceForFile(filePath).serviceInstance;
            service.setFileOpened(filePath, params.textDocument.version, params.textDocument.text);
        });

        this._connection.onDidChangeTextDocument(params => {
            this.recordUserInteractionTime();

            const filePath = convertUriToPath(params.textDocument.uri);
            const service = this._workspaceMap.getWorkspaceForFile(filePath).serviceInstance;
            service.updateOpenFileContents(filePath, params.textDocument.version, params.contentChanges[0].text);
        });

        this._connection.onDidCloseTextDocument(params => {
            const filePath = convertUriToPath(params.textDocument.uri);
            const service = this._workspaceMap.getWorkspaceForFile(filePath).serviceInstance;
            service.setFileClosed(filePath);
        });

        this._connection.onInitialized(() => {
            this._connection.workspace.onDidChangeWorkspaceFolders(event => {
                event.removed.forEach(workspace => {
                    const rootPath = convertUriToPath(workspace.uri);
                    this._workspaceMap.delete(rootPath);
                });

                event.added.forEach(async workspace => {
                    const rootPath = convertUriToPath(workspace.uri);
                    const newWorkspace: WorkspaceServiceInstance = {
                        workspaceName: workspace.name,
                        rootPath,
                        rootUri: workspace.uri,
                        serviceInstance: this.createAnalyzerService(workspace.name),
                        disableLanguageServices: false
                    };
                    this._workspaceMap.set(rootPath, newWorkspace);
                    await this.updateSettingsForWorkspace(newWorkspace);
                });
            });
        });

        this._connection.onExecuteCommand((cmdParams: ExecuteCommandParams) => this.executeCommand(cmdParams));
    }

    updateSettingsForAllWorkspaces(): void {
        this._workspaceMap.forEach(workspace => {
            this.updateSettingsForWorkspace(workspace).ignoreErrors();
        });
    }

    async updateSettingsForWorkspace(workspace: WorkspaceServiceInstance): Promise<void> {
        const serverSettings = await this.getSettings(workspace);
        this.updateOptionsAndRestartService(workspace, serverSettings);
        workspace.disableLanguageServices = !!serverSettings.disableLanguageServices;
    }

    updateOptionsAndRestartService(
        workspace: WorkspaceServiceInstance,
        serverSettings: ServerSettings,
        typeStubTargetImportName?: string
    ) {
        AnalyzerServiceExecutor.runWithOptions(this.rootPath, workspace, serverSettings, typeStubTargetImportName);
    }

    private _convertDiagnostics(diags: AnalyzerDiagnostic[]): Diagnostic[] {
        return diags.map(diag => {
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
                vsDiag.relatedInformation = relatedInfo.map(info => {
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
        this._workspaceMap.forEach(workspace => {
            workspace.serviceInstance.recordUserInteractionTime();
        });
    }
}
