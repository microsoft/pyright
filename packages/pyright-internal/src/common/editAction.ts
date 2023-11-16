/*
 * editAction.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Represents a single edit within a file.
 */

import { Range, rangesAreEqual } from './textRange';
import { Uri } from './uri/uri';

export interface TextEditAction {
    range: Range;
    replacementText: string;
}

export interface FileEditAction extends TextEditAction {
    fileUri: Uri;
}

export interface FileEditActions {
    edits: FileEditAction[];
    fileOperations: FileOperations[];
}

export type FileOperations = RenameFileOperation | CreateFileOperation | DeleteFileOperation;

export interface FileOperation {
    kind: 'create' | 'delete' | 'rename';
}

export interface RenameFileOperation extends FileOperation {
    kind: 'rename';
    oldFileUri: Uri;
    newFileUri: Uri;
}

export interface CreateFileOperation extends FileOperation {
    kind: 'create';
    fileUri: Uri;
}

export interface DeleteFileOperation extends FileOperation {
    kind: 'delete';
    fileUri: Uri;
}

export namespace TextEditAction {
    export function is(value: any): value is TextEditAction {
        return !!value.range && value.replacementText !== undefined;
    }
}

export namespace FileEditAction {
    export function is(value: any): value is FileEditAction {
        return value.fileUri !== undefined && TextEditAction.is(value);
    }

    export function areEqual(e1: FileEditAction, e2: FileEditAction) {
        return (
            e1 === e2 ||
            (e1.fileUri.equals(e2.fileUri) &&
                rangesAreEqual(e1.range, e2.range) &&
                e1.replacementText === e2.replacementText)
        );
    }
}
