/*
 * sourceFileInfoUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Functions that operate on SourceFileInfo objects.
 */

import { SourceFileInfo } from '../common/extensibility';

export function isUserCode(fileInfo: SourceFileInfo | undefined) {
    return !!fileInfo && fileInfo.isTracked && !fileInfo.isThirdPartyImport && !fileInfo.isTypeshedFile;
}

export function collectImportedByFiles<T extends SourceFileInfo>(fileInfo: T): Set<T> {
    const importedByFiles = new Set<T>();
    _collectImportedByFiles(fileInfo, importedByFiles);
    return importedByFiles;
}

function _collectImportedByFiles(fileInfo: SourceFileInfo, importedByFiles: Set<SourceFileInfo>) {
    fileInfo.importedBy.forEach((dep) => {
        if (importedByFiles.has(dep)) {
            // Already visited.
            return;
        }

        importedByFiles.add(dep);
        _collectImportedByFiles(dep, importedByFiles);
    });
}
