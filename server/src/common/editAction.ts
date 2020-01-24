/*
* editAction.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Represents a single edit within a file.
*/

import { LineAndColumnRange } from "./textRange";

export interface TextEditAction {
    range: LineAndColumnRange;
    replacementText: string;
}

export interface FileEditAction extends TextEditAction {
    filePath: string;
}
