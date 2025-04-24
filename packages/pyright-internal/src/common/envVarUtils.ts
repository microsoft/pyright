/*
 * envVarUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Utils functions that handles environment variables.
 */

import * as os from 'os';

import { Workspace, WorkspaceFolder } from '../workspaceFactory';
import { Uri } from './uri/uri';
import { isRootedDiskPath, normalizeSlashes } from './pathUtils';
import { ServiceKeys } from './serviceKeys';
import { escapeRegExp } from './stringUtils';

export function resolvePathWithEnvVariables(
    workspace: Workspace,
    path: string,
    workspaces: Workspace[]
): Uri | undefined {
    const rootUri = workspace.rootUri;

    const expanded = expandPathVariables(path, rootUri ?? Uri.empty(), workspaces);
    const caseDetector = workspace.service.serviceProvider.get(ServiceKeys.caseSensitivityDetector);
    if (Uri.maybeUri(expanded)) {
        // If path is expanded to uri, no need to resolve it against the workspace root.
        return Uri.parse(normalizeSlashes(expanded, '/'), caseDetector);
    }

    // Expansion may have failed.
    if (expanded.includes('${')) {
        return undefined;
    }

    if (rootUri) {
        // normal case, resolve the path against workspace root.
        return rootUri.resolvePaths(normalizeSlashes(expanded, '/'));
    }

    // We don't have workspace root. but path contains something that require `workspace root`
    if (path.includes('${workspaceFolder')) {
        return undefined;
    }

    // Without workspace root, we can't handle any `relative path`.
    if (!isRootedDiskPath(normalizeSlashes(expanded))) {
        return undefined;
    }

    // We have absolute file path.
    return Uri.file(expanded, caseDetector);
}

// Expands certain predefined variables supported within VS Code settings.
// Ideally, VS Code would provide an API for doing this expansion, but
// it doesn't. We'll handle the most common variables here as a convenience.
export function expandPathVariables(path: string, rootPath: Uri, workspaces: WorkspaceFolder[]): string {
    // Make sure all replacements look like URI paths too.
    const replace = (match: RegExp, replaceValue: string) => {
        path = path.replace(match, replaceValue);
    };

    // Replace everything inline.
    path = path.replace(/\$\{workspaceFolder\}/g, rootPath.getPath());

    // this is for vscode multiroot workspace supports.
    // https://code.visualstudio.com/docs/editor/variables-reference#_variables-scoped-per-workspace-folder
    for (const workspace of workspaces) {
        if (!workspace.rootUri) {
            continue;
        }

        const escapedWorkspaceName = escapeRegExp(workspace.workspaceName);
        const ws_regexp = RegExp(`\\$\\{workspaceFolder:${escapedWorkspaceName}\\}`, 'g');
        path = path.replace(ws_regexp, workspace.rootUri.getPath());
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
        replace(/(?:^|\/)~(?=\/)/g, os.homedir() || process.env.HOME || process.env.USERPROFILE || '~');
    }

    return path;
}
