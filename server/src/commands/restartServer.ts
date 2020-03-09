/*
 * restartServer.ts
 *
 * Implements 'restart server' command functionality.
 */

import { ExecuteCommandParams } from 'vscode-languageserver';

import { LanguageServerInterface } from '../languageServerBase';
import { ServerCommand } from './commandController';

export class RestartServerCommand implements ServerCommand {
    constructor(private _ls: LanguageServerInterface) {}

    async execute(cmdParams: ExecuteCommandParams): Promise<any> {
        this._ls.restart();
    }
}
