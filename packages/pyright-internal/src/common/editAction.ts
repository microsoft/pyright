/*
 * editAction.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Represents a single edit within a file.
 */

import { Range } from './textRange';

export interface TextEditAction {
    range: Range;
    replacementText: string;
}

export interface FileEditAction extends TextEditAction {
    filePath: string;
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
    oldFilePath: string;
    newFilePath: string;
}

export interface CreateFileOperation extends FileOperation {
    kind: 'create';
    filePath: string;
}

export interface DeleteFileOperation extends FileOperation {
    kind: 'delete';
    filePath: string;
}
