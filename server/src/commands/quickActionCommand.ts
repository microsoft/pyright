/*
 * quickActionCommand.ts
 *
 * Implements command that maps to a quick action.
 */

import { CancellationToken, ExecuteCommandParams, TextEdit } from 'vscode-languageserver';

import { convertUriToPath } from '../common/pathUtils';
import { LanguageServerInterface } from '../languageServerBase';
import { ServerCommand } from './commandController';
import { Commands } from './commands';

export class QuickActionCommand implements ServerCommand {
    constructor(private _ls: LanguageServerInterface) {}

    async execute(params: ExecuteCommandParams, token: CancellationToken): Promise<any> {
        if (params.arguments && params.arguments.length >= 1) {
            const docUri = params.arguments[0];
            const otherArgs = params.arguments.slice(1);
            const filePath = convertUriToPath(docUri);
            const workspace = this._ls.getWorkspaceForFile(filePath);

            if (params.command === Commands.orderImports && workspace.disableOrganizeImports) {
                return [];
            }

            const editActions = workspace.serviceInstance.performQuickAction(
                filePath,
                params.command,
                otherArgs,
                token
            );
            if (!editActions) {
                return [];
            }

            const edits: TextEdit[] = [];
            editActions.forEach((editAction) => {
                edits.push({
                    range: editAction.range,
                    newText: editAction.replacementText,
                });
            });

            return edits;
        }
    }
}
