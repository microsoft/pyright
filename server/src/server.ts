/*
 * server.ts
 *
 * Implements pyright language server.
 */

import * as fs from 'fs';
import * as path from 'path';
import { isArray } from 'util';
import { CodeAction, CodeActionParams, Command, ExecuteCommandParams } from 'vscode-languageserver';
import { CommandController } from './commands/commandController';
import * as debug from './common/debug';
import { convertUriToPath, getDirectoryPath, normalizeSlashes } from './common/pathUtils';
import { LanguageServerBase, ServerSettings, WorkspaceServiceInstance } from './languageServerBase';
import { CodeActionProvider } from './languageService/codeActionProvider';

class Server extends LanguageServerBase {
    private _controller: CommandController;

    constructor() {
        // pyright has "typeshed-fallback" under "client" and __dirname points to "client/server"
        // make sure root directory point to "client", one level up from "client/server" where we can discover
        // "typeshed-fallback" folder. in release, root is "extension" instead of "client" but
        // folder structure is same (extension/server).
        //
        // root directory will be used for 2 different purposes.
        // 1. to find "typeshed-fallback" folder.
        // 2. to set "cwd" to run python to find search path.
        const rootDirectory = getDirectoryPath(__dirname);
        debug.assert(fs.existsSync(path.join(rootDirectory, 'typeshed-fallback')), `Unable to locate typeshed fallback folder at '${ rootDirectory }'`);
        super('Pyright', rootDirectory);

        this._controller = new CommandController(this);
    }

    async getSettings(workspace: WorkspaceServiceInstance): Promise<ServerSettings> {
        const serverSettings: ServerSettings = {};
        try {
            const pythonSection = await this.getConfiguration(workspace, 'python');
            if (pythonSection) {
                serverSettings.pythonPath = normalizeSlashes(pythonSection.pythonPath);
                serverSettings.venvPath = normalizeSlashes(pythonSection.venvPath);
            }

            const pythonAnalysisSection = await this.getConfiguration(workspace, 'python.analysis');
            if (pythonAnalysisSection) {
                const typeshedPaths = pythonAnalysisSection.typeshedPaths;
                if (typeshedPaths && isArray(typeshedPaths) && typeshedPaths.length > 0) {
                    serverSettings.typeshedPath = normalizeSlashes(typeshedPaths[0]);
                }
            }

            const pyrightSection = await this.getConfiguration(workspace, 'pyright');
            if (pyrightSection) {
                serverSettings.openFilesOnly = !!pyrightSection.openFilesOnly;
                serverSettings.useLibraryCodeForTypes = !!pyrightSection.useLibraryCodeForTypes;
                serverSettings.disableLanguageServices = !!pyrightSection.disableLanguageServices;
            } else {
                serverSettings.openFilesOnly = true;
                serverSettings.useLibraryCodeForTypes = false;
                serverSettings.disableLanguageServices = false;
            }
        } catch (error) {
            this.console.log(`Error reading settings: ${ error }`);
        }
        return serverSettings;
    }

    protected executeCommand(cmdParams: ExecuteCommandParams): Promise<any> {
        return this._controller.execute(cmdParams);
    }

    protected async executeCodeAction(params: CodeActionParams): Promise<(Command | CodeAction)[] | undefined | null> {
        this.recordUserInteractionTime();

        const filePath = convertUriToPath(params.textDocument.uri);
        const workspace = this.workspaceMap.getWorkspaceForFile(filePath);
        return CodeActionProvider.getCodeActionsForPosition(workspace, filePath, params.range);
    }
}

export const server = new Server();
