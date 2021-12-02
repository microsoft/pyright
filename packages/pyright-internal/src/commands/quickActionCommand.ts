/*
 * quickActionCommand.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Implements command that maps to a quick action.
 */

import { CancellationToken, ExecuteCommandParams } from 'vscode-languageserver';

import { convertTextEdits } from '../common/textEditUtils';
import { LanguageServerInterface } from '../languageServerBase';
import { ServerCommand } from './commandController';
import { Commands } from './commands';

export class QuickActionCommand implements ServerCommand {
    constructor(private _ls: LanguageServerInterface) {}

    async execute(params: ExecuteCommandParams, token: CancellationToken): Promise<any> {
        if (params.arguments && params.arguments.length >= 1) {
            const docUri = params.arguments[0];
            const otherArgs = params.arguments.slice(1);
            const filePath = this._ls.decodeTextDocumentUri(docUri);
            const workspace = await this._ls.getWorkspaceForFile(filePath);

            if (params.command === Commands.orderImports && workspace.disableOrganizeImports) {
                return [];
            }

            const editActions = workspace.serviceInstance.performQuickAction(
                filePath,
                params.command,
                otherArgs,
                token
            );

            return convertTextEdits(docUri, editActions);
        }
    }
}
