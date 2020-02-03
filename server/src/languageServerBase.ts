/*
* languageServerBase.ts
*
* Implements common language server functionality.
*/

import {
    CodeAction, CodeActionKind, Command, ConfigurationItem,
    createConnection, Diagnostic, DiagnosticRelatedInformation, DiagnosticSeverity,
    DiagnosticTag, DocumentSymbol, ExecuteCommandParams, IConnection, InitializeResult,
    IPCMessageReader, IPCMessageWriter, Location, MarkupKind, ParameterInformation,
    RemoteConsole, ResponseError, SignatureInformation, SymbolInformation, TextDocuments, TextEdit, WorkspaceEdit
} from 'vscode-languageserver';

import { AnalyzerService } from './analyzer/service';
import { CommandLineOptions } from './common/commandLineOptions';
import {
    AddMissingOptionalToParamAction, CreateTypeStubFileAction,
    Diagnostic as AnalyzerDiagnostic, DiagnosticCategory,
} from './common/diagnostic';
import './common/extensions';
import { combinePaths, convertPathToUri, convertUriToPath, getDirectoryPath, normalizePath } from './common/pathUtils';
import { commandAddMissingOptionalToParam, commandCreateTypeStub, commandOrderImports } from './languageService/commands';
import { CompletionItemData } from './languageService/completionProvider';
import { Range, Position } from './common/textRange';
import { createFromRealFileSystem, VirtualFileSystem } from './common/vfs';
import { convertRange } from './languageService/vscodelspUtils';

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

export abstract class LanguageServerBase {
    // Create a connection for the server. The connection uses Node's IPC as a transport
    private _connection: IConnection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));
    private _fs: VirtualFileSystem;
    // Create a simple text document manager. The text document manager
    // supports full document sync only.
    private _documents: TextDocuments = new TextDocuments();
    private _workspaceMap = new Map<string, WorkspaceServiceInstance>();

    // Global root path - the basis for all global settings.
    private _rootPath = '';
    // Tracks whether we're currently displaying progress.
    private _isDisplayingProgress = false;
    private _defaultWorkspacePath = '<default>';

    constructor(private _productName: string, rootDirectory?: string) {
        this._connection.console.log(`${ _productName } language server starting`);
        // virtual file system to be used. initialized to real file system by default. but can't be overritten
        this._fs = createFromRealFileSystem(this._connection.console);
        // Stash the base directory into a global variable.
        (global as any).__rootDirectory = rootDirectory ? rootDirectory : getDirectoryPath(__dirname);
        // Make the text document manager listen on the connection
        // for open, change and close text document events.
        this._documents.listen(this._connection);
        // Setup callbacks
        this._setupConnection();
        // Listen on the connection
        this._connection.listen();
    }

    abstract async getSettings(workspace: WorkspaceServiceInstance): Promise<ServerSettings>;

    // Provides access to logging to the client output window.
    protected get console(): RemoteConsole {
        return this._connection.console;
    }

    protected getConfiguration(workspace: WorkspaceServiceInstance, section: string) {
        const scopeUri = workspace.rootUri ? workspace.rootUri : undefined;
        const item: ConfigurationItem = {
            scopeUri,
            section
        };
        return this._connection.workspace.getConfiguration(item);
    }

    // Creates a service instance that's used for analyzing a
    // program within a workspace.
    private _createAnalyzerService(name: string): AnalyzerService {
        this._connection.console.log(`Starting service instance "${ name }"`);
        const service = new AnalyzerService(name, this._fs, this._connection.console);

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
                        this._connection.sendNotification('pyright/reportProgress',
                            `${ results.filesRequiringAnalysis } ${ fileOrFiles } to analyze`);
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

    // Creates a service instance that's used for creating type
    // stubs for a specified target library.
    private _createTypeStubService(importName: string): AnalyzerService {

        this._connection.console.log('Starting type stub service instance');
        const service = new AnalyzerService('Type stub', this._fs, this._connection.console);

        service.setMaxAnalysisDuration({
            openFilesTimeInMs: 500,
            noOpenFilesTimeInMs: 500
        });

        return service;
    }

    private _handlePostCreateTypeStub() {
        this._workspaceMap.forEach(workspace => {
            workspace.serviceInstance.handlePostCreateTypeStub();
        });
    }

    private _getWorkspaceForFile(filePath: string): WorkspaceServiceInstance {
        let bestRootPath: string | undefined;
        let bestInstance: WorkspaceServiceInstance | undefined;

        this._workspaceMap.forEach(workspace => {
            if (workspace.rootPath) {
                // Is the file is under this workspace folder?
                if (filePath.startsWith(workspace.rootPath)) {
                    // Is this the fist candidate? If not, is this workspace folder
                    // contained within the previous candidate folder? We always want
                    // to select the innermost folder, since that overrides the
                    // outer folders.
                    if (bestRootPath === undefined || workspace.rootPath.startsWith(bestRootPath)) {
                        bestRootPath = workspace.rootPath;
                        bestInstance = workspace;
                    }
                }
            }
        });

        // If there were multiple workspaces or we couldn't find any,
        // create a default one to use for this file.
        if (bestInstance === undefined) {
            let defaultWorkspace = this._workspaceMap.get(this._defaultWorkspacePath);
            if (!defaultWorkspace) {
                // If there is only one workspace, use that one.
                const workspaceNames = [...this._workspaceMap.keys()];
                if (workspaceNames.length === 1) {
                    return this._workspaceMap.get(workspaceNames[0])!;
                }

                // Create a default workspace for files that are outside
                // of all workspaces.
                defaultWorkspace = {
                    workspaceName: '',
                    rootPath: '',
                    rootUri: '',
                    serviceInstance: this._createAnalyzerService(this._defaultWorkspacePath),
                    disableLanguageServices: false
                };
                this._workspaceMap.set(this._defaultWorkspacePath, defaultWorkspace);
                this._updateSettingsForWorkspace(defaultWorkspace).ignoreErrors();
            }

            return defaultWorkspace;
        }

        return bestInstance;
    }

    private _setupConnection(): void {
        // After the server has started the client sends an initialize request. The server receives
        // in the passed params the rootPath of the workspace plus the client capabilities.
        this._connection.onInitialize((params): InitializeResult => {
            this._rootPath = params.rootPath || '';

            // Create a service instance for each of the workspace folders.
            if (params.workspaceFolders) {
                params.workspaceFolders.forEach(folder => {
                    const path = convertUriToPath(folder.uri);
                    this._workspaceMap.set(path, {
                        workspaceName: folder.name,
                        rootPath: path,
                        rootUri: folder.uri,
                        serviceInstance: this._createAnalyzerService(folder.name),
                        disableLanguageServices: false
                    });
                });
            } else if (params.rootPath) {
                this._workspaceMap.set(params.rootPath, {
                    workspaceName: '',
                    rootPath: params.rootPath,
                    rootUri: '',
                    serviceInstance: this._createAnalyzerService(params.rootPath),
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
                        codeActionKinds: [
                            CodeActionKind.QuickFix,
                            CodeActionKind.SourceOrganizeImports
                        ]
                    }
                }
            };
        });

        this._connection.onDidChangeConfiguration(_ => {
            this._connection.console.log(`Received updated settings`);
            this._updateSettingsForAllWorkspaces();
        });

        this._connection.onCodeAction(params => {
            this._recordUserInteractionTime();

            const sortImportsCodeAction = CodeAction.create(
                'Organize Imports', Command.create('Organize Imports', commandOrderImports),
                CodeActionKind.SourceOrganizeImports);
            const codeActions: CodeAction[] = [sortImportsCodeAction];

            const filePath = convertUriToPath(params.textDocument.uri);
            const workspace = this._getWorkspaceForFile(filePath);
            if (!workspace.disableLanguageServices) {
                const range: Range = {
                    start: {
                        line: params.range.start.line,
                        character: params.range.start.character
                    },
                    end: {
                        line: params.range.end.line,
                        character: params.range.end.character
                    }
                };

                const diags = workspace.serviceInstance.getDiagnosticsForRange(filePath, range);
                const typeStubDiag = diags.find(d => {
                    const actions = d.getActions();
                    return actions && actions.find(a => a.action === commandCreateTypeStub);
                });

                if (typeStubDiag) {
                    const action = typeStubDiag.getActions()!.find(
                        a => a.action === commandCreateTypeStub) as CreateTypeStubFileAction;
                    if (action) {
                        const createTypeStubAction = CodeAction.create(
                            `Create Type Stub For ‘${ action.moduleName }’`,
                            Command.create('Create Type Stub', commandCreateTypeStub,
                                workspace.rootPath, action.moduleName),
                            CodeActionKind.QuickFix);
                        codeActions.push(createTypeStubAction);
                    }
                }

                const addOptionalDiag = diags.find(d => {
                    const actions = d.getActions();
                    return actions && actions.find(a => a.action === commandAddMissingOptionalToParam);
                });

                if (addOptionalDiag) {
                    const action = addOptionalDiag.getActions()!.find(
                        a => a.action === commandAddMissingOptionalToParam) as AddMissingOptionalToParamAction;
                    if (action) {
                        const addMissingOptionalAction = CodeAction.create(
                            `Add 'Optional' to type annotation`,
                            Command.create(`Add 'Optional' to type annotation`, commandAddMissingOptionalToParam,
                                action.offsetOfTypeNode),
                            CodeActionKind.QuickFix);
                        codeActions.push(addMissingOptionalAction);
                    }
                }
            }

            return codeActions;
        });

        this._connection.onDefinition(params => {
            this._recordUserInteractionTime();

            const filePath = convertUriToPath(params.textDocument.uri);

            const position: Position = {
                line: params.position.line,
                character: params.position.character
            };

            const workspace = this._getWorkspaceForFile(filePath);
            if (workspace.disableLanguageServices) {
                return;
            }
            const locations = workspace.serviceInstance.getDefinitionForPosition(filePath, position);
            if (!locations) {
                return undefined;
            }
            return locations.map(loc =>
                Location.create(convertPathToUri(loc.path), convertRange(loc.range)));
        });

        this._connection.onReferences(params => {
            const filePath = convertUriToPath(params.textDocument.uri);

            const position: Position = {
                line: params.position.line,
                character: params.position.character
            };

            const workspace = this._getWorkspaceForFile(filePath);
            if (workspace.disableLanguageServices) {
                return;
            }
            const locations = workspace.serviceInstance.getReferencesForPosition(filePath, position,
                params.context.includeDeclaration);
            if (!locations) {
                return undefined;
            }
            return locations.map(loc =>
                Location.create(convertPathToUri(loc.path), convertRange(loc.range)));
        });

        this._connection.onDocumentSymbol(params => {
            this._recordUserInteractionTime();

            const filePath = convertUriToPath(params.textDocument.uri);

            const workspace = this._getWorkspaceForFile(filePath);
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
                    workspace.serviceInstance.addSymbolsForWorkspace(
                        symbolList, params.query);
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

            const workspace = this._getWorkspaceForFile(filePath);
            const hoverResults = workspace.serviceInstance.getHoverForPosition(filePath, position);
            if (!hoverResults) {
                return undefined;
            }

            const markupString = hoverResults.parts.map(part => {
                if (part.python) {
                    return '```python\n' + part.text + '\n```\n';
                }
                return part.text;
            }).join('');

            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: markupString
                },
                range: convertRange(hoverResults.range)
            };
        });

        this._connection.onSignatureHelp(params => {
            const filePath = convertUriToPath(params.textDocument.uri);

            const position: Position = {
                line: params.position.line,
                character: params.position.character
            };

            const workspace = this._getWorkspaceForFile(filePath);
            if (workspace.disableLanguageServices) {
                return;
            }
            const signatureHelpResults = workspace.serviceInstance.getSignatureHelpForPosition(
                filePath, position);
            if (!signatureHelpResults) {
                return undefined;
            }

            return {
                signatures: signatureHelpResults.signatures.map(sig => {
                    let paramInfo: ParameterInformation[] = [];
                    if (sig.parameters) {
                        paramInfo = sig.parameters.map(param => {
                            return ParameterInformation.create(
                                [param.startOffset, param.endOffset], param.documentation);
                        });
                    }
                    return SignatureInformation.create(sig.label, sig.documentation,
                        ...paramInfo);
                }),
                activeSignature: signatureHelpResults.activeSignature !== undefined ?
                    signatureHelpResults.activeSignature : null,
                activeParameter: signatureHelpResults.activeParameter !== undefined ?
                    signatureHelpResults.activeParameter : null
            };
        });

        this._connection.onCompletion(params => {
            const filePath = convertUriToPath(params.textDocument.uri);

            const position: Position = {
                line: params.position.line,
                character: params.position.character
            };

            const workspace = this._getWorkspaceForFile(filePath);
            if (workspace.disableLanguageServices) {
                return;
            }

            const completions = workspace.serviceInstance.getCompletionsForPosition(
                filePath, position, workspace.rootPath);

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
                    workspace.serviceInstance.resolveCompletionItem(
                        completionItemData.filePath, params);
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

            const workspace = this._getWorkspaceForFile(filePath);
            if (workspace.disableLanguageServices) {
                return;
            }
            const editActions = workspace.serviceInstance.renameSymbolAtPosition(
                filePath, position, params.newName);

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
                    range: convertRange(editAction.range),
                    newText: editAction.replacementText
                };
                edits.changes![uri].push(textEdit);
            });

            return edits;
        });

        this._connection.onDidOpenTextDocument(params => {
            const filePath = convertUriToPath(params.textDocument.uri);
            const service = this._getWorkspaceForFile(filePath).serviceInstance;
            service.setFileOpened(
                filePath,
                params.textDocument.version,
                params.textDocument.text);
        });

        this._connection.onDidChangeTextDocument(params => {
            this._recordUserInteractionTime();

            const filePath = convertUriToPath(params.textDocument.uri);
            const service = this._getWorkspaceForFile(filePath).serviceInstance;
            service.updateOpenFileContents(
                filePath,
                params.textDocument.version,
                params.contentChanges[0].text);
        });

        this._connection.onDidCloseTextDocument(params => {
            const filePath = convertUriToPath(params.textDocument.uri);
            const service = this._getWorkspaceForFile(filePath).serviceInstance;
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
                        serviceInstance: this._createAnalyzerService(workspace.name),
                        disableLanguageServices: false
                    };
                    this._workspaceMap.set(rootPath, newWorkspace);
                    await this._updateSettingsForWorkspace(newWorkspace);
                });
            });
        });

        this._connection.onExecuteCommand((cmdParams: ExecuteCommandParams) => this._executeCommand(cmdParams));
    }

    private async _executeCommand(cmdParams: ExecuteCommandParams): Promise<any> {
        if (cmdParams.command === commandOrderImports ||
            cmdParams.command === commandAddMissingOptionalToParam) {

            if (cmdParams.arguments && cmdParams.arguments.length >= 1) {
                const docUri = cmdParams.arguments[0];
                const otherArgs = cmdParams.arguments.slice(1);
                const filePath = convertUriToPath(docUri);
                const workspace = this._getWorkspaceForFile(filePath);
                const editActions = workspace.serviceInstance.performQuickAction(
                    filePath, cmdParams.command, otherArgs);
                if (!editActions) {
                    return [];
                }

                const edits: TextEdit[] = [];
                editActions.forEach(editAction => {
                    edits.push({
                        range: convertRange(editAction.range),
                        newText: editAction.replacementText
                    });
                });

                return edits;
            }
        }

        if (cmdParams.command === commandCreateTypeStub) {
            if (cmdParams.arguments && cmdParams.arguments.length >= 2) {
                const workspaceRoot = cmdParams.arguments[0];
                const importName = cmdParams.arguments[1];
                const service = this._createTypeStubService(importName);

                // Allocate a temporary pseudo-workspace to perform this job.
                const workspace: WorkspaceServiceInstance = {
                    workspaceName: `Create Type Stub ${ importName }`,
                    rootPath: workspaceRoot,
                    rootUri: convertPathToUri(workspaceRoot),
                    serviceInstance: service,
                    disableLanguageServices: true
                };

                service.setCompletionCallback(results => {
                    if (results.filesRequiringAnalysis === 0) {
                        try {
                            service.writeTypeStub();
                            service.dispose();
                            const infoMessage = `Type stub was successfully created for '${ importName }'.`;
                            this._connection.window.showInformationMessage(infoMessage);
                            this._handlePostCreateTypeStub();
                        } catch (err) {
                            let errMessage = '';
                            if (err instanceof Error) {
                                errMessage = ': ' + err.message;
                            }
                            errMessage = `An error occurred when creating type stub for '${ importName }'` +
                                errMessage;
                            this._connection.console.error(errMessage);
                            this._connection.window.showErrorMessage(errMessage);
                        }
                    }
                });

                const serverSettings = await this.getSettings(workspace);
                this._updateOptionsAndRestartService(workspace, serverSettings, importName);
                return;
            }
        }

        return new ResponseError<string>(1, 'Unsupported command');
    }

    private _updateSettingsForAllWorkspaces(): void {
        this._workspaceMap.forEach(workspace => {
            this._updateSettingsForWorkspace(workspace).ignoreErrors();
        });
    }

    private async _updateSettingsForWorkspace(workspace: WorkspaceServiceInstance): Promise<void> {
        const serverSettings = await this.getSettings(workspace);
        this._updateOptionsAndRestartService(workspace, serverSettings);
        workspace.disableLanguageServices = !!serverSettings.disableLanguageServices;
    }

    private _updateOptionsAndRestartService(workspace: WorkspaceServiceInstance,
        serverSettings: ServerSettings, typeStubTargetImportName?: string) {

        const commandLineOptions = new CommandLineOptions(workspace.rootPath, true);
        commandLineOptions.checkOnlyOpenFiles = serverSettings.openFilesOnly;
        commandLineOptions.useLibraryCodeForTypes = serverSettings.useLibraryCodeForTypes;

        // Disable watching of source files in the VS Code extension if we're
        // analyzing only open files. The file system watcher code has caused
        // lots of problems across multiple platforms. It provides little or
        // no benefit when we're in "openFilesOnly" mode.
        commandLineOptions.watch = !commandLineOptions.checkOnlyOpenFiles;

        if (serverSettings.venvPath) {
            commandLineOptions.venvPath = combinePaths(workspace.rootPath || this._rootPath,
                normalizePath(this._expandPathVariables(serverSettings.venvPath)));
        }

        if (serverSettings.pythonPath) {
            // The Python VS Code extension treats the value "python" specially. This means
            // the local python interpreter should be used rather than interpreting the
            // setting value as a path to the interpreter. We'll simply ignore it in this case.
            if (serverSettings.pythonPath.trim() !== 'python') {
                commandLineOptions.pythonPath = combinePaths(workspace.rootPath || this._rootPath,
                    normalizePath(this._expandPathVariables(serverSettings.pythonPath)));
            }
        }

        if (serverSettings.typeshedPath) {
            // Pyright supports only one typeshed path currently, whereas the
            // official VS Code Python extension supports multiple typeshed paths.
            // We'll use the first one specified and ignore the rest.
            commandLineOptions.typeshedPath =
                this._expandPathVariables(serverSettings.typeshedPath);
        }

        if (typeStubTargetImportName) {
            commandLineOptions.typeStubTargetImportName = typeStubTargetImportName;
        }

        workspace.serviceInstance.setOptions(commandLineOptions);
    }

    // Expands certain predefined variables supported within VS Code settings.
    // Ideally, VS Code would provide an API for doing this expansion, but
    // it doesn't. We'll handle the most common variables here as a convenience.
    private _expandPathVariables(value: string): string {
        const regexp = /\$\{(.*?)\}/g;
        return value.replace(regexp, (match: string, name: string) => {
            const trimmedName = name.trim();
            if (trimmedName === 'workspaceFolder') {
                return this._rootPath;
            }
            return match;
        });
    }

    private _convertDiagnostics(diags: AnalyzerDiagnostic[]): Diagnostic[] {
        return diags.map(diag => {
            const severity = diag.category === DiagnosticCategory.Error ?
                DiagnosticSeverity.Error : DiagnosticSeverity.Warning;

            let source = this._productName;
            const rule = diag.getRule();
            if (rule) {
                source = `${ source } (${ rule })`;
            }

            const vsDiag = Diagnostic.create(convertRange(diag.range), diag.message, severity,
                undefined, source);

            if (diag.category === DiagnosticCategory.UnusedCode) {
                vsDiag.tags = [DiagnosticTag.Unnecessary];
                vsDiag.severity = DiagnosticSeverity.Hint;
            }

            const relatedInfo = diag.getRelatedInfo();
            if (relatedInfo.length > 0) {
                vsDiag.relatedInformation = relatedInfo.map(info => {
                    return DiagnosticRelatedInformation.create(
                        Location.create(convertPathToUri(info.filePath),
                            convertRange(info.range)),
                        info.message
                    );
                });
            }

            return vsDiag;
        });
    }

    private _recordUserInteractionTime() {
        // Tell all of the services that the user is actively
        // interacting with one or more editors, so they should
        // back off from performing any work.
        this._workspaceMap.forEach(workspace => {
            workspace.serviceInstance.recordUserInteractionTime();
        });
    }
}
