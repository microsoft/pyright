/*
 * host.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Provides access to the host environment the language service is running on.
 */

import { CancellationToken } from 'vscode-languageserver';

import { ImportLogger } from '../analyzer/importLogger';
import { PythonPathResult } from '../analyzer/pythonPathUtils';
import { PythonPlatform } from './configOptions';
import { PythonVersion } from './pythonVersion';
import { Uri } from './uri/uri';

export const enum HostKind {
    FullAccess,
    LimitedAccess,
    NoAccess,
}

export interface ScriptOutput {
    stdout: string;
    stderr: string;

    // Optional output that contains both stdout and stderr interleaved in choronological order.
    output?: string;
    exitCode?: number;
}

export interface Host {
    readonly kind: HostKind;
    getPythonSearchPaths(pythonPath?: Uri, failureLogger?: ImportLogger): PythonPathResult;
    getPythonVersion(pythonPath?: Uri, failureLogger?: ImportLogger): PythonVersion | undefined;
    getPythonPlatform(failureLogger?: ImportLogger): PythonPlatform | undefined;
    runScript(
        pythonPath: Uri | undefined,
        script: Uri,
        args: string[],
        cwd: Uri,
        token: CancellationToken
    ): Promise<ScriptOutput>;
    runSnippet(
        pythonPath: Uri | undefined,
        code: string,
        args: string[],
        cwd: Uri,
        token: CancellationToken,
        forceIsolated?: boolean
    ): Promise<ScriptOutput>;
}

export class NoAccessHost implements Host {
    get kind(): HostKind {
        return HostKind.NoAccess;
    }

    getPythonSearchPaths(pythonPath?: Uri, failureLogger?: ImportLogger): PythonPathResult {
        failureLogger?.log('No access to python executable.');

        return {
            paths: [],
            prefix: undefined,
        };
    }

    getPythonVersion(pythonPath?: Uri, failureLogger?: ImportLogger): PythonVersion | undefined {
        return undefined;
    }

    getPythonPlatform(failureLogger?: ImportLogger): PythonPlatform | undefined {
        return undefined;
    }

    async runScript(
        pythonPath: Uri | undefined,
        scriptPath: Uri,
        args: string[],
        cwd: Uri,
        token: CancellationToken
    ): Promise<ScriptOutput> {
        return { stdout: '', stderr: '' };
    }

    async runSnippet(
        pythonPath: Uri | undefined,
        code: string,
        args: string[],
        cwd: Uri,
        token: CancellationToken
    ): Promise<ScriptOutput> {
        return { stdout: '', stderr: '' };
    }
}

export type HostFactory = () => Host;
