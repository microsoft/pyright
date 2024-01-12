/*
 * quickActionCommand.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Implements command that maps to a quick action.
 */

import { CancellationToken, ExecuteCommandParams } from 'vscode-languageserver';

import { Uri } from '../common/uri/uri';
import { convertToFileTextEdits, convertToWorkspaceEdit } from '../common/workspaceEditUtils';
import { LanguageServerInterface } from '../languageServerBase';
import { performQuickAction } from '../languageService/quickActions';
import { ServerCommand } from './commandController';
import { Commands } from './commands';

export class QuickActionCommand implements ServerCommand {
    constructor(private _ls: LanguageServerInterface) {}

    async execute(params: ExecuteCommandParams, token: CancellationToken): Promise<any> {
        if (params.arguments && params.arguments.length >= 1) {
            const docUri = Uri.parse(params.arguments[0] as string, this._ls.rootUri.isCaseSensitive);
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
