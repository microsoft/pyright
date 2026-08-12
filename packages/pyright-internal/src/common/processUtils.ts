/*
 * processUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Utility routines for dealing with node processes.
 */
import * as child_process from 'child_process';

export function terminateProcessTree(pid: number) {
    try {
        if (process.platform === 'win32') {
            // Windows doesn't support SIGTERM, so execute taskkill to kill the process
            child_process.execSync(`taskkill /pid ${pid} /T /F > NUL 2>&1`);
        } else {
            // Send SIGTERM to the process and all its children
            process.kill(pid, 'SIGTERM');
        }
    } catch {
        // Ignore.
    }
}

// Accepts both Node's ChildProcess and the host abstraction's SpawnedProcess
// (both expose `pid` and `exitCode`), so callers routing through a Host don't
// need to cast back to a concrete child-process type.
export function terminateChild(child: { readonly pid?: number; readonly exitCode: number | null }) {
    try {
        if (child.pid && child.exitCode === null) {
            terminateProcessTree(child.pid);
        }
    } catch {
        // Ignore.
    }
}
