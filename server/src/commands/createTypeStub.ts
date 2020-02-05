/*
 * createTypeStub.ts
 *
 * Implements 'create stub' command functionality.
 */

import { ExecuteCommandParams } from 'vscode-languageserver';
import { AnalyzerService } from '../analyzer/service';
import { convertPathToUri } from '../common/pathUtils';
import { LanguageServerBase, WorkspaceServiceInstance } from '../languageServerBase';
import { ServerCommand } from './commandController';

export class CreateTypeStubCommand implements ServerCommand {
    constructor(private _ls: LanguageServerBase) {}

    async execute(cmdParams: ExecuteCommandParams): Promise<any> {
        if (cmdParams.arguments && cmdParams.arguments.length >= 2) {
            const workspaceRoot = cmdParams.arguments[0];
            const importName = cmdParams.arguments[1];
            const service = this._createTypeStubService(importName);

            // Allocate a temporary pseudo-workspace to perform this job.
            const workspace: WorkspaceServiceInstance = {
                workspaceName: `Create Type Stub ${importName}`,
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
                        const infoMessage = `Type stub was successfully created for '${importName}'.`;
                        this._ls.connection.window.showInformationMessage(infoMessage);
                        this._handlePostCreateTypeStub();
                    } catch (err) {
                        let errMessage = '';
                        if (err instanceof Error) {
                            errMessage = ': ' + err.message;
                        }
                        errMessage = `An error occurred when creating type stub for '${importName}'` + errMessage;
                        this._ls.connection.console.error(errMessage);
                        this._ls.connection.window.showErrorMessage(errMessage);
                    }
                }
            });

            const serverSettings = await this._ls.getSettings(workspace);
            this._ls.updateOptionsAndRestartService(workspace, serverSettings, importName);
            return;
        }
    }

    // Creates a service instance that's used for creating type
    // stubs for a specified target library.
    private _createTypeStubService(importName: string): AnalyzerService {
        this._ls.connection.console.log('Starting type stub service instance');
        const service = new AnalyzerService('Type stub', this._ls.fs, this._ls.connection.console);

        service.setMaxAnalysisDuration({
            openFilesTimeInMs: 500,
            noOpenFilesTimeInMs: 500
        });

        return service;
    }

    private _handlePostCreateTypeStub() {
        this._ls.workspaceMap.forEach(workspace => {
            workspace.serviceInstance.handlePostCreateTypeStub();
        });
    }
}
