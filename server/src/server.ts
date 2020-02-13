/*
 * server.ts
 *
 * Implements pyright language server.
 */

import { isArray } from 'util';
import { CodeAction, CodeActionParams, Command, ExecuteCommandParams } from 'vscode-languageserver';
import { CommandController } from './commands/commandController';
import { convertUriToPath, getDirectoryPath, normalizeSlashes } from './common/pathUtils';
import { LanguageServerBase, ServerSettings, WorkspaceServiceInstance } from './languageServerBase';
import { CodeActionProvider } from './languageService/codeActionProvider';

class Server extends LanguageServerBase {
    private _controller: CommandController;

    constructor() {
        super('Pyright', getDirectoryPath(__dirname));

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
