/*
 * fullAccessHost.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Implementation of host where it is allowed to run external executables.
 */

import * as child_process from 'child_process';
import { CancellationToken } from 'vscode-languageserver';

import { PythonPathResult } from '../analyzer/pythonPathUtils';
import { OperationCanceledException, throwIfCancellationRequested } from './cancellationUtils';
import { PythonPlatform } from './configOptions';
import { assertNever } from './debug';
import { FileSystem } from './fileSystem';
import { HostKind, NoAccessHost, ScriptOutput } from './host';
import { isDirectory, normalizePath } from './pathUtils';
import { PythonVersion, versionFromMajorMinor } from './pythonVersion';

// preventLocalImports removes the working directory from sys.path.
// The -c flag adds it automatically, which can allow some stdlib
// modules (like json) to be overridden by other files (like json.py).
const removeCwdFromSysPath = [
    'import os, os.path, sys',
    'normalize = lambda p: os.path.normcase(os.path.normpath(p))',
    'cwd = normalize(os.getcwd())',
    'orig_sys_path = [p for p in sys.path if p != ""]',
    'sys.path[:] = [p for p in sys.path if p != "" and normalize(p) != cwd]',
];

const extractSys = [
    ...removeCwdFromSysPath,
    'import sys, json',
    'json.dump(dict(path=orig_sys_path, prefix=sys.prefix), sys.stdout)',
].join('; ');

const extractVersion = [
    ...removeCwdFromSysPath,
    'import sys, json',
    'json.dump(dict(major=sys.version_info[0], minor=sys.version_info[1]), sys.stdout)',
].join('; ');

export class LimitedAccessHost extends NoAccessHost {
    override get kind(): HostKind {
        return HostKind.LimitedAccess;
    }

    override getPythonPlatform(logInfo?: string[]): PythonPlatform | undefined {
        if (process.platform === 'darwin') {
            return PythonPlatform.Darwin;
        } else if (process.platform === 'linux') {
            return PythonPlatform.Linux;
        } else if (process.platform === 'win32') {
            return PythonPlatform.Windows;
        }

        return undefined;
    }
}

export class FullAccessHost extends LimitedAccessHost {
    constructor(protected fs: FileSystem) {
        super();
    }

    override get kind(): HostKind {
        return HostKind.FullAccess;
    }

    static createHost(kind: HostKind, fs: FileSystem) {
        switch (kind) {
            case HostKind.NoAccess:
                return new NoAccessHost();
            case HostKind.LimitedAccess:
                return new LimitedAccessHost();
            case HostKind.FullAccess:
                return new FullAccessHost(fs);
            default:
                assertNever(kind);
        }
    }

    override getPythonSearchPaths(pythonPath?: string, logInfo?: string[]): PythonPathResult {
        const importFailureInfo = logInfo ?? [];
        let result = this._executePythonInterpreter(pythonPath, (p) =>
            this._getSearchPathResultFromInterpreter(this.fs, p, importFailureInfo)
        );

        if (!result) {
            result = {
                paths: [],
                prefix: '',
            };
        }

        importFailureInfo.push(`Received ${result.paths.length} paths from interpreter`);
        result.paths.forEach((path) => {
            importFailureInfo.push(`  ${path}`);
        });

        return result;
    }

    override getPythonVersion(pythonPath?: string, logInfo?: string[]): PythonVersion | undefined {
        const importFailureInfo = logInfo ?? [];

        try {
            const commandLineArgs: string[] = ['-c', extractVersion];
            const execOutput = this._executePythonInterpreter(pythonPath, (p) =>
                child_process.execFileSync(p, commandLineArgs, { encoding: 'utf8' })
            );

            const versionJson: { major: number; minor: number } = JSON.parse(execOutput!);
            const version = versionFromMajorMinor(versionJson.major, versionJson.minor);
            if (version === undefined) {
                importFailureInfo.push(
                    `Python version ${versionJson.major}.${versionJson.minor} from interpreter is unsupported`
                );
                return undefined;
            }

            return version;
        } catch {
            importFailureInfo.push('Unable to get Python version from interpreter');
            return undefined;
        }
    }

    override runScript(
        pythonPath: string | undefined,
        script: string,
        args: string[],
        cwd: string,
        token: CancellationToken
    ): Promise<ScriptOutput> {
        // If it is already cancelled, don't bother to run script.
        throwIfCancellationRequested(token);

        // What to do about conda here?
        return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
            let stdout = '';
            let stderr = '';
            const commandLineArgs = [script, ...args];

            const child = this._executePythonInterpreter(pythonPath, (p) =>
                child_process.spawn(p, commandLineArgs, { cwd })
            );
            const tokenWatch = token.onCancellationRequested(() => {
                if (child) {
                    try {
                        if (child.pid && child.exitCode === null) {
                            if (process.platform === 'win32') {
                                // Windows doesn't support SIGTERM, so execute taskkill to kill the process
                                child_process.execSync(`taskkill /pid ${child.pid} /T /F`);
                            } else {
                                process.kill(child.pid);
                            }
                        }
                    } catch {
                        // Ignore.
                    }
                }
                reject(new OperationCanceledException());
            });
            if (child) {
                child.stdout.on('data', (d) => (stdout = stdout.concat(d)));
                child.stderr.on('data', (d) => (stderr = stderr.concat(d)));
                child.on('error', (e) => {
                    tokenWatch.dispose();
                    reject(e);
                });
                child.on('exit', () => {
                    tokenWatch.dispose();
                    resolve({ stdout, stderr });
                });
            } else {
                tokenWatch.dispose();
                reject(new Error(`Cannot start python interpreter with script ${script}`));
            }
        });
    }

    private _executePythonInterpreter<T>(
        pythonPath: string | undefined,
        execute: (path: string) => T | undefined
    ): T | undefined {
        if (pythonPath) {
            return execute(pythonPath);
        } else {
            let result: T | undefined;
            try {
                // On non-Windows platforms, always default to python3 first. We want to
                // avoid this on Windows because it might invoke a script that displays
                // a dialog box indicating that python can be downloaded from the app store.
                if (process.platform !== 'win32') {
                    result = execute('python3');
                }
            } catch {
                // Ignore failure on python3
            }

            if (result !== undefined) {
                return result;
            }

            // On some platforms, 'python3' might not exist. Try 'python' instead.
            return execute('python');
        }
    }

    private _getSearchPathResultFromInterpreter(
        fs: FileSystem,
        interpreter: string,
        importFailureInfo: string[]
    ): PythonPathResult | undefined {
        const result: PythonPathResult = {
            paths: [],
            prefix: '',
        };

        try {
            const commandLineArgs: string[] = ['-c', extractSys];

            importFailureInfo.push(`Executing interpreter: '${interpreter}'`);
            const execOutput = child_process.execFileSync(interpreter, commandLineArgs, { encoding: 'utf8' });

            // Parse the execOutput. It should be a JSON-encoded array of paths.
            try {
                const execSplit = JSON.parse(execOutput);
                for (let execSplitEntry of execSplit.path) {
                    execSplitEntry = execSplitEntry.trim();
                    if (execSplitEntry) {
                        const normalizedPath = normalizePath(execSplitEntry);
                        // Skip non-existent paths and broken zips/eggs.
                        if (fs.existsSync(normalizedPath) && isDirectory(fs, normalizedPath)) {
                            result.paths.push(normalizedPath);
                        } else {
                            importFailureInfo.push(`Skipping '${normalizedPath}' because it is not a valid directory`);
                        }
                    }
                }

                result.prefix = execSplit.prefix;

                if (result.paths.length === 0) {
                    importFailureInfo.push(`Found no valid directories`);
                }
            } catch (err) {
                importFailureInfo.push(`Could not parse output: '${execOutput}'`);
                throw err;
            }
        } catch {
            return undefined;
        }

        return result;
    }
}
