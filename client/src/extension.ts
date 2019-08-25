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
import { ExtensionContext, commands, TextEditor, Range, Position } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind,
	TextEdit } from 'vscode-languageclient';
import { ProgressReporting } from './progress';

export function activate(context: ExtensionContext) {
	let serverModule = context.asAbsolutePath(path.join('server', 'server.js'));
	let debugOptions = { execArgv: ["--nolazy", "--inspect=6600"] };
	
	// If the extension is launched in debug mode, then the debug server options are used.
	// Otherwise the run options are used.
	let serverOptions: ServerOptions = {
		run : { module: serverModule, transport: TransportKind.ipc },
		debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
	}
	
	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		// Register the server for python source files.
		documentSelector: [{
			scheme: 'file',
			language: 'python'
		}],
		synchronize: {
			// Synchronize the setting section to the server.
			configurationSection: ['python', 'pyright']
		}
	}
	
	// Create the language client and start the client.
	let languageClient = new LanguageClient('python', 'Pyright', serverOptions, clientOptions);
	let disposable = languageClient.start();
	
	// Push the disposable to the context's subscriptions so that the 
	// client can be deactivated on extension deactivation.
	context.subscriptions.push(disposable);

	// Allocate a progress reporting object.
	const progressReporting = new ProgressReporting(languageClient);
	context.subscriptions.push(progressReporting);

	// Register our custom commands.
	context.subscriptions.push(commands.registerTextEditorCommand('pyright.sortimports',
	(editor: TextEditor) => {
		const cmd = {
			command: 'pyright.sortimports',
			arguments: [editor.document.uri.toString()]
		};
	
		languageClient.sendRequest('workspace/executeCommand', cmd).then((edits: TextEdit[] | undefined) => {
			if (edits && edits.length > 0) {
				editor.edit(editBuilder => {
					edits.forEach(edit => {
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
	}));
}

export function deactivate() {
	// Return undefined rather than a promise to indicate
	// that deactivation is done synchronously. We don't have
	// anything to do here.
	return undefined;
}

