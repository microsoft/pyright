/*
 * commandController.ts
 *
 * Implements language server commands execution functionality.
 */

import { ExecuteCommandParams, ResponseError } from 'vscode-languageserver';
import { LanguageServerBase } from '../languageServerBase';
import { CommandId } from './commands';
import { CreateTypeStubCommand } from './createTypeStub';
import { QuickActionCommand } from './quickActionCommand';

export interface ServerCommand {
    execute(cmdParams: ExecuteCommandParams): Promise<any>;
}

export class CommandController implements ServerCommand {
    private _createStub: CreateTypeStubCommand;
    private _quickAction: QuickActionCommand;

    constructor(ls: LanguageServerBase) {
        this._createStub = new CreateTypeStubCommand(ls);
        this._quickAction = new QuickActionCommand(ls);
    }

    async execute(cmdParams: ExecuteCommandParams): Promise<any> {
        if (cmdParams.command === CommandId.orderImports || cmdParams.command === CommandId.addMissingOptionalToParam) {
            return this._quickAction.execute(cmdParams);
        }
        if (cmdParams.command === CommandId.createTypeStub) {
            return this._createStub.execute(cmdParams);
        }
        return new ResponseError<string>(1, 'Unsupported command');
    }
}
