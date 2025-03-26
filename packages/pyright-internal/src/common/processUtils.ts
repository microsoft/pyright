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

export function terminateChild(child: child_process.ChildProcess) {
    try {
        if (child.pid && child.exitCode === null) {
            terminateProcessTree(child.pid);
        }
    } catch {
        // Ignore.
    }
}
