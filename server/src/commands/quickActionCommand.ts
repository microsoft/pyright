/*
 * createTypeStub.ts
 *
 * Implements command that maps to a quick action.
 */

import { ExecuteCommandParams, TextEdit } from 'vscode-languageserver';

import { convertUriToPath } from '../common/pathUtils';
import { LanguageServerInterface } from '../languageServerBase';
import { ServerCommand } from './commandController';

export class QuickActionCommand implements ServerCommand {
    constructor(private _ls: LanguageServerInterface) { }

    async execute(cmdParams: ExecuteCommandParams): Promise<any> {
        if (cmdParams.arguments && cmdParams.arguments.length >= 1) {
            const docUri = cmdParams.arguments[0];
            const otherArgs = cmdParams.arguments.slice(1);
            const filePath = convertUriToPath(docUri);
            const workspace = this._ls.getWorkspaceForFile(filePath);
            const editActions = workspace.serviceInstance.performQuickAction(filePath, cmdParams.command, otherArgs);
            if (!editActions) {
                return [];
            }

            const edits: TextEdit[] = [];
            editActions.forEach(editAction => {
                edits.push({
                    range: editAction.range,
                    newText: editAction.replacementText
                });
            });

            return edits;
        }
    }
}
