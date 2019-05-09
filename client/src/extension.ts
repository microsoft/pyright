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

import * as path from 'path';
import { ExtensionContext, workspace as Workspace, TextDocument,
	OutputChannel, window as Window } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions,
	TransportKind } from 'vscode-languageclient';
import { ProgressReporting } from './progress';

const clientMap = new Map<string, LanguageClient>();

export function activate(context: ExtensionContext) {
	const outputChannel: OutputChannel = Window.createOutputChannel('pyright');
	const serverModule = context.asAbsolutePath(path.join('server', 'server.js'));
	const debugOptions = { execArgv: ["--nolazy", "--inspect=6600"] };

	// If the extension is launched in debug mode, then the debug server options are used.
	// Otherwise the run options are used.
	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
	}

	const detectDoc = (document: TextDocument) => {
		if (!(document.languageId === 'python' && document.uri.scheme === 'file')) {
			return;
		}

		let folder = Workspace.getWorkspaceFolder(document.uri);
		let clientKey: string;

		// If this document isn't found within any workspaces, we'll
		// still analyze it using a default workspace.
		if (folder) {
			clientKey = folder.uri.toString();
		} else {
			clientKey = '/';
		}

		// Have we already created a client for this workspace?
		if (clientMap.has(clientKey)) {
			return;
		}

		// Create the language client and start the client.
		// Options to control the language client
		const clientOptions: LanguageClientOptions = {
			// Register the server for python source files.
			documentSelector: [{
				scheme: 'file',
				language: 'python'
			}],
			synchronize: {
				// Synchronize the setting section to the server.
				configurationSection: 'python'
			},
			workspaceFolder: folder,
			outputChannel: outputChannel
		}
		const languageClient = new LanguageClient('python', 'Pyright',
			serverOptions, clientOptions);
		const disposable = languageClient.start();

		// Push the disposable to the context's subscriptions so that the 
		// client can be deactivated on extension deactivation.
		context.subscriptions.push(disposable);

		// Allocate a progress reporting object.
		const progressReporting = new ProgressReporting(languageClient);
		context.subscriptions.push(progressReporting);

		clientMap.set(clientKey, languageClient);
	};

	Workspace.onDidOpenTextDocument(detectDoc);
	Workspace.textDocuments.forEach(detectDoc);

	Workspace.onDidChangeWorkspaceFolders((event) => {
		for (let folder of event.removed) {
			const client = clientMap.get(folder.uri.toString());

			if (client) {
				clientMap.delete(folder.uri.toString());
				client.stop();
			}
		}
	});
}

export function deactivate(): Thenable<void> {
	const promises: Thenable<void>[] = [];

	for (let client of clientMap.values()) {
		promises.push(client.stop());
	}

	return Promise.all(promises).then(() => undefined);
}
