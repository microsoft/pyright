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
import { AnalyzerServiceExecutor, CloneOptions } from '../languageService/analyzerServiceExecutor';
import { AnalyzerService } from '../analyzer/service';
import { ServerCommand } from './commandController';
import { Uri } from '../common/uri/uri';
import { Workspace } from '../workspaceFactory';

abstract class BaseCreateTypeStubCommand {
    constructor(protected readonly ls: LanguageServerBaseInterface) {
        // Empty
    }

    protected async createTypeStub(workspace: Workspace, importName: string, token: CancellationToken): Promise<any> {
        const service = await AnalyzerServiceExecutor.cloneService(
            this.ls,
            workspace,
            await this.getCloneOptions(workspace, importName)
        );

        try {
            await this.writeTypeStub(service, workspace, importName, token);
            await this.onTypeStubCreated(workspace, importName);

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
        } finally {
            service.dispose();
        }
    }

    protected async getCloneOptions(_workspace: Workspace, importName: string): Promise<CloneOptions> {
        return {
            typeStubTargetImportName: importName,
            useBackgroundAnalysis: true,
        };
    }

    protected async onTypeStubCreated(_workspace: Workspace, _importName: string): Promise<void> {
        return;
    }

    protected async writeTypeStub(
        service: AnalyzerService,
        _workspace: Workspace,
        _importName: string,
        token: CancellationToken
    ): Promise<void> {
        const info = service.getTypeStubTargetInfo();
        // Delegate to BackgroundAnalysisProgram so stub generation runs in the
        // background worker when one is available, avoiding blocking the LS.
        await service.backgroundAnalysisProgram.writeTypeStub(
            info.targetImportPath,
            info.targetIsSingleFile,
            info.outputPath,
            token
        );
    }

    protected getSuccessMessage(importName: string): string {
        return `Type stub was successfully created for '${importName}'.`;
    }

    protected getCancellationMessage(importName: string): string {
        return `Type stub creation for '${importName}' was canceled`;
    }

    protected getErrorPrefix(importName: string): string {
        return `An error occurred when creating type stub for '${importName}'`;
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
        const callingFile = Uri.parse(cmdParams.arguments[2] as string, this.ls.serviceProvider);

        const workspace = await (this.ls as LanguageServerInterface).getWorkspaceForFile(callingFile ?? workspaceRoot);
        return await this.createTypeStub(workspace, importName, token);
    }
}
