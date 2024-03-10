/*
 * extension.ts
 *
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Provides client for Pyright Python language server. This portion runs
 * in the context of the VS Code process and talks to the server, which
 * runs in another process.
 */

import { PythonExtension } from '@vscode/python-extension';
import { existsSync } from 'fs';
import os from 'os';
import * as path from 'path';
import { Commands } from 'pyright-internal/commands/commands';
import { isThenable } from 'pyright-internal/common/core';
import {
    commands,
    ExtensionContext,
    ExtensionMode,
    extensions,
    OutputChannel,
    Position,
    Range,
    TextEditor,
    TextEditorEdit,
    Uri,
    window,
    workspace,
    WorkspaceConfiguration,
    env,
    languages,
    SemanticTokens,
    InlayHint,
    InlayHintLabelPart,
} from 'vscode';
import {
    CancellationToken,
    ConfigurationParams,
    ConfigurationRequest,
    DidChangeConfigurationNotification,
    InlayHintRequest,
    LanguageClient,
    LanguageClientOptions,
    ResponseError,
    SemanticTokensRequest,
    ServerOptions,
    TextEdit,
    TransportKind,
} from 'vscode-languageclient/node';
import { FileBasedCancellationStrategy } from './cancellationUtils';
import { githubRepo, toolName } from 'pyright-internal/constants';
import { cp } from 'fs/promises';
import { SemanticTokensProviderLegend } from 'pyright-internal/languageService/semanticTokensProvider';

let cancellationStrategy: FileBasedCancellationStrategy | undefined;

let languageClient: LanguageClient | undefined;

const pythonPathChangedListenerMap = new Map<string, string>();

// Request a heap size of 3GB. This is reasonable for modern systems.
const defaultHeapSize = 3072;

export async function activate(context: ExtensionContext) {
    // See if Pylance is installed. If so, make sure its config doesn't conflict with basedpyright's
    if (extensions.getExtension('ms-python.vscode-pylance')) {
        const pylanceTypeCheckingEnabled =
            workspace.getConfiguration('python.analysis').get('typeCheckingMode') !== 'off';
        const pyrightLanguageServerEnabled = !workspace.getConfiguration('basedpyright').get('disableLanguageServices');
        if (pylanceTypeCheckingEnabled || pyrightLanguageServerEnabled) {
            const problems: { name: string; action: () => void }[] = [];
            if (pylanceTypeCheckingEnabled) {
                problems.push({
                    name: 'pylance typechecking',
                    action: () => workspace.getConfiguration('python.analysis').update('typeCheckingMode', 'off'),
                });
            }
            if (pyrightLanguageServerEnabled) {
                problems.push({
                    name: 'basedpyright LSP',
                    action: () => workspace.getConfiguration('basedpyright').update('disableLanguageServices', true),
                });
            }
            if (problems.length > 0) {
                const moreInfo = 'More info';
                const result = await window.showWarningMessage(
                    'BasedPyright has detected that the Pylance extension is installed and overlapping functionality is enabled.',
                    `Disable ${problems.map((problem) => problem.name).join(' & ')}`,
                    moreInfo
                );
                if (result === moreInfo) {
                    env.openExternal(Uri.parse(`${githubRepo}/#if-using-pylance`));
                } else if (result !== undefined) {
                    problems.forEach((problem) => problem.action());
                }
            }
        }
    }

    cancellationStrategy = new FileBasedCancellationStrategy();
    let serverOptions: ServerOptions | undefined = undefined;
    if (workspace.getConfiguration('basedpyright').get('importStrategy') === 'fromEnvironment') {
        const pythonApi = await PythonExtension.api();
        const executableName = `basedpyright-langserver${os.platform() === 'win32' ? '.exe' : ''}`;
        const executableDir = path.join(pythonApi.environments.getActiveEnvironmentPath().path, '..');
        const executablePath = path.join(executableDir, executableName);
        if (existsSync(executablePath)) {
            console.log('using pyright executable:', executablePath);

            // make a copy of the exe to avoid locking it, which would otherwise cause crashes when you try to
            // update/uninstall basedpyright while vscode is open
            let copiedExecutablePath = path.join(executableDir, `_vscode_copy_${executableName}`);
            try {
                await cp(executablePath, copiedExecutablePath, { force: true });
            } catch (e) {
                console.warn(`failed to create copy at ${copiedExecutablePath}, falling back to using the real one`);
                copiedExecutablePath = executablePath;
            }
            serverOptions = {
                command: copiedExecutablePath,
                transport: TransportKind.stdio,
                args: cancellationStrategy.getCommandLineArguments(),
            };
        } else {
            console.warn('failed to find pyright executable, falling back to bundled:', executablePath);
        }
    }
    if (!serverOptions) {
        console.log('using bundled pyright');
        const bundlePath = context.asAbsolutePath(path.join('dist', 'server.js'));

        const runOptions = { execArgv: [`--max-old-space-size=${defaultHeapSize}`] };
        const debugOptions = { execArgv: ['--nolazy', '--inspect=6600', `--max-old-space-size=${defaultHeapSize}`] };

        // If the extension is launched in debug mode, then the debug server options are used.
        serverOptions = {
            run: {
                module: bundlePath,
                transport: TransportKind.ipc,
                args: cancellationStrategy.getCommandLineArguments(),
                options: runOptions,
            },
            // In debug mode, use the non-bundled code if it's present. The production
            // build includes only the bundled package, so we don't want to crash if
            // someone starts the production extension in debug mode.
            debug: {
                module: bundlePath,
                transport: TransportKind.ipc,
                args: cancellationStrategy.getCommandLineArguments(),
                options: debugOptions,
            },
        };
    }

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
        // Register the server for python source files.
        documentSelector: [
            { scheme: 'file', language: 'python' },
            { scheme: 'untitled', language: 'python' },
        ],
        synchronize: {
            // Synchronize the setting section to the server.
            configurationSection: ['python', 'basedpyright'],
        },
        connectionOptions: { cancellationStrategy: cancellationStrategy },
        middleware: {
            // Use the middleware hook to override the configuration call. This allows
            // us to inject the proper "python.pythonPath" setting from the Python extension's
            // private settings store.
            workspace: {
                configuration: async (
                    params: ConfigurationParams,
                    token: CancellationToken,
                    next: ConfigurationRequest.HandlerSignature
                ) => {
                    let result = next(params, token);
                    if (isThenable(result)) {
                        result = await result;
                    }
                    if (result instanceof ResponseError) {
                        return result;
                    }

                    for (const [i, item] of params.items.entries()) {
                        if (item.section === 'basedpyright.analysis') {
                            const analysisConfig = workspace.getConfiguration(
                                item.section,
                                item.scopeUri ? Uri.parse(item.scopeUri) : undefined
                            );

                            // If stubPath is not set, remove it rather than sending default value.
                            // This lets the server know that it's unset rather than explicitly
                            // set to the default value (typings) so it can behave differently.
                            if (!isConfigSettingSetByUser(analysisConfig, 'stubPath')) {
                                delete (result[i] as any).stubPath;
                            }
                        }
                    }

                    // For backwards compatibility, set python.pythonPath to the configured
                    // value as though it were in the user's settings.json file.
                    const addPythonPath = (settings: any[]): Promise<any[]> => {
                        const pythonPathPromises: Promise<string | undefined>[] = params.items.map((item) => {
                            if (item.section === 'python') {
                                const uri = item.scopeUri ? Uri.parse(item.scopeUri) : undefined;
                                return getPythonPathFromPythonExtension(client.outputChannel, uri, () => {
                                    // Posts a "workspace/didChangeConfiguration" message to the service
                                    // so it re-queries the settings for all workspaces.
                                    client.sendNotification(DidChangeConfigurationNotification.type, {
                                        settings: null,
                                    });
                                });
                            }
                            return Promise.resolve(undefined);
                        });

                        return Promise.all(pythonPathPromises).then((pythonPaths) => {
                            pythonPaths.forEach((pythonPath, i) => {
                                // If there is a pythonPath returned by the Python extension,
                                // always prefer this over the pythonPath that uses the old
                                // mechanism.
                                if (pythonPath !== undefined) {
                                    settings[i].pythonPath = pythonPath;
                                }
                            });
                            return settings;
                        });
                    };

                    return addPythonPath(result);
                },
            },
        },
    };

    // Create the language client and start the client.
    const client = new LanguageClient('python', toolName, serverOptions, clientOptions);
    languageClient = client;

    // Register our custom commands.
    const textEditorCommands = [Commands.orderImports];
    textEditorCommands.forEach((commandName) => {
        context.subscriptions.push(
            commands.registerTextEditorCommand(
                commandName,
                (editor: TextEditor, edit: TextEditorEdit, ...args: any[]) => {
                    const cmd = {
                        command: commandName,
                        arguments: [editor.document.uri.toString(), ...args],
                    };

                    client.sendRequest<TextEdit[] | undefined>('workspace/executeCommand', cmd).then((edits) => {
                        if (edits && edits.length > 0) {
                            editor.edit((editBuilder) => {
                                edits.forEach((edit) => {
                                    const startPos = new Position(edit.range.start.line, edit.range.start.character);
                                    const endPos = new Position(edit.range.end.line, edit.range.end.character);
                                    const range = new Range(startPos, endPos);
                                    editBuilder.replace(range, edit.newText);
                                });
                            });
                        }
                    });
                },
                () => {
                    // Error received. For now, do nothing.
                }
            )
        );
    });

    const genericCommands = [Commands.createTypeStub, Commands.restartServer];
    genericCommands.forEach((command) => {
        context.subscriptions.push(
            commands.registerCommand(command, (...args: any[]) => {
                client.sendRequest('workspace/executeCommand', { command, arguments: args });
            })
        );
    });

    // Register the debug only commands when running under the debugger.
    if (context.extensionMode === ExtensionMode.Development) {
        // Create a 'when' context for development.
        commands.executeCommand('setContext', 'pyright.development', true);

        // Register the commands that only work when in development mode.
        context.subscriptions.push(
            commands.registerCommand(Commands.dumpTokens, () => {
                const uri = window.activeTextEditor?.document.uri.toString();
                if (uri) {
                    client.sendRequest('workspace/executeCommand', {
                        command: Commands.dumpFileDebugInfo,
                        arguments: [uri, 'tokens'],
                    });
                }
            })
        );

        context.subscriptions.push(
            commands.registerCommand(Commands.dumpNodes, () => {
                const uri = window.activeTextEditor?.document.uri.toString();
                if (uri) {
                    client.sendRequest('workspace/executeCommand', {
                        command: Commands.dumpFileDebugInfo,
                        arguments: [uri, 'nodes'],
                    });
                }
            })
        );

        context.subscriptions.push(
            commands.registerCommand(Commands.dumpTypes, () => {
                const uri = window.activeTextEditor?.document.uri.toString();
                if (uri) {
                    const start = window.activeTextEditor!.selection.start;
                    const end = window.activeTextEditor!.selection.end;
                    const startOffset = window.activeTextEditor!.document.offsetAt(start);
                    const endOffset = window.activeTextEditor!.document.offsetAt(end);
                    client.sendRequest('workspace/executeCommand', {
                        command: Commands.dumpFileDebugInfo,
                        arguments: [uri, 'types', startOffset, endOffset],
                    });
                }
            })
        );
        context.subscriptions.push(
            commands.registerCommand(Commands.dumpCachedTypes, () => {
                const uri = window.activeTextEditor?.document.uri.toString();
                if (uri) {
                    const start = window.activeTextEditor!.selection.start;
                    const end = window.activeTextEditor!.selection.end;
                    const startOffset = window.activeTextEditor!.document.offsetAt(start);
                    const endOffset = window.activeTextEditor!.document.offsetAt(end);
                    client.sendRequest('workspace/executeCommand', {
                        command: Commands.dumpFileDebugInfo,
                        arguments: [uri, 'cachedtypes', startOffset, endOffset],
                    });
                }
            })
        );
        context.subscriptions.push(
            commands.registerCommand(Commands.dumpCodeFlowGraph, () => {
                const uri = window.activeTextEditor?.document.uri.toString();
                if (uri) {
                    const start = window.activeTextEditor!.selection.start;
                    const startOffset = window.activeTextEditor!.document.offsetAt(start);
                    client.sendRequest('workspace/executeCommand', {
                        command: Commands.dumpFileDebugInfo,
                        arguments: [uri, 'codeflowgraph', startOffset],
                    });
                }
            })
        );
    }
    const documentSelector = { language: 'python', scheme: 'file' };
    languages.registerDocumentSemanticTokensProvider(
        documentSelector,
        {
            provideDocumentSemanticTokens: async (document) => {
                const result = await client.sendRequest(SemanticTokensRequest.type, {
                    textDocument: { uri: document.uri.toString() },
                });
                if (result === null) {
                    return result;
                }
                return new SemanticTokens(Uint32Array.from(result.data), result?.resultId);
            },
        },
        SemanticTokensProviderLegend
    );

    languages.registerInlayHintsProvider(documentSelector, {
        provideInlayHints: async (document) => {
            const result = await client.sendRequest(InlayHintRequest.type, {
                textDocument: { uri: document.uri.toString() },
                range: document.validateRange(new Range(new Position(0, 0), new Position(Infinity, Infinity))),
            });
            return result?.map(
                (result) =>
                    new InlayHint(
                        new Position(result.position.character, result.position.line),
                        typeof result.label === 'string'
                            ? result.label
                            : result.label.map((label) => new InlayHintLabelPart(label.value)),
                        result.kind
                    )
            );
        },
    });

    await client.start();
}

export function deactivate() {
    if (cancellationStrategy) {
        cancellationStrategy.dispose();
        cancellationStrategy = undefined;
    }

    const client = languageClient;
    languageClient = undefined;

    return client?.stop();
}

// The VS Code Python extension manages its own internal store of configuration settings.
// The setting that was traditionally named "python.pythonPath" has been moved to the
// Python extension's internal store for reasons of security and because it differs per
// project and by user.
async function getPythonPathFromPythonExtension(
    outputChannel: OutputChannel,
    scopeUri: Uri | undefined,
    postConfigChanged: () => void
): Promise<string | undefined> {
    try {
        const extension = extensions.getExtension('ms-python.python');
        if (!extension) {
            outputChannel.appendLine('Python extension not found');
        } else {
            if (extension.packageJSON?.featureFlags?.usingNewInterpreterStorage) {
                if (!extension.isActive) {
                    outputChannel.appendLine('Waiting for Python extension to load');
                    await extension.activate();
                    outputChannel.appendLine('Python extension loaded');
                }

                const execDetails = await extension.exports.settings.getExecutionDetails(scopeUri);
                let result: string | undefined;
                if (execDetails.execCommand && execDetails.execCommand.length > 0) {
                    result = execDetails.execCommand[0];
                }

                if (extension.exports.settings.onDidChangeExecutionDetails) {
                    installPythonPathChangedListener(
                        extension.exports.settings.onDidChangeExecutionDetails,
                        scopeUri,
                        postConfigChanged
                    );
                }

                if (!result) {
                    outputChannel.appendLine(`No pythonPath provided by Python extension`);
                } else {
                    outputChannel.appendLine(`Received pythonPath from Python extension: ${result}`);
                }

                return result;
            }
        }
    } catch (error) {
        outputChannel.appendLine(
            `Exception occurred when attempting to read pythonPath from Python extension: ${JSON.stringify(error)}`
        );
    }

    return undefined;
}

function installPythonPathChangedListener(
    onDidChangeExecutionDetails: (callback: () => void) => void,
    scopeUri: Uri | undefined,
    postConfigChanged: () => void
) {
    const uriString = scopeUri ? scopeUri.toString() : '';

    // No need to install another listener for this URI if
    // it already exists.
    if (pythonPathChangedListenerMap.has(uriString)) {
        return;
    }

    onDidChangeExecutionDetails(() => {
        postConfigChanged();
    });

    pythonPathChangedListenerMap.set(uriString, uriString);
}

function isConfigSettingSetByUser(configuration: WorkspaceConfiguration, setting: string): boolean {
    const inspect = configuration.inspect(setting);
    if (inspect === undefined) {
        return false;
    }

    return (
        inspect.globalValue !== undefined ||
        inspect.workspaceValue !== undefined ||
        inspect.workspaceFolderValue !== undefined ||
        inspect.globalLanguageValue !== undefined ||
        inspect.workspaceLanguageValue !== undefined ||
        inspect.workspaceFolderLanguageValue !== undefined
    );
}
