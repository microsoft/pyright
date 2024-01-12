/*
 * host.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Provides access to the host environment the language service is running on.
 */

import { CancellationToken } from 'vscode-languageserver';

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
}

export interface Host {
    readonly kind: HostKind;
    getPythonSearchPaths(pythonPath?: Uri, logInfo?: string[]): PythonPathResult;
    getPythonVersion(pythonPath?: Uri, logInfo?: string[]): PythonVersion | undefined;
    getPythonPlatform(logInfo?: string[]): PythonPlatform | undefined;
    runScript(
        pythonPath: Uri | undefined,
        script: Uri,
        args: string[],
        cwd: Uri,
        token: CancellationToken
    ): Promise<ScriptOutput>;
}

export class NoAccessHost implements Host {
    get kind(): HostKind {
        return HostKind.NoAccess;
    }

    getPythonSearchPaths(pythonPath?: Uri, logInfo?: string[]): PythonPathResult {
        logInfo?.push('No access to python executable.');

        return {
            paths: [],
            prefix: undefined,
        };
    }

    getPythonVersion(pythonPath?: Uri, logInfo?: string[]): PythonVersion | undefined {
        return undefined;
    }

    getPythonPlatform(logInfo?: string[]): PythonPlatform | undefined {
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
}

export type HostFactory = () => Host;
