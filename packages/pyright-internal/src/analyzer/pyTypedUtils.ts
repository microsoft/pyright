/*
 * pyTypedUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Parser for py.typed files.
 */

import { FileSystem } from '../common/fileSystem';
import { Uri } from '../common/uri/uri';
import { isDirectory, isFile } from '../common/uri/uriUtils';

export interface PyTypedInfo {
    pyTypedPath: Uri;
    isPartiallyTyped: boolean;
}

//
// Retrieves information about a py.typed file, if it exists, under the given path.
//
export function getPyTypedInfo(fileSystem: FileSystem, dirPath: Uri): PyTypedInfo | undefined {
    if (!fileSystem.existsSync(dirPath) || !isDirectory(fileSystem, dirPath)) {
        return undefined;
    }

    const pyTypedPath = dirPath.pytypedUri;
    if (!fileSystem.existsSync(pyTypedPath) || !isFile(fileSystem, pyTypedPath)) {
        return undefined;
    }

    return getPyTypedInfoForPyTypedFile(fileSystem, pyTypedPath);
}

//
// Retrieves information about a py.typed file. The pyTypedPath provided must be a valid path.
//
export function getPyTypedInfoForPyTypedFile(fileSystem: FileSystem, pyTypedPath: Uri) {
    // This function intentionally doesn't check whether the given py.typed path exists or not,
    // as filesystem access is expensive if done repeatedly.
    // The caller should verify the file's validity before calling this method and use a cache if possible
    // to avoid high filesystem access costs.
    let isPartiallyTyped = false;

    // Read the contents of the file as text.
    const fileStats = fileSystem.statSync(pyTypedPath);

    // Do a quick sanity check on the size before we attempt to read it. This
    // file should always be really small - typically zero bytes in length.
    if (fileStats.size > 0 && fileStats.size < 64 * 1024) {
        const pyTypedContents = fileSystem.readFileSync(pyTypedPath, 'utf8');

        // PEP 561 doesn't specify the format of "py.typed" in any detail other than
        // to say that "If a stub package is partial it MUST include partial\n in a top
        // level py.typed file."
        if (pyTypedContents.match(/partial\n/) || pyTypedContents.match(/partial\r\n/)) {
            isPartiallyTyped = true;
        }
    }

    return {
        pyTypedPath,
        isPartiallyTyped,
    };
}
