/*
 * envVarUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Utils functions that handles environment variables.
 */

import * as os from 'os';

import { Uri } from './uri';

// Expands certain predefined variables supported within VS Code settings.
// Ideally, VS Code would provide an API for doing this expansion, but
// it doesn't. We'll handle the most common variables here as a convenience.
export function expandPathVariables(rootPath: Uri, path: string): string {
    let pathStr = path;

    // Replace everything inline.
    pathStr = pathStr.replace(/\$\{workspaceFolder\}/g, rootPath.getPath());
    if (process.env.HOME !== undefined) {
        pathStr = pathStr.replace(/\$\{env:HOME\}/g, process.env.HOME || '');
    }
    if (process.env.USERNAME !== undefined) {
        pathStr = pathStr.replace(/\$\{env:USERNAME\}/g, process.env.USERNAME || '');
    }
    if (process.env.VIRTUAL_ENV !== undefined) {
        pathStr = pathStr.replace(/\$\{env:VIRTUAL_ENV\}/g, process.env.VIRTUAL_ENV || '');
    }
    if (os.homedir) {
        pathStr = pathStr.replace(/~/g, os.homedir() || process.env.HOME || process.env.USERPROFILE || '~');
    }

    return pathStr;
}
