/*
 * textEditUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Language server command execution functionality.
 */

import { TextEdit, WorkspaceEdit } from 'vscode-languageserver';

import { FileEditAction, TextEditAction } from '../common/editAction';
import { convertPathToUri } from '../common/pathUtils';

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

export function convertWorkspaceEdits(edits: FileEditAction[]) {
    const workspaceEdits: WorkspaceEdit = {
        changes: {},
    };

    edits.forEach((edit) => {
        const uri = convertPathToUri(edit.filePath);
        workspaceEdits.changes![uri] = workspaceEdits.changes![uri] || [];
        workspaceEdits.changes![uri].push({ range: edit.range, newText: edit.replacementText });
    });

    return workspaceEdits;
}
