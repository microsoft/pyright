/*
 * createTypeStub.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Implements 'create stub' command functionality.
 */

import { CancellationToken, ExecuteCommandParams } from 'vscode-languageserver';

import { AnalyzerService } from '../analyzer/service';
import { OperationCanceledException } from '../common/cancellationUtils';
import { createDeferred } from '../common/deferred';
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

            const service = await this._createTypeStubService(callingFile);

            // Allocate a temporary pseudo-workspace to perform this job.
            const workspace: WorkspaceServiceInstance = {
                workspaceName: `Create Type Stub ${importName}`,
                rootPath: workspaceRoot,
                rootUri: convertPathToUri(workspaceRoot),
                serviceInstance: service,
                disableLanguageServices: true,
                disableOrganizeImports: true,
                isInitialized: createDeferred<boolean>(),
            };

            const serverSettings = await this._ls.getSettings(workspace);
            AnalyzerServiceExecutor.runWithOptions(this._ls.rootPath, workspace, serverSettings, importName, false);

            try {
                await service.writeTypeStubInBackground(token);
                service.dispose();
                const infoMessage = `Type stub was successfully created for '${importName}'.`;
                this._ls.window.showInformationMessage(infoMessage);
                this._handlePostCreateTypeStub();
            } catch (err) {
                const isCancellation = OperationCanceledException.is(err);
                if (isCancellation) {
                    const errMessage = `Type stub creation for '${importName}' was canceled`;
                    this._ls.console.error(errMessage);
                } else {
                    let errMessage = '';
                    if (err instanceof Error) {
                        errMessage = ': ' + err.message;
                    }
                    errMessage = `An error occurred when creating type stub for '${importName}'` + errMessage;
                    this._ls.console.error(errMessage);
                    this._ls.window.showErrorMessage(errMessage);
                }
            }
        }
    }

    // Creates a service instance that's used for creating type
    // stubs for a specified target library.
    private async _createTypeStubService(callingFile?: string): Promise<AnalyzerService> {
        return this._createAnalyzerService(callingFile);
    }

    private async _createAnalyzerService(callingFile: string | undefined) {
        this._ls.console.log('Starting type stub service instance');

        if (callingFile) {
            // this should let us to inherit all execution env of the calling file
            // if it is invoked from IDE through code action
            const workspace = await this._ls.getWorkspaceForFile(callingFile);

            // new service has its own background analysis running on its own thread
            // to not block main bg running background analysis
            return workspace.serviceInstance.clone('Type stub', this._ls.createBackgroundAnalysis());
        }

        return new AnalyzerService('Type stub', this._ls.fs, this._ls.console);
    }

    private _handlePostCreateTypeStub() {
        this._ls.reanalyze();
    }
}
