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

// Resolves a settings-provided path against the workspace, expanding VS Code variables
// (e.g. `${workspaceFolder}`) and returning the result as a string.
//
// The result is a string (rather than a `Uri`) because settings such as `extraPaths` support
// glob patterns: wildcard characters (`*`, `**`, `?`) survive verbatim in a string, whereas a
// `Uri` percent-encodes them (e.g. `*` becomes `%2A`) and obscures the glob.
// `resolvePathWithEnvVariables` is a thin `Uri`-returning wrapper over this function.
export function resolvePathStringWithEnvVariables(
    workspace: Workspace,
    path: string,
    workspaces: Workspace[]
): string | undefined {
    const rootUri = workspace.rootUri;

    const expanded = expandPathVariables(path, rootUri ?? Uri.empty(), workspaces);

    // If the path expanded to a full URI, no root resolution is needed. Normalize to forward
    // slashes so a URI string with backslashes (e.g. `vscode-vfs://host/a\b`) parses to the same
    // `Uri` the wrapper produced before this function was split out.
    if (Uri.maybeUri(expanded)) {
        return normalizeSlashes(expanded, '/');
    }

    // Expansion may have failed.
    if (expanded.includes('${')) {
        return undefined;
    }

    if (rootUri) {
        // Resolve the (relative or absolute) path against the workspace root through the root
        // `Uri` so the root's scheme is honored, then render it back to a string:
        //   - file/empty scheme: the plain file path, so wildcard characters survive verbatim
        //     (a URI string would percent-encode `*` as `%2A`).
        //   - other schemes (e.g. vscode-vfs): the URI string, so the scheme is preserved (glob
        //     expansion isn't supported off the local filesystem anyway).
        // Slash normalization is intentionally left to consumers: every consumer turns this string
        // back into a `Uri` (via `resolvePaths`/`Uri.file`/`Uri.parse`), which normalizes, so
        // normalizing here would be redundant.
        const resolved = rootUri.resolvePaths(expanded);
        return resolved.scheme === '' || resolved.scheme === 'file' ? resolved.getFilePath() : resolved.toString();
    }

    // We don't have a workspace root, but the path requires one.
    if (path.includes('${workspaceFolder')) {
        return undefined;
    }

    // Without a workspace root, we can only handle an absolute path. `isRootedDiskPath` is
    // sensitive to the platform separator (`getRootLength` uses `path.sep`), so normalize for the
    // check only; the returned string stays as-is (consumers normalize when they build a `Uri`).
    if (!isRootedDiskPath(normalizeSlashes(expanded))) {
        return undefined;
    }

    return expanded;
}

// Resolves a settings-provided path against the workspace as a `Uri`. Thin wrapper over
// `resolvePathStringWithEnvVariables`; see it for the resolution rules.
export function resolvePathWithEnvVariables(
    workspace: Workspace,
    path: string,
    workspaces: Workspace[]
): Uri | undefined {
    const resolved = resolvePathStringWithEnvVariables(workspace, path, workspaces);
    if (resolved === undefined) {
        return undefined;
    }

    const caseDetector = workspace.service.serviceProvider.get(ServiceKeys.caseSensitivityDetector);
    // A URI string (a full URI, or a non-file scheme rendered above) is parsed back into its
    // `Uri`; a plain path becomes a file `Uri`.
    return Uri.maybeUri(resolved) ? Uri.parse(resolved, caseDetector) : Uri.file(resolved, caseDetector);
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
