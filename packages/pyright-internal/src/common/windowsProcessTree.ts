/*
 * windowsProcessTree.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Windows tree cleanup for roots whose creation ownership is already established.
 */

import definition from './windowsProcessTree.json';

// Keep the native implementation in a language-neutral asset so automation and
// restored-process owners can use the same selection rules, not another /T wrapper.
export const windowsProcessTreeScript = [
    "$ErrorActionPreference = 'Stop'",
    "if (-not ('PylanceOwnedWindowsProcess' -as [type])) {",
    "Add-Type -TypeDefinition @'",
    ...definition.native,
    "'@",
    '}',
    ...definition.functions,
].join('\n');

// Read the trusted script from stdin rather than hitting Windows' command-line
// length limit. Do not impose an external timeout that can bypass its resume/finally.
export const windowsProcessTreePowerShellArgs = [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '& ([ScriptBlock]::Create([Console]::In.ReadToEnd()))',
];

/** The caller must retain the actual spawned child's native handle throughout this synchronous script. */
export function getWindowsProcessTreeTerminationScript(pid: number): string {
    if (!Number.isSafeInteger(pid) || pid <= 0) {
        throw new Error('A live, owned child PID is required for Windows process-tree cleanup.');
    }
    return [
        windowsProcessTreeScript,
        `$root = [PylanceOwnedWindowsProcess]::Open(${pid})`,
        'try { Stop-OwnedWindowsProcessTree -Root $root } finally { $root.Dispose() }',
    ].join('\n');
}
