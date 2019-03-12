"use strict";
/*
* extension.ts
*
* Provides client for Pyright Python language server. This portion runs
* in the context of the VS Code process and talks to the server, which
* runs in another process.
*/
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const vscode_1 = require("vscode");
const vscode_languageclient_1 = require("vscode-languageclient");
function activate(context) {
    let serverModule = context.asAbsolutePath(path.join('server', 'server.js'));
    let debugOptions = { execArgv: ["--nolazy", "--inspect=6600"] };
    // If the extension is launched in debug mode, then the debug server options are used.
    // Otherwise the run options are used.
    let serverOptions = {
        run: { module: serverModule, transport: vscode_languageclient_1.TransportKind.ipc },
        debug: { module: serverModule, transport: vscode_languageclient_1.TransportKind.ipc, options: debugOptions }
    };
    // Options to control the language client
    let clientOptions = {
        // Register the server for plain text documents
        documentSelector: [{
                scheme: 'file',
                language: 'python'
            }],
        synchronize: {
            // Synchronize the setting section 'languageServerExample' to the server
            configurationSection: 'python',
            // Notify the server about file changes to '.clientrc files contain in the workspace
            fileEvents: vscode_1.workspace.createFileSystemWatcher('**/.clientrc')
        }
    };
    // Create the language client and start the client.
    let languageClient = new vscode_languageclient_1.LanguageClient('python', 'Python', serverOptions, clientOptions);
    let disposable = languageClient.start();
    // Push the disposable to the context's subscriptions so that the 
    // client can be deactivated on extension deactivation.
    context.subscriptions.push(disposable);
}
exports.activate = activate;
//# sourceMappingURL=extension.js.map