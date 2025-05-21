/*
 * docRange.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Specifies the range of text within a document.
 */

import { Range } from './textRange';
import { Uri } from './uri/uri';

export interface DocumentRange {
    uri: Uri;
    range: Range;
}
