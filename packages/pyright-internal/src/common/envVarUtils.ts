import * as os from 'os';

import {
    combinePaths,
    ensureTrailingDirectorySeparator,
    getPathComponents,
    hasTrailingDirectorySeparator,
} from './pathUtils';

/*
 * envVarUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Utils functions that handles environment variables.
 */

// Expands certain predefined variables supported within VS Code settings.
// Ideally, VS Code would provide an API for doing this expansion, but
// it doesn't. We'll handle the most common variables here as a convenience.
export function expandPathVariables(rootPath: string, path: string): string {
    const pathParts = getPathComponents(path);

    const expandedParts: string[] = [];
    for (const part of pathParts) {
        const trimmedPart = part.trim();

        if (trimmedPart === '${workspaceFolder}') {
            expandedParts.push(rootPath);
        } else if (trimmedPart === '${env:HOME}' && process.env.HOME !== undefined) {
            expandedParts.push(process.env.HOME);
        } else if (trimmedPart === '${env:USERNAME}' && process.env.USERNAME !== undefined) {
            expandedParts.push(process.env.USERNAME);
        } else if (trimmedPart === '${env:VIRTUAL_ENV}' && process.env.VIRTUAL_ENV !== undefined) {
            expandedParts.push(process.env.VIRTUAL_ENV);
        } else if (trimmedPart === '~' && os.homedir) {
            expandedParts.push(os.homedir() || process.env.HOME || process.env.USERPROFILE || '~');
        } else {
            expandedParts.push(part);
        }
    }

    if (expandedParts.length === 0) {
        return path;
    }

    const root = expandedParts.shift()!;
    const expandedPath = combinePaths(root, ...expandedParts);
    return hasTrailingDirectorySeparator(path) ? ensureTrailingDirectorySeparator(expandedPath) : expandedPath;
}
