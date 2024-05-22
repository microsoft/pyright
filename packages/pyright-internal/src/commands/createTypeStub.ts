/*
 * createTypeStub.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Implements 'create stub' command functionality.
 */

import { CancellationToken, ExecuteCommandParams } from 'vscode-languageserver';

import { OperationCanceledException } from '../common/cancellationUtils';
import { LanguageServerBaseInterface, LanguageServerInterface } from '../common/languageServerInterface';
import { AnalyzerServiceExecutor } from '../languageService/analyzerServiceExecutor';
import { ServerCommand } from './commandController';
import { Uri } from '../common/uri/uri';
import { Workspace } from '../workspaceFactory';

export class CreateTypeStubCommand implements ServerCommand {
    constructor(private _ls: LanguageServerInterface) {
        // Empty
    }

    async execute(cmdParams: ExecuteCommandParams, token: CancellationToken): Promise<any> {
        if (!cmdParams.arguments || cmdParams.arguments.length < 2) {
            return undefined;
        }

        const workspaceRoot = Uri.parse(cmdParams.arguments[0] as string, this._ls.serviceProvider);
        const importName = cmdParams.arguments[1] as string;
        const callingFile = Uri.parse(cmdParams.arguments[2] as string, this._ls.serviceProvider);

        const workspace = await this._ls.getWorkspaceForFile(callingFile ?? workspaceRoot);
        return await new TypeStubCreator(this._ls).create(workspace, importName, token);
    }
}

export class TypeStubCreator {
    constructor(private _ls: LanguageServerBaseInterface) {}

    async create(workspace: Workspace, importName: string, token: CancellationToken): Promise<any> {
        const service = await AnalyzerServiceExecutor.cloneService(this._ls, workspace, {
            typeStubTargetImportName: importName,
            useBackgroundAnalysis: true,
        });

        try {
            await service.writeTypeStubInBackground(token);
            service.dispose();

            const infoMessage = `Type stub was successfully created for '${importName}'.`;
            this._ls.window.showInformationMessage(infoMessage);

            // This is called after a new type stub has been created. It allows
            // us to invalidate caches and force reanalysis of files that potentially
            // are affected by the appearance of a new type stub.
            this._ls.reanalyze();
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
