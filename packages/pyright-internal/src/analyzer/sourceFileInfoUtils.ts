/*
 * sourceFileInfoUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Collection of functions that operate on SourceFileInfo objects.
 */

import { SourceFileInfo } from './program';

export function isUserCode(fileInfo: SourceFileInfo | undefined) {
    return fileInfo && fileInfo.isTracked && !fileInfo.isThirdPartyImport && !fileInfo.isTypeshedFile;
}
