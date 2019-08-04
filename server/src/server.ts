/*
* server.ts
*
* Implements pyright language server.
*/

import {
    createConnection, Diagnostic, DiagnosticSeverity, DiagnosticTag,
    IConnection, InitializeResult, IPCMessageReader, IPCMessageWriter,
    Location, ParameterInformation, Position, Range, SignatureInformation,
    TextDocuments
} from 'vscode-languageserver';
import VSCodeUri from 'vscode-uri';

import { AnalyzerService } from './analyzer/service';
import { CommandLineOptions } from './common/commandLineOptions';
import { Diagnostic as AnalyzerDiagnostic, DiagnosticCategory, DiagnosticTextPosition,
    DiagnosticTextRange } from './common/diagnostic';
import { combinePaths, getDirectoryPath, normalizePath } from './common/pathUtils';
import StringMap from './common/stringMap';

interface PythonSettings {
    venvPath?: string;
    pythonPath?: string;
    analysis?: {
        typeshedPaths: string[];
    };
}

interface Settings {
    // If more sections are added to this interface,
    // make sure to update the sections array in the
    // updateSettingsForAllWorkspaces method.
    python?: PythonSettings;
}

interface WorkspaceServiceInstance {
    workspaceName: string;
    rootPath: string;
    rootUri: string;
    serviceInstance: AnalyzerService;
}

// Stash the base directory into a global variable.
(global as any).__rootDirectory = getDirectoryPath(__dirname);

// Create a connection for the server. The connection uses Node's IPC as a transport
let _connection: IConnection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));

_connection.console.log('Pyright language server starting');

// Create a simple text document manager. The text document manager
// supports full document sync only.
let _documents: TextDocuments = new TextDocuments();

// Global root path - the basis for all global settings.
let _rootPath = '';

// Tracks whether we're currently displaying progress.
let _isDisplayingProgress = false;

let _workspaceMap = new StringMap<WorkspaceServiceInstance>();

// Make the text document manager listen on the connection
// for open, change and close text document events.
_documents.listen(_connection);

const _defaultWorkspacePath = '<default>';

function _createAnalyzerService(name: string): AnalyzerService {
    _connection.console.log(`Starting service instance "${ name }"`);
    const service = new AnalyzerService(name, _connection.console);

    // Don't allow the analysis engine to go too long without
    // reporting results. This will keep it responsive.
    service.setMaxAnalysisDuration({
        openFilesTimeInMs: 100,
        noOpenFilesTimeInMs: 500
    });

    service.setCompletionCallback(results => {
        results.diagnostics.forEach(fileDiag => {
            let diagnostics = _convertDiagnostics(fileDiag.diagnostics);

            // Send the computed diagnostics to the client.
            _connection.sendDiagnostics({
                uri: _convertPathToUri(fileDiag.filePath),
                diagnostics
            });

            if (results.filesRequiringAnalysis > 0) {
                if (!_isDisplayingProgress) {
                    _isDisplayingProgress = true;
                    _connection.sendNotification('pyright/beginProgress');
                }

                const fileOrFiles = results.filesRequiringAnalysis !== 1 ? 'files' : 'file';
                _connection.sendNotification('pyright/reportProgress',
                    `${ results.filesRequiringAnalysis } ${ fileOrFiles } to analyze`);
            } else {
                if (_isDisplayingProgress) {
                    _isDisplayingProgress = false;
                    _connection.sendNotification('pyright/endProgress');
                }
            }
        });
    });

    return service;
}

// After the server has started the client sends an initialize request. The server receives
// in the passed params the rootPath of the workspace plus the client capabilities.
_connection.onInitialize((params): InitializeResult => {
    _rootPath = params.rootPath || '';

    // Create a service instance for each of the workspace folders.
    if (params.workspaceFolders) {
        params.workspaceFolders.forEach(folder => {
            const path = _convertUriToPath(folder.uri);
            _workspaceMap.set(path, {
                workspaceName: folder.name,
                rootPath: path,
                rootUri: folder.uri,
                serviceInstance: _createAnalyzerService(folder.name)
            });
        });
    } else if (params.rootPath) {
        _workspaceMap.set(params.rootPath, {
            workspaceName: '',
            rootPath: params.rootPath,
            rootUri: '',
            serviceInstance: _createAnalyzerService(params.rootPath)
        });
    }

    // Create a default workspace for files that are outside
    // of all workspaces.
    _workspaceMap.set(_defaultWorkspacePath, {
        workspaceName: '',
        rootPath: '',
        rootUri: '',
        serviceInstance: _createAnalyzerService('<default>')
    });

    _connection.console.log(`Fetching settings for workspace(s)`);
    updateSettingsForAllWorkspaces();

    return {
        capabilities: {
            // Tell the client that the server works in FULL text document
            // sync mode (as opposed to incremental).
            textDocumentSync: _documents.syncKind,
            definitionProvider: true,
            referencesProvider: true,
            hoverProvider: true,
            completionProvider: {
                triggerCharacters: ['.']
            },
            signatureHelpProvider: {
                triggerCharacters: ['(', ',', ')']
            }
        }
    };
});

function _getWorkspaceForFile(filePath: string): WorkspaceServiceInstance {
    let bestRootPath: string | undefined;
    let bestInstance: WorkspaceServiceInstance | undefined;

    _workspaceMap.forEach(workspace => {
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

    if (bestInstance === undefined) {
        return _workspaceMap.get(_defaultWorkspacePath)!;
    }

    return bestInstance;
}

_connection.onDidChangeConfiguration(change => {
    _connection.console.log(`Received updated settings`);
    updateSettingsForAllWorkspaces();
});

_connection.onDefinition(params => {
    const filePath = _convertUriToPath(params.textDocument.uri);

    const position: DiagnosticTextPosition = {
        line: params.position.line,
        column: params.position.character
    };

    const service = _getWorkspaceForFile(filePath).serviceInstance;
    const locations = service.getDefinitionForPosition(filePath, position);
    if (!locations) {
        return undefined;
    }
    return locations.map(loc =>
        Location.create(_convertPathToUri(loc.path), _convertRange(loc.range)));
});

_connection.onReferences(params => {
    const filePath = _convertUriToPath(params.textDocument.uri);

    const position: DiagnosticTextPosition = {
        line: params.position.line,
        column: params.position.character
    };

    const service = _getWorkspaceForFile(filePath).serviceInstance;
    const locations = service.getReferencesForPosition(filePath, position,
            params.context.includeDeclaration);
    if (!locations) {
        return undefined;
    }
    return locations.map(loc =>
        Location.create(_convertPathToUri(loc.path), _convertRange(loc.range)));
});

_connection.onHover(params => {
    const filePath = _convertUriToPath(params.textDocument.uri);

    const position: DiagnosticTextPosition = {
        line: params.position.line,
        column: params.position.character
    };

    const service = _getWorkspaceForFile(filePath).serviceInstance;
    const hoverResults = service.getHoverForPosition(filePath, position);
    if (!hoverResults) {
        return undefined;
    }

    const markedStrings = hoverResults.parts.map(part => {
        if (part.python) {
            return {
                language: 'python',
                value: part.text
            };
        }
        return part.text;
    });

    return {
        contents: markedStrings,
        range: _convertRange(hoverResults.range)
    };
});

_connection.onSignatureHelp(params => {
    const filePath = _convertUriToPath(params.textDocument.uri);

    const position: DiagnosticTextPosition = {
        line: params.position.line,
        column: params.position.character
    };

    const service = _getWorkspaceForFile(filePath).serviceInstance;
    const signatureHelpResults = service.getSignatureHelpForPosition(
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

_connection.onCompletion(params => {
    const filePath = _convertUriToPath(params.textDocument.uri);

    const position: DiagnosticTextPosition = {
        line: params.position.line,
        column: params.position.character
    };

    const service = _getWorkspaceForFile(filePath).serviceInstance;
    return service.getCompletionsForPosition(filePath, position);
});

_connection.onDidOpenTextDocument(params => {
    const filePath = _convertUriToPath(params.textDocument.uri);
    const service = _getWorkspaceForFile(filePath).serviceInstance;
    service.setFileOpened(
        filePath,
        params.textDocument.version,
        params.textDocument.text);
});

_connection.onDidChangeTextDocument(params => {
    const filePath = _convertUriToPath(params.textDocument.uri);
    const service = _getWorkspaceForFile(filePath).serviceInstance;
    service.updateOpenFileContents(
        filePath,
        params.textDocument.version,
        params.contentChanges[0].text);
});

_connection.onDidCloseTextDocument(params => {
    const filePath = _convertUriToPath(params.textDocument.uri);
    const service = _getWorkspaceForFile(filePath).serviceInstance;
    service.setFileClosed(filePath);
});

function updateSettingsForAllWorkspaces() {
    _workspaceMap.forEach(workspace => {
        let settingsPromise: Thenable<PythonSettings>;
        if (workspace.rootUri) {
            settingsPromise = _connection.workspace.getConfiguration({
                scopeUri: workspace.rootUri || undefined,
                section: 'python'
            });
        } else {
            settingsPromise = _connection.workspace.getConfiguration(
                'python');
        }
        settingsPromise.then(settings => {
            updateOptionsAndRestartService(workspace, { python: settings });
        }, () => {
            // An error occurred trying to read the settings
            // for this workspace, so ignore.
        });
    });
}

function updateOptionsAndRestartService(workspace: WorkspaceServiceInstance,
        settings: Settings) {

    const commandLineOptions = new CommandLineOptions(workspace.rootPath, true);
    commandLineOptions.watch = true;
    commandLineOptions.verboseOutput = true;

    if (settings.python) {
        if (settings.python.venvPath) {
            commandLineOptions.venvPath = combinePaths(workspace.rootPath || _rootPath,
                normalizePath(_expandPathVariables(settings.python.venvPath)));
        }

        if (settings.python.pythonPath) {
            commandLineOptions.pythonPath = combinePaths(workspace.rootPath || _rootPath,
                normalizePath(_expandPathVariables(settings.python.pythonPath)));
        }

        if (settings.python.analysis &&
                settings.python.analysis.typeshedPaths &&
                settings.python.analysis.typeshedPaths.length > 0) {

            // Pyright supports only one typeshed path currently, whereas the
            // official VS Code Python extension supports multiple typeshed paths.
            // We'll use the first one specified and ignore the rest.
            commandLineOptions.typeshedPath =
                _expandPathVariables(settings.python.analysis.typeshedPaths[0]);
        }
    }

    workspace.serviceInstance.setOptions(commandLineOptions);
}

_connection.onInitialized(() => {
    _connection.workspace.onDidChangeWorkspaceFolders(event => {
        event.removed.forEach(workspace => {
            const rootPath = _convertUriToPath(workspace.uri);
            _workspaceMap.delete(rootPath);
        });

        event.added.forEach(workspace => {
            const rootPath = _convertUriToPath(workspace.uri);
            _workspaceMap.set(rootPath, {
                workspaceName: workspace.name,
                rootPath: rootPath,
                rootUri: workspace.uri,
                serviceInstance: _createAnalyzerService(workspace.name)
            });
        });
    });
});

// Expands certain predefined variables supported within VS Code settings.
// Ideally, VS Code would provide an API for doing this expansion, but
// it doesn't. We'll handle the most common variables here as a convenience.
function _expandPathVariables(value: string): string {
    const regexp = /\$\{(.*?)\}/g;
    return value.replace(regexp, (match: string, name: string) => {
        const trimmedName = name.trim();
        if (trimmedName === 'workspaceFolder') {
            return _rootPath;
        }
        return match;
    });
}

function _convertDiagnostics(diags: AnalyzerDiagnostic[]): Diagnostic[] {
    return diags.map(diag => {
        let severity = diag.category === DiagnosticCategory.Error ?
            DiagnosticSeverity.Error : DiagnosticSeverity.Warning;

        let vsDiag = Diagnostic.create(_convertRange(diag.range), diag.message, severity,
            undefined, 'pyright');

        if (diag.category === DiagnosticCategory.UnusedCode) {
            vsDiag.tags = [DiagnosticTag.Unnecessary];
            vsDiag.severity = DiagnosticSeverity.Hint;
        }

        return vsDiag;
    });
}

function _convertRange(range?: DiagnosticTextRange): Range {
    if (!range) {
        return Range.create(_convertPosition(), _convertPosition());
    }
    return Range.create(_convertPosition(range.start), _convertPosition(range.end));
}

function _convertPosition(position?: DiagnosticTextPosition): Position {
    if (!position) {
        return Position.create(0, 0);
    }
    return Position.create(position.line, position.column);
}

function _convertUriToPath(uriString: string): string {
    const uri = VSCodeUri.parse(uriString);
    let convertedPath = normalizePath(uri.path);

    // If this is a DOS-style path with a drive letter, remove
    // the leading slash.
    if (convertedPath.match(/^\\[a-zA-Z]:\\/)) {
        convertedPath = convertedPath.substr(1);
    }

    return convertedPath;
}

function _convertPathToUri(path: string): string {
    return VSCodeUri.file(path).toString();
}

// Listen on the connection
_connection.listen();
