/*
 * envVarUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Utils functions that handles environment variables.
 */

import * as os from 'os';

import { Workspace } from '../workspaceFactory';
import { Uri } from './uri/uri';

// Expands certain predefined variables supported within VS Code settings.
// Ideally, VS Code would provide an API for doing this expansion, but
// it doesn't. We'll handle the most common variables here as a convenience.
export function expandPathVariables(path: string, rootPath: Uri, workspaces: Workspace[]): string {
    // Make sure the pathStr looks like a URI path.
    let pathStr = path.replace(/\\/g, '/');

    // Make sure all replacements look like URI paths too.
    const replace = (match: RegExp, replaceValue: string) => {
        pathStr = pathStr.replace(match, replaceValue.replace(/\\/g, '/'));
    };

    // Replace everything inline.
    pathStr = pathStr.replace(/\$\{workspaceFolder\}/g, rootPath.getPath());
    for (const workspace of workspaces) {
        const ws_regexp = RegExp(`\\$\\{workspaceFolder:${workspace.workspaceName}\\}`, 'g');
        pathStr = pathStr.replace(ws_regexp, workspace.rootUri.getPath());
    }
    if (process.env.HOME !== undefined) {
        replace(/\$\{env:HOME\}/g, process.env.HOME || '');
    }
    if (process.env.USERNAME !== undefined) {
        replace(/\$\{env:USERNAME\}/g, process.env.USERNAME || '');
    }
    if (process.env.VIRTUAL_ENV !== undefined) {
        replace(/\$\{env:VIRTUAL_ENV\}/g, process.env.VIRTUAL_ENV || '');
    }
    if (os.homedir) {
        replace(/\/~/g, os.homedir() || process.env.HOME || process.env.USERPROFILE || '~');
        replace(/^~/g, os.homedir() || process.env.HOME || process.env.USERPROFILE || '~');
    }

    return pathStr;
}
