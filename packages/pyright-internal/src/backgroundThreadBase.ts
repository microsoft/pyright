/*
 * backgroundThreadBase.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * base class for background worker thread.
 */

import { MessagePort, parentPort, TransferListItem } from 'worker_threads';

import { OperationCanceledException, setCancellationFolderName } from './common/cancellationUtils';
import { ConfigOptions } from './common/configOptions';
import { ConsoleInterface, LogLevel } from './common/console';
import * as debug from './common/debug';
import { createFromRealFileSystem, RealTempFile } from './common/realFileSystem';
import { ServiceProvider } from './common/serviceProvider';
import './common/serviceProviderExtensions';
import { ServiceKeys } from './common/serviceProviderExtensions';
import { Uri } from './common/uri/uri';
import { FileSpec } from './common/uri/uriUtils';

export class BackgroundConsole implements ConsoleInterface {
    // We always generate logs in the background. For the foreground,
    // we'll decide based on user setting whether.
    get level() {
        return LogLevel.Log;
    }

    log(msg: string) {
        this.post(LogLevel.Log, msg);
    }
    info(msg: string) {
        this.post(LogLevel.Info, msg);
    }
    warn(msg: string) {
        this.post(LogLevel.Warn, msg);
    }
    error(msg: string) {
        this.post(LogLevel.Error, msg);
    }
    protected post(level: LogLevel, msg: string) {
        parentPort?.postMessage({ requestType: 'log', data: { level: level, message: msg } });
    }
}

export class BackgroundThreadBase {
    private readonly _serviceProvider: ServiceProvider;

    protected constructor(data: InitializationData, serviceProvider?: ServiceProvider) {
        setCancellationFolderName(data.cancellationFolderName);

        // Make sure there's a file system and a console interface.
        this._serviceProvider = serviceProvider ?? new ServiceProvider();
        if (!this._serviceProvider.tryGet(ServiceKeys.console)) {
            this._serviceProvider.add(ServiceKeys.console, new BackgroundConsole());
        }
        if (!this._serviceProvider.tryGet(ServiceKeys.fs)) {
            this._serviceProvider.add(ServiceKeys.fs, createFromRealFileSystem(this.getConsole()));
        }
        if (!this._serviceProvider.tryGet(ServiceKeys.tempFile)) {
            this._serviceProvider.add(
                ServiceKeys.tempFile,
                new RealTempFile(this._serviceProvider.fs().isCaseSensitive)
            );
        }

        // Stash the base directory into a global variable.
        (global as any).__rootDirectory = Uri.parse(
            data.rootUri,
            this._serviceProvider.fs().isCaseSensitive
        ).getFilePath();
    }

    protected get fs() {
        return this._serviceProvider.fs();
    }

    protected log(level: LogLevel, msg: string) {
        //parentPort?.postMessage({ requestType: 'log', data: { level: level, message: msg } });
    }

    protected getConsole() {
        return this._serviceProvider.console();
    }

    protected getServiceProvider() {
        return this._serviceProvider;
    }

    protected handleShutdown() {
        this._serviceProvider.tryGet(ServiceKeys.tempFile)?.dispose();
        parentPort?.close();
    }
}

export function createJsonObjectFrom(configOptions: ConfigOptions): any {
    return {
        ...JSON.parse(JSON.stringify(configOptions)),
        defineConstant: configOptions.defineConstant, // This is the only field that can't be stringified.
    };
}

export function createConfigOptionsFrom(jsonObject: any): ConfigOptions {
    const configOptions = new ConfigOptions(Uri.fromJsonObj(jsonObject.projectRoot));
    const getFileSpec = (fileSpec: any): FileSpec => {
        return {
            wildcardRoot: Uri.fromJsonObj(fileSpec.wildcardRoot),
            regExp: new RegExp(fileSpec.regExp.source, fileSpec.regExp.flags),
            hasDirectoryWildcard: fileSpec.hasDirectoryWildcard,
        };
    };

    configOptions.pythonEnvironmentName = jsonObject.pythonEnvironmentName;
    configOptions.pythonPath = Uri.fromJsonObj(jsonObject.pythonPath);
    configOptions.typeshedPath = Uri.fromJsonObj(jsonObject.typeshedPath);
    configOptions.stubPath = Uri.fromJsonObj(jsonObject.stubPath);
    configOptions.autoExcludeVenv = jsonObject.autoExcludeVenv;
    configOptions.verboseOutput = jsonObject.verboseOutput;
    configOptions.defineConstant = new Map<string, boolean | string>(jsonObject.defineConstant);
    configOptions.checkOnlyOpenFiles = jsonObject.checkOnlyOpenFiles;
    configOptions.useLibraryCodeForTypes = jsonObject.useLibraryCodeForTypes;
    configOptions.internalTestMode = jsonObject.internalTestMode;
    configOptions.indexGenerationMode = jsonObject.indexGenerationMode;
    configOptions.venvPath = Uri.fromJsonObj(jsonObject.venvPath);
    configOptions.venv = jsonObject.venv;
    configOptions.defaultPythonVersion = jsonObject.defaultPythonVersion;
    configOptions.defaultPythonPlatform = jsonObject.defaultPythonPlatform;
    configOptions.defaultExtraPaths = jsonObject.defaultExtraPaths?.map((p: any) => Uri.fromJsonObj(p));
    configOptions.diagnosticRuleSet = jsonObject.diagnosticRuleSet;
    configOptions.executionEnvironments = jsonObject.executionEnvironments?.map((e: any) => {
        return {
            ...e,
            root: Uri.fromJsonObj(e.root),
            extraPaths: e.extraPaths?.map((p: any) => Uri.fromJsonObj(p)),
        };
    });
    configOptions.autoImportCompletions = jsonObject.autoImportCompletions;
    configOptions.indexing = jsonObject.indexing;
    configOptions.taskListTokens = jsonObject.taskListTokens;
    configOptions.logTypeEvaluationTime = jsonObject.logTypeEvaluationTime;
    configOptions.typeEvaluationTimeThreshold = jsonObject.typeEvaluationTimeThreshold;
    configOptions.include = jsonObject.include.map((f: any) => getFileSpec(f));
    configOptions.exclude = jsonObject.exclude.map((f: any) => getFileSpec(f));
    configOptions.ignore = jsonObject.ignore.map((f: any) => getFileSpec(f));
    configOptions.strict = jsonObject.strict.map((f: any) => getFileSpec(f));
    configOptions.functionSignatureDisplay = jsonObject.functionSignatureDisplay;

    return configOptions;
}

export interface MessagePoster {
    postMessage(value: any, transferList?: ReadonlyArray<TransferListItem>): void;
}

export function run<T = any>(code: () => T, port: MessagePoster) {
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
    rootUri: string;
    cancellationFolderName: string | undefined;
    runner: string | undefined;
    title?: string;
}

export interface RequestResponse {
    kind: 'ok' | 'failed' | 'cancelled';
    data: any;
}

export interface LogData {
    level: LogLevel;
    message: string;
}
