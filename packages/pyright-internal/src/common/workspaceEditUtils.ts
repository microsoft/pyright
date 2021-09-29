/*
 * workspaceEditUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Convert Pyright's FileEditActions to LanguageServer's WorkspaceEdits.
 */

import { ChangeAnnotation, TextDocumentEdit, WorkspaceEdit } from 'vscode-languageserver';

import { FileEditAction } from '../common/editAction';
import { convertPathToUri } from '../common/pathUtils';
import { createMapFromItems } from './collectionUtils';
import { FileSystem } from './fileSystem';

export function convertWorkspaceEdits(fs: FileSystem, edits: FileEditAction[]) {
    const workspaceEdits: WorkspaceEdit = {
        changes: {},
    };

    edits.forEach((edit) => {
        const uri = convertPathToUri(fs, edit.filePath);
        workspaceEdits.changes![uri] = workspaceEdits.changes![uri] || [];
        workspaceEdits.changes![uri].push({ range: edit.range, newText: edit.replacementText });
    });

    return workspaceEdits;
}

export function convertWorkspaceDocumentEdits(
    fs: FileSystem,
    edits: FileEditAction[],
    changeAnnotations?: {
        [id: string]: ChangeAnnotation;
    },
    defaultAnnotationId = 'default'
) {
    const workspaceEdits: WorkspaceEdit = {
        documentChanges: [],
        changeAnnotations: changeAnnotations,
    };

    const mapPerFile = createMapFromItems(edits, (e) => e.filePath);
    for (const [key, value] of mapPerFile) {
        workspaceEdits.documentChanges!.push(
            TextDocumentEdit.create({ uri: convertPathToUri(fs, key), version: null }, [
                ...value.map((v) => ({
                    range: v.range,
                    newText: v.replacementText,
                    annotationId: defaultAnnotationId,
                })),
            ])
        );
    }

    return workspaceEdits;
}
