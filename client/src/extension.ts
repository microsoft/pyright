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

import * as fs from 'fs';
import * as path from 'path';
import { commands, ExtensionContext, Position, Range, TextEditor, TextEditorEdit } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TextEdit, TransportKind } from 'vscode-languageclient';

import { Commands } from '../../server/src/commands/commands';
import { FileBasedCancellationStrategy } from './cancellationUtils';
import { ProgressReporting } from './progress';

let cancellationStrategy: FileBasedCancellationStrategy | undefined;

export function activate(context: ExtensionContext) {
    cancellationStrategy = new FileBasedCancellationStrategy();

    const bundlePath = context.asAbsolutePath(path.join('server', 'server.bundle.js'));
    const nonBundlePath = context.asAbsolutePath(path.join('server', 'src', 'server.js'));
    const debugOptions = { execArgv: ['--nolazy', '--inspect=6600'] };

    // If the extension is launched in debug mode, then the debug server options are used.
    const serverOptions: ServerOptions = {
        run: { module: bundlePath, transport: TransportKind.ipc, args: cancellationStrategy.getCommandLineArguments() },
        // In debug mode, use the non-bundled code if it's present. The production
        // build includes only the bundled package, so we don't want to crash if
        // someone starts the production extension in debug mode.
        debug: {
            module: fs.existsSync(nonBundlePath) ? nonBundlePath : bundlePath,
            transport: TransportKind.ipc,
            args: cancellationStrategy.getCommandLineArguments(),
            options: debugOptions,
        },
    };

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
        // Register the server for python source files.
        documentSelector: [
            {
                scheme: 'file',
                language: 'python',
            },
        ],
        synchronize: {
            // Synchronize the setting section to the server.
            configurationSection: ['python', 'pyright'],
        },
        connectionOptions: { cancellationStrategy: cancellationStrategy },
    };

    // Create the language client and start the client.
    const languageClient = new LanguageClient('python', 'Pyright', serverOptions, clientOptions);
    const disposable = languageClient.start();

    // Push the disposable to the context's subscriptions so that the
    // client can be deactivated on extension deactivation.
    context.subscriptions.push(disposable);

    // Allocate a progress reporting object.
    const progressReporting = new ProgressReporting(languageClient);
    context.subscriptions.push(progressReporting);

    // Register our custom commands.
    const textEditorCommands = [Commands.orderImports, Commands.addMissingOptionalToParam];
    textEditorCommands.forEach((commandName) => {
        context.subscriptions.push(
            commands.registerTextEditorCommand(
                commandName,
                (editor: TextEditor, edit: TextEditorEdit, ...args: any[]) => {
                    const cmd = {
                        command: commandName,
                        arguments: [editor.document.uri.toString(), ...args],
                    };

                    languageClient
                        .sendRequest('workspace/executeCommand', cmd)
                        .then((edits: TextEdit[] | undefined) => {
                            if (edits && edits.length > 0) {
                                editor.edit((editBuilder) => {
                                    edits.forEach((edit) => {
                                        const startPos = new Position(
                                            edit.range.start.line,
                                            edit.range.start.character
                                        );
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
                languageClient.sendRequest('workspace/executeCommand', { command, arguments: args });
            })
        );
    });
}

export function deactivate() {
    if (cancellationStrategy) {
        cancellationStrategy.dispose();
        cancellationStrategy = undefined;
    }

    // Return undefined rather than a promise to indicate
    // that deactivation is done synchronously. We don't have
    // anything to do here.
    return undefined;
}
