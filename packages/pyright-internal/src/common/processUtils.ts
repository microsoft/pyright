/*
 * processUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Utility routines for dealing with node processes.
 */
import * as child_process from 'child_process';

import { getWindowsProcessTreeTerminationScript, windowsProcessTreePowerShellArgs } from './windowsProcessTree';

/** @deprecated Retain the spawned child and use terminateChild; a PID alone does not prove ownership. */
export function terminateProcessTree(pid: number) {
    try {
        if (!Number.isSafeInteger(pid) || pid <= 0) {
            return;
        }
        if (process.platform === 'win32') {
            child_process.execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
                stdio: 'ignore',
                windowsHide: true,
            });
        } else {
            process.kill(pid, 'SIGTERM');
        }
    } catch {
        // Ignore.
    }
}

// Host abstractions can supply their own owned kill handle without exposing Node internals.
export function terminateChild(
    child: {
        readonly pid?: number;
        readonly exitCode: number | null;
        readonly signalCode?: string | null;
        kill?(signal?: NodeJS.Signals | number): void;
    },
    signal: NodeJS.Signals = 'SIGTERM'
) {
    if (
        !child.pid ||
        !Number.isSafeInteger(child.pid) ||
        child.pid <= 0 ||
        child.exitCode !== null ||
        child.signalCode
    ) {
        return;
    }

    if (typeof child_process.ChildProcess === 'function' && child instanceof child_process.ChildProcess) {
        const handle: unknown = Reflect.get(child, '_handle');
        if (!handle) {
            return;
        }
        if (process.platform === 'win32') {
            // Root and descendant identities remain pinned throughout native cleanup.
            // Surface failure: callers must not forget an incompletely stopped tree.
            try {
                child_process.execFileSync('powershell.exe', windowsProcessTreePowerShellArgs, {
                    input: getWindowsProcessTreeTerminationScript(child.pid),
                    stdio: ['pipe', 'pipe', 'pipe'],
                    windowsHide: true,
                });
            } catch (error) {
                throw new ProcessTreeTerminationError(child, error);
            }
            return;
        }
    }

    try {
        // `killed` only records a successfully sent signal; it must not prevent escalation.
        child.kill?.(signal);
    } catch {
        // Ignore.
    }
}

export class ProcessTreeTerminationError extends Error {
    readonly child: child_process.ChildProcess;

    constructor(child: child_process.ChildProcess, error: unknown) {
        super(
            `Owned process-tree cleanup is incomplete for PID ${child.pid}: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
        this.name = 'ProcessTreeTerminationError';
        this.child = child;
        // Preserve retry ownership without exposing a circular ChildProcess in JSON error output.
        Object.defineProperty(this, 'child', { enumerable: false });
    }
}
