/*
 * workspaceEditUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Convert Pyright's FileEditActions to LanguageServer's WorkspaceEdits.
 */

import {
    ChangeAnnotation,
    CreateFile,
    DeleteFile,
    RenameFile,
    TextDocumentEdit,
    WorkspaceEdit,
} from 'vscode-languageserver';

import { FileEditAction, FileEditActions } from '../common/editAction';
import { convertPathToUri } from '../common/pathUtils';
import { createMapFromItems } from './collectionUtils';
import { assertNever } from './debug';
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
    editActions: FileEditActions,
    changeAnnotations?: {
        [id: string]: ChangeAnnotation;
    },
    defaultAnnotationId = 'default'
) {
    const workspaceEdit: WorkspaceEdit = {
        documentChanges: [],
        changeAnnotations: changeAnnotations,
    };

    const mapPerFile = createMapFromItems(editActions.edits, (e) => e.filePath);
    for (const [key, value] of mapPerFile) {
        workspaceEdit.documentChanges!.push(
            TextDocumentEdit.create({ uri: convertPathToUri(fs, key), version: null }, [
                ...value.map((v) => ({
                    range: v.range,
                    newText: v.replacementText,
                    annotationId: defaultAnnotationId,
                })),
            ])
        );
    }

    for (const operation of editActions.fileOperations) {
        switch (operation.kind) {
            case 'create':
                workspaceEdit.documentChanges!.push(
                    CreateFile.create(
                        convertPathToUri(fs, operation.filePath),
                        /* options */ undefined,
                        defaultAnnotationId
                    )
                );
                break;
            case 'rename':
                workspaceEdit.documentChanges!.push(
                    RenameFile.create(
                        convertPathToUri(fs, operation.oldFilePath),
                        convertPathToUri(fs, operation.newFilePath),
                        /* options */ undefined,
                        defaultAnnotationId
                    )
                );
                break;
            case 'delete':
                workspaceEdit.documentChanges!.push(
                    DeleteFile.create(
                        convertPathToUri(fs, operation.filePath),
                        /* options */ undefined,
                        defaultAnnotationId
                    )
                );
                break;
            default:
                assertNever(operation);
        }
    }

    return workspaceEdit;
}
