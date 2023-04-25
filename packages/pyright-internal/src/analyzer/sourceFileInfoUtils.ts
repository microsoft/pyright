/*
 * sourceFileInfoUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Functions that operate on SourceFileInfo objects.
 */

import { SourceFileInfo } from './program';

interface FileInfo {
    isTypeshedFile: boolean;
    isThirdPartyImport: boolean;
    isTracked: boolean;
}

export function isUserCode(fileInfo: FileInfo | undefined) {
    return !!fileInfo && fileInfo.isTracked && !fileInfo.isThirdPartyImport && !fileInfo.isTypeshedFile;
}

export function collectImportedByFiles(fileInfo: SourceFileInfo): Set<SourceFileInfo> {
    const importedByFiles = new Set<SourceFileInfo>();
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
