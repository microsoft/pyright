/*
 * fullAccessHost.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Implementation of host where it is allowed to run external executables.
 */

import * as child_process from 'child_process';
import { CancellationToken } from 'vscode-languageserver';

import { ImportLogger } from '../analyzer/importLogger';
import { PythonPathResult } from '../analyzer/pythonPathUtils';
import { OperationCanceledException, onCancellationRequested, throwIfCancellationRequested } from './cancellationUtils';
import { PythonPlatform } from './configOptions';
import { assertNever } from './debug';
import { HostKind, NoAccessHost, ScriptOutput } from './host';
import { getAnyExtensionFromPath, normalizePath } from './pathUtils';
import { terminateChild } from './processUtils';
import { PythonVersion } from './pythonVersion';
import { ServiceKeys } from './serviceKeys';
import { ServiceProvider } from './serviceProvider';
import { Uri } from './uri/uri';
import { isDirectory } from './uri/uriUtils';

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
    'json.dump(tuple(sys.version_info), sys.stdout)',
].join('; ');

export class LimitedAccessHost extends NoAccessHost {
    override get kind(): HostKind {
        return HostKind.LimitedAccess;
    }

    override getPythonPlatform(importLogger?: ImportLogger): PythonPlatform | undefined {
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
    constructor(protected serviceProvider: ServiceProvider) {
        super();
    }

    override get kind(): HostKind {
        return HostKind.FullAccess;
    }

    static createHost(kind: HostKind, serviceProvider: ServiceProvider) {
        switch (kind) {
            case HostKind.NoAccess:
                return new NoAccessHost();
            case HostKind.LimitedAccess:
                return new LimitedAccessHost();
            case HostKind.FullAccess:
                return new FullAccessHost(serviceProvider);
            default:
                assertNever(kind);
        }
    }

    override getPythonSearchPaths(pythonPath?: Uri, importLogger?: ImportLogger): PythonPathResult {
        let result = this._executePythonInterpreter(pythonPath?.getFilePath(), (p) =>
            this._getSearchPathResultFromInterpreter(p, importLogger)
        );

        if (!result) {
            result = {
                paths: [],
                prefix: undefined,
            };
        }

        importLogger?.log(`Received ${result.paths.length} paths from interpreter`);
        result.paths.forEach((path) => {
            importLogger?.log(`  ${path}`);
        });

        return result;
    }

    override getPythonVersion(pythonPath?: Uri, importLogger?: ImportLogger): PythonVersion | undefined {
        try {
            const execOutput = this._executePythonInterpreter(pythonPath?.getFilePath(), (p) =>
                this._executeCodeInInterpreter(p, ['-I'], extractVersion)
            );

            const versionJson: any[] = JSON.parse(execOutput!);

            if (!Array.isArray(versionJson) || versionJson.length < 5) {
                importLogger?.log(`Python version ${execOutput} from interpreter is unexpected format`);
                return undefined;
            }

            const version = PythonVersion.create(
                versionJson[0],
                versionJson[1],
                versionJson[2],
                versionJson[3],
                versionJson[4]
            );

            if (version === undefined) {
                importLogger?.log(`Python version ${execOutput} from interpreter is unsupported`);
                return undefined;
            }

            return version;
        } catch {
            importLogger?.log('Unable to get Python version from interpreter');
            return undefined;
        }
    }

    override runScript(
        pythonPath: Uri | undefined,
        script: Uri,
        args: string[],
        cwd: Uri,
        token: CancellationToken
    ): Promise<ScriptOutput> {
        // If it is already cancelled, don't bother to run script.
        throwIfCancellationRequested(token);

        // What to do about conda here?
        return new Promise<ScriptOutput>((resolve, reject) => {
            let stdout = '';
            let stderr = '';
            const commandLineArgs = ['-I', script.getFilePath(), ...args];

            const child = this._executePythonInterpreter(pythonPath?.getFilePath(), (p) =>
                child_process.spawn(p, commandLineArgs, {
                    cwd: cwd.getFilePath(),
                    shell: this.shouldUseShellToRunInterpreter(p),
                })
            );
            const tokenWatch = onCancellationRequested(token, () => {
                if (child) {
                    terminateChild(child);
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
                child.on('close', (code) => {
                    tokenWatch.dispose();
                    resolve({ stdout, stderr, exitCode: code ?? undefined });
                });
            } else {
                tokenWatch.dispose();
                reject(new Error(`Cannot start python interpreter with script ${script}`));
            }
        });
    }

    override runSnippet(
        pythonPath: Uri | undefined,
        code: string,
        args: string[],
        cwd: Uri,
        token: CancellationToken,
        forceIsolated: boolean = false
    ): Promise<ScriptOutput> {
        // If it is already cancelled, don't bother to run snippet.
        throwIfCancellationRequested(token);

        // What to do about conda here?
        return new Promise<ScriptOutput>((resolve, reject) => {
            const commandLineArgs = forceIsolated ? ['-I', '-c', code, ...args] : ['-c', code, ...args];

            const child = this._executePythonInterpreter(pythonPath?.getFilePath(), (p) =>
                child_process.spawn(p, commandLineArgs, {
                    cwd: cwd.getFilePath(),
                    stdio: ['pipe', 'pipe', 'pipe'],
                    shell: this.shouldUseShellToRunInterpreter(p),
                })
            );
            const tokenWatch = onCancellationRequested(token, () => {
                if (child) {
                    terminateChild(child);
                }
                reject(new OperationCanceledException());
            });
            if (child) {
                let stdout = '';
                let stderr = '';
                let output = '';

                // Interleave stdout and stderr by capturing them with timestamps
                const outputLines: Array<{ timestamp: number; type: 'stdout' | 'stderr'; data: string }> = [];

                child.stdout?.on('data', (data) => {
                    const text = data.toString();
                    stdout += text;
                    outputLines.push({ timestamp: Date.now(), type: 'stdout', data: text });
                });

                child.stderr?.on('data', (data) => {
                    const text = data.toString();
                    stderr += text;
                    outputLines.push({ timestamp: Date.now(), type: 'stderr', data: text });
                });

                child.on('error', (error) => {
                    reject(new Error(`Failed to start Python process: ${error.message}`));
                });

                child.on('close', (code) => {
                    tokenWatch.dispose();

                    // Sort by timestamp to get proper interleaving
                    outputLines.sort((a, b) => a.timestamp - b.timestamp);

                    // Combine output in chronological order
                    output = outputLines.map((line) => line.data).join('');

                    resolve({ stdout, stderr, output, exitCode: code ?? undefined });
                });
            } else {
                tokenWatch.dispose();
                reject(new Error(`Cannot start python interpreter with the given code snippet.`));
            }
        });
    }

    protected shouldUseShellToRunInterpreter(interpreterPath: string): boolean {
        // Windows bat/cmd files must me executed with the shell due to the following breaking change:
        // https://nodejs.org/en/blog/vulnerability/april-2024-security-releases-2#command-injection-via-args-parameter-of-child_processspawn-without-shell-option-enabled-on-windows-cve-2024-27980---high
        return (
            process.platform === 'win32' &&
            !!getAnyExtensionFromPath(interpreterPath, ['.bat', '.cmd'], /* ignoreCase */ true)
        );
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

    /**
     * Executes a chunk of Python code via the provided interpreter and returns the output.
     * @param interpreterPath Path to interpreter.
     * @param commandLineArgs Command line args for interpreter other than the code to execute.
     * @param code Code to execute.
     */
    private _executeCodeInInterpreter(interpreterPath: string, commandLineArgs: string[], code: string): string {
        const useShell = this.shouldUseShellToRunInterpreter(interpreterPath);
        if (useShell) {
            code = '"' + code + '"';
        }

        commandLineArgs.push('-c', code);

        const execOutput = child_process.execFileSync(interpreterPath, commandLineArgs, {
            encoding: 'utf8',
            shell: useShell,
        });

        return execOutput;
    }

    private _getSearchPathResultFromInterpreter(
        interpreterPath: string,
        importLogger?: ImportLogger
    ): PythonPathResult | undefined {
        const result: PythonPathResult = {
            paths: [],
            prefix: undefined,
        };

        try {
            importLogger?.log(`Executing interpreter: '${interpreterPath}'`);
            const execOutput = this._executeCodeInInterpreter(interpreterPath, [], extractSys);
            const caseDetector = this.serviceProvider.get(ServiceKeys.caseSensitivityDetector);

            // Parse the execOutput. It should be a JSON-encoded array of paths.
            try {
                const execSplit = JSON.parse(execOutput);
                for (let execSplitEntry of execSplit.path) {
                    execSplitEntry = execSplitEntry.trim();
                    if (execSplitEntry) {
                        const normalizedPath = normalizePath(execSplitEntry);
                        const normalizedUri = Uri.file(normalizedPath, caseDetector);
                        // Skip non-existent paths and broken zips/eggs.
                        if (
                            this.serviceProvider.fs().existsSync(normalizedUri) &&
                            isDirectory(this.serviceProvider.fs(), normalizedUri)
                        ) {
                            result.paths.push(normalizedUri);
                        } else {
                            importLogger?.log(`Skipping '${normalizedPath}' because it is not a valid directory`);
                        }
                    }
                }

                result.prefix = Uri.file(execSplit.prefix, caseDetector);

                if (result.paths.length === 0) {
                    importLogger?.log(`Found no valid directories`);
                }
            } catch (err) {
                importLogger?.log(`Could not parse output: '${execOutput}'`);
                throw err;
            }
        } catch {
            return undefined;
        }

        return result;
    }
}
