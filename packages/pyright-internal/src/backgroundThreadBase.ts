/*
 * backgroundThreadBase.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * base class for background worker thread.
 */

import { MessagePort, parentPort } from 'worker_threads';

import { OperationCanceledException, setCancellationFolderName } from './common/cancellationUtils';
import { ConfigOptions } from './common/configOptions';
import { LogLevel } from './common/console';
import * as debug from './common/debug';
import { FileSystem } from './common/fileSystem';
import { FileSpec } from './common/pathUtils';
import { createFromRealFileSystem } from './common/realFileSystem';
import { PyrightFileSystem } from './pyrightFileSystem';

export class BackgroundThreadBase {
    protected fs: FileSystem;

    protected constructor(data: InitializationData) {
        setCancellationFolderName(data.cancellationFolderName);

        // Stash the base directory into a global variable.
        (global as any).__rootDirectory = data.rootDirectory;

        this.fs = new PyrightFileSystem(createFromRealFileSystem(this.getConsole()));
    }

    protected log(level: LogLevel, msg: string) {
        parentPort?.postMessage({ requestType: 'log', data: { level: level, message: msg } });
    }

    protected getConsole() {
        return {
            log: (msg: string) => {
                this.log(LogLevel.Log, msg);
            },
            info: (msg: string) => {
                this.log(LogLevel.Info, msg);
            },
            warn: (msg: string) => {
                this.log(LogLevel.Warn, msg);
            },
            error: (msg: string) => {
                this.log(LogLevel.Error, msg);
            },
            // We always generate logs in the background. For the foreground,
            // we'll decide decide based on user setting whether.
            level: LogLevel.Log,
        };
    }
}

export function createConfigOptionsFrom(jsonObject: any): ConfigOptions {
    const configOptions = new ConfigOptions(jsonObject.projectRoot);
    const getFileSpec = (fileSpec: any): FileSpec => {
        return { wildcardRoot: fileSpec.wildcardRoot, regExp: new RegExp(fileSpec.regExp.source) };
    };

    configOptions.pythonPath = jsonObject.pythonPath;
    configOptions.typeshedPath = jsonObject.typeshedPath;
    configOptions.stubPath = jsonObject.stubPath;
    configOptions.autoExcludeVenv = jsonObject.autoExcludeVenv;
    configOptions.verboseOutput = jsonObject.verboseOutput;
    configOptions.checkOnlyOpenFiles = jsonObject.checkOnlyOpenFiles;
    configOptions.useLibraryCodeForTypes = jsonObject.useLibraryCodeForTypes;
    configOptions.internalTestMode = jsonObject.internalTestMode;
    configOptions.indexGenerationMode = jsonObject.indexGenerationMode;
    configOptions.venvPath = jsonObject.venvPath;
    configOptions.venv = jsonObject.venv;
    configOptions.defaultPythonVersion = jsonObject.defaultPythonVersion;
    configOptions.defaultPythonPlatform = jsonObject.defaultPythonPlatform;
    configOptions.defaultExtraPaths = jsonObject.defaultExtraPaths;
    configOptions.diagnosticRuleSet = jsonObject.diagnosticRuleSet;
    configOptions.executionEnvironments = jsonObject.executionEnvironments;
    configOptions.autoImportCompletions = jsonObject.autoImportCompletions;
    configOptions.indexing = jsonObject.indexing;
    configOptions.logTypeEvaluationTime = jsonObject.logTypeEvaluationTime;
    configOptions.typeEvaluationTimeThreshold = jsonObject.typeEvaluationTimeThreshold;
    configOptions.include = jsonObject.include.map((f: any) => getFileSpec(f));
    configOptions.exclude = jsonObject.exclude.map((f: any) => getFileSpec(f));
    configOptions.ignore = jsonObject.ignore.map((f: any) => getFileSpec(f));
    configOptions.strict = jsonObject.strict.map((f: any) => getFileSpec(f));

    return configOptions;
}

export function run(code: () => any, port: MessagePort) {
    try {
        const result = code();
        port.postMessage({ kind: 'ok', data: result });
    } catch (e: any) {
        if (OperationCanceledException.is(e)) {
            port.postMessage({ kind: 'cancelled', data: e.message });
            return;
        }

        port.postMessage({ kind: 'failed', data: `Exception: ${e.message} in ${e.stack}` });
    }
}

export function getBackgroundWaiter<T>(port: MessagePort): Promise<T> {
    return new Promise((resolve, reject) => {
        port.on('message', (m: RequestResponse) => {
            switch (m.kind) {
                case 'ok':
                    resolve(m.data);
                    break;

                case 'cancelled':
                    reject(new OperationCanceledException());
                    break;

                case 'failed':
                    reject(m.data);
                    break;

                default:
                    debug.fail(`unknown kind ${m.kind}`);
            }
        });
    });
}

export interface InitializationData {
    rootDirectory: string;
    cancellationFolderName: string | undefined;
    runner: string | undefined;
}

export interface RequestResponse {
    kind: 'ok' | 'failed' | 'cancelled';
    data: any;
}

export interface LogData {
    level: LogLevel;
    message: string;
}
