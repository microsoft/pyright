/*
 * createTypeStub.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Implements 'create stub' command functionality.
 */

import { CancellationToken, ExecuteCommandParams } from 'vscode-languageserver';

import { OperationCanceledException, throwIfCancellationRequested } from '../common/cancellationUtils';
import { LanguageServerBaseInterface, LanguageServerInterface } from '../common/languageServerInterface';
import { AnalyzerServiceExecutor } from '../languageService/analyzerServiceExecutor';
import { runTypeStubGeneration } from '../analyzer/typeStubGeneration';
import {
    getTypeStubCancellationMessage,
    getTypeStubErrorPrefix,
    getTypeStubSuccessMessage,
} from '../analyzer/typeStubMessages';
import { writeGeneratedTypeStubFiles } from '../analyzer/typeStubOutput';
import { ServerCommand } from './commandController';
import { Uri } from '../common/uri/uri';
import { Workspace } from '../workspaceFactory';

abstract class BaseCreateTypeStubCommand {
    constructor(protected readonly ls: LanguageServerBaseInterface) {
        // Empty
    }

    protected async createTypeStub(
        workspace: Workspace,
        importName: string,
        sourceFileUri: Uri | undefined,
        token: CancellationToken
    ): Promise<any> {
        throwIfCancellationRequested(token);

        try {
            await runTypeStubGeneration(
                () =>
                    AnalyzerServiceExecutor.cloneService(this.ls, workspace, {
                        useBackgroundAnalysis: true,
                    }),
                { kind: 'full', importName, sourceFileUri },
                (service, result) => writeGeneratedTypeStubFiles(service.fs, result.files),
                token
            );

            this.ls.window.showInformationMessage(this.getSuccessMessage(importName));

            // This is called after a new type stub has been created. It allows
            // us to invalidate caches and force reanalysis of files that potentially
            // are affected by the appearance of a new type stub.
            this.ls.reanalyze();
        } catch (err) {
            const isCancellation = OperationCanceledException.is(err);
            if (isCancellation) {
                const errMessage = this.getCancellationMessage(importName);
                this.ls.console.error(errMessage);
            } else {
                let errMessage = '';
                if (err instanceof Error) {
                    errMessage = ': ' + err.message;
                }
                errMessage = this.getErrorPrefix(importName) + errMessage;
                this.ls.console.error(errMessage);
                this.ls.window.showErrorMessage(errMessage);
            }
        }
    }

    protected getSuccessMessage(importName: string): string {
        return getTypeStubSuccessMessage('full', importName);
    }

    protected getCancellationMessage(importName: string): string {
        return getTypeStubCancellationMessage('full', importName);
    }

    protected getErrorPrefix(importName: string): string {
        return getTypeStubErrorPrefix('full', importName);
    }
}

export class CreateTypeStubCommand extends BaseCreateTypeStubCommand implements ServerCommand {
    constructor(ls: LanguageServerInterface) {
        super(ls);
    }

    async execute(cmdParams: ExecuteCommandParams, token: CancellationToken): Promise<any> {
        if (!cmdParams.arguments || cmdParams.arguments.length < 2) {
            return undefined;
        }

        const workspaceRoot = Uri.parse(cmdParams.arguments[0] as string, this.ls.serviceProvider);
        const importName = cmdParams.arguments[1] as string;
        const callingFileArg = cmdParams.arguments[2] as string | undefined;
        const callingFile = callingFileArg ? Uri.parse(callingFileArg, this.ls.serviceProvider) : undefined;

        const workspace = await (this.ls as LanguageServerInterface).getWorkspaceForFile(callingFile ?? workspaceRoot);
        return await this.createTypeStub(workspace, importName, callingFile, token);
    }
}
