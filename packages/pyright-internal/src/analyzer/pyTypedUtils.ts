/*
 * pyTypedUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Parser for py.typed files.
 */

import { FileSystem } from '../common/fileSystem';
import { combinePaths, isDirectory, isFile } from '../common/pathUtils';

export interface PyTypedInfo {
    isPyTypedPresent: boolean;
    pyTypedPath: string | undefined;
    isPartiallyTyped: boolean;
}

const _pyTypedFileName = 'py.typed';

export function getPyTypedInfo(fileSystem: FileSystem, dirPath: string): PyTypedInfo {
    let isPyTypedPresent = false;
    let isPartiallyTyped = false;
    let pyTypedPath: string | undefined;
    const publicModules: string[] = [];

    if (fileSystem.existsSync(dirPath) && isDirectory(fileSystem, dirPath)) {
        pyTypedPath = combinePaths(dirPath, _pyTypedFileName);

        if (fileSystem.existsSync(dirPath) && isFile(fileSystem, pyTypedPath)) {
            isPyTypedPresent = true;

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
        }
    }

    return {
        isPyTypedPresent,
        pyTypedPath: isPyTypedPresent ? pyTypedPath : undefined,
        isPartiallyTyped,
    };
}
