/*
 * commandResult.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * wrapper for returning custom command data
 */

import { WorkspaceEdit } from 'vscode-languageserver-types';

export interface CommandResult {
    data?: any;
    edits: WorkspaceEdit;
}

export namespace CommandResult {
    export function is(value: any): value is CommandResult {
        return value && value.edits && WorkspaceEdit.is(value.edits);
    }
}
