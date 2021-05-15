/*
 * textEditUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Language server command execution functionality.
 */

import { TextEdit, WorkspaceEdit } from 'vscode-languageserver';

import { TextEditAction } from '../common/editAction';

export function convertTextEdits(uri: string, editActions: TextEditAction[] | undefined): WorkspaceEdit {
    if (!editActions) {
        return {};
    }

    const edits: TextEdit[] = [];
    editActions.forEach((editAction) => {
        edits.push({
            range: editAction.range,
            newText: editAction.replacementText,
        });
    });

    return {
        changes: {
            [uri]: edits,
        },
    };
}
