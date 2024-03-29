/*
 * quickActionCommand.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Implements command that maps to a quick action.
 */

import { CancellationToken, ExecuteCommandParams } from 'vscode-languageserver';

import { convertToFileTextEdits, convertToWorkspaceEdit } from '../common/workspaceEditUtils';
import { LanguageServerInterface } from '../common/languageServerInterface';
import { performQuickAction } from '../languageService/quickActions';
import { ServerCommand } from './commandController';
import { Commands } from './commands';
import { Uri } from '../common/uri/uri';

export class QuickActionCommand implements ServerCommand {
    constructor(private _ls: LanguageServerInterface) {}

    async execute(params: ExecuteCommandParams, token: CancellationToken): Promise<any> {
        if (params.arguments && params.arguments.length >= 1) {
            const docUri = Uri.parse(params.arguments[0] as string, this._ls.serviceProvider);
            const otherArgs = params.arguments.slice(1);
            const workspace = await this._ls.getWorkspaceForFile(docUri);

            if (params.command === Commands.orderImports && workspace.disableOrganizeImports) {
                return [];
            }

            const editActions = workspace.service.run((p) => {
                return performQuickAction(p, docUri, params.command, otherArgs, token);
            }, token);

            return convertToWorkspaceEdit(workspace.service.fs, convertToFileTextEdits(docUri, editActions ?? []));
        }
    }
}
