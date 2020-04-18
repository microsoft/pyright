/*
 * commandController.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Implements language server commands execution functionality.
 */

import { CancellationToken, ExecuteCommandParams, ResponseError } from 'vscode-languageserver';

import { LanguageServerInterface } from '../languageServerBase';
import { Commands } from './commands';
import { CreateTypeStubCommand } from './createTypeStub';
import { QuickActionCommand } from './quickActionCommand';
import { RestartServerCommand } from './restartServer';

export interface ServerCommand {
    execute(cmdParams: ExecuteCommandParams, token: CancellationToken): Promise<any>;
}

export class CommandController implements ServerCommand {
    private _createStub: CreateTypeStubCommand;
    private _restartServer: RestartServerCommand;
    private _quickAction: QuickActionCommand;

    constructor(ls: LanguageServerInterface) {
        this._createStub = new CreateTypeStubCommand(ls);
        this._restartServer = new RestartServerCommand(ls);
        this._quickAction = new QuickActionCommand(ls);
    }

    async execute(cmdParams: ExecuteCommandParams, token: CancellationToken): Promise<any> {
        switch (cmdParams.command) {
            case Commands.orderImports:
            case Commands.addMissingOptionalToParam: {
                return this._quickAction.execute(cmdParams, token);
            }

            case Commands.createTypeStub: {
                return this._createStub.execute(cmdParams, token);
            }

            case Commands.restartServer: {
                return this._restartServer.execute(cmdParams);
            }

            default: {
                return new ResponseError<string>(1, 'Unsupported command');
            }
        }
    }
}
