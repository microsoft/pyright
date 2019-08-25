/*
* editAction.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Represents a single edit within a file.
*/

import { DiagnosticTextRange } from './diagnostic';

export interface TextEditAction {
    range: DiagnosticTextRange;
    replacementText: string;
}

export interface FileEditAction extends TextEditAction {
    filePath: string;
}
