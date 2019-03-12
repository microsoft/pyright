/*
* extension.ts
*
* Provides client for Pyright Python language server. This portion runs
* in the context of the VS Code process and talks to the server, which
* runs in another process.
*/

import * as path from 'path';
import { ExtensionContext, workspace } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient';

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
		// Register the server for plain text documents
		documentSelector: [{
			scheme: 'file',
			language: 'python'
		}],
		synchronize: {
			// Synchronize the setting section 'languageServerExample' to the server
			configurationSection: 'python',
			// Notify the server about file changes to '.clientrc files contain in the workspace
			fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
		}
	}
	
	// Create the language client and start the client.
	let languageClient = new LanguageClient('python', 'Python', serverOptions, clientOptions);
	let disposable = languageClient.start();
	
	// Push the disposable to the context's subscriptions so that the 
	// client can be deactivated on extension deactivation.
	context.subscriptions.push(disposable);
}
