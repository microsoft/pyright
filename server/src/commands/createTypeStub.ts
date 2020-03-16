/*
 * createTypeStub.ts
 *
 * Implements 'create stub' command functionality.
 */

import { CancellationToken, ExecuteCommandParams } from 'vscode-languageserver';

import { AnalyzerService } from '../analyzer/service';
import { convertPathToUri } from '../common/pathUtils';
import { LanguageServerInterface, WorkspaceServiceInstance } from '../languageServerBase';
import { AnalyzerServiceExecutor } from '../languageService/analyzerServiceExecutor';
import { ServerCommand } from './commandController';

export class CreateTypeStubCommand implements ServerCommand {
    constructor(private _ls: LanguageServerInterface) {}

    async execute(cmdParams: ExecuteCommandParams, token: CancellationToken): Promise<any> {
        if (cmdParams.arguments && cmdParams.arguments.length >= 2) {
            const workspaceRoot = cmdParams.arguments[0];
            const importName = cmdParams.arguments[1];
            const callingFile = cmdParams.arguments[2];

            const service = this._createTypeStubService(callingFile);

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
                        service.writeTypeStub(token);
                        service.dispose();
                        const infoMessage = `Type stub was successfully created for '${importName}'.`;
                        this._ls.window.showInformationMessage(infoMessage);
                        this._handlePostCreateTypeStub();
                    } catch (err) {
                        let errMessage = '';
                        if (err instanceof Error) {
                            errMessage = ': ' + err.message;
                        }
                        errMessage = `An error occurred when creating type stub for '${importName}'` + errMessage;
                        this._ls.console.error(errMessage);
                        this._ls.window.showErrorMessage(errMessage);
                    }
                }
            });

            const serverSettings = await this._ls.getSettings(workspace);
            AnalyzerServiceExecutor.runWithOptions(this._ls.rootPath, workspace, serverSettings, importName);
            return;
        }
    }

    // Creates a service instance that's used for creating type
    // stubs for a specified target library.
    private _createTypeStubService(callingFile?: string): AnalyzerService {
        const service = this._createAnalyzerService(callingFile);

        service.setMaxAnalysisDuration({
            openFilesTimeInMs: 500,
            noOpenFilesTimeInMs: 500
        });

        return service;
    }

    private _createAnalyzerService(callingFile: string | undefined) {
        this._ls.console.log('Starting type stub service instance');

        if (callingFile) {
            // this should let us to inherit all execution env of the calling file
            // if it is invoked from IDE through code action
            const workspace = this._ls.getWorkspaceForFile(callingFile);
            return workspace.serviceInstance.clone('Type stub');
        }

        return new AnalyzerService('Type stub', this._ls.fs, this._ls.console);
    }

    private _handlePostCreateTypeStub() {
        this._ls.reanalyze();
    }
}
