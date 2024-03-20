/*
 * commandController.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Implements language server commands execution functionality.
 */

import { CancellationToken, ExecuteCommandParams, ResponseError } from 'vscode-languageserver';

import { LanguageServerInterface } from '../common/languageServerInterface';
import { Commands } from './commands';
import { CreateTypeStubCommand } from './createTypeStub';
import { DumpFileDebugInfoCommand } from './dumpFileDebugInfoCommand';
import { QuickActionCommand } from './quickActionCommand';
import { RestartServerCommand } from './restartServer';

export interface ServerCommand {
    execute(cmdParams: ExecuteCommandParams, token: CancellationToken): Promise<any>;
}

export class CommandController implements ServerCommand {
    private _createStub: CreateTypeStubCommand;
    private _restartServer: RestartServerCommand;
    private _quickAction: QuickActionCommand;
    private _dumpFileDebugInfo: DumpFileDebugInfoCommand;

    constructor(ls: LanguageServerInterface) {
        this._createStub = new CreateTypeStubCommand(ls);
        this._restartServer = new RestartServerCommand(ls);
        this._quickAction = new QuickActionCommand(ls);
        this._dumpFileDebugInfo = new DumpFileDebugInfoCommand(ls);
    }

    async execute(cmdParams: ExecuteCommandParams, token: CancellationToken): Promise<any> {
        switch (cmdParams.command) {
            case Commands.orderImports: {
                return this._quickAction.execute(cmdParams, token);
            }

            case Commands.createTypeStub: {
                return this._createStub.execute(cmdParams, token);
            }

            case Commands.restartServer: {
                return this._restartServer.execute(cmdParams);
            }

            case Commands.dumpFileDebugInfo: {
                return this._dumpFileDebugInfo.execute(cmdParams, token);
            }

            default: {
                return new ResponseError<string>(1, 'Unsupported command');
            }
        }
    }

    isLongRunningCommand(command: string): boolean {
        switch (command) {
            case Commands.createTypeStub:
            case Commands.restartServer:
                return true;

            default:
                return false;
        }
    }

    isRefactoringCommand(command: string): boolean {
        return false;
    }
}
