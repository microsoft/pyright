/*
 * backgroundThreadBase.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * base class for background worker thread.
 */

import { MessagePort, parentPort, TransferListItem } from 'worker_threads';

import { CacheManager } from './analyzer/cacheManager';
import {
    getCancellationTokenId,
    OperationCanceledException,
    setCancellationFolderName,
} from './common/cancellationUtils';
import { ConfigOptions } from './common/configOptions';
import { ConsoleInterface, LogLevel } from './common/console';
import { isThenable } from './common/core';
import * as debug from './common/debug';
import { createFromRealFileSystem, RealTempFile } from './common/realFileSystem';
import { ServiceKeys } from './common/serviceKeys';
import { ServiceProvider } from './common/serviceProvider';
import './common/serviceProviderExtensions';
import { Uri } from './common/uri/uri';
import { CancellationToken } from 'vscode-jsonrpc';
import { getCancellationTokenFromId } from './common/fileBasedCancellationUtils';

export class BackgroundConsole implements ConsoleInterface {
    private _level = LogLevel.Log;

    get level() {
        return this._level;
    }

    set level(value: LogLevel) {
        this._level = value;
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
        parentPort?.postMessage({ requestType: 'log', data: serialize({ level: level, message: msg }) });
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

        let tempFile = this._serviceProvider.tryGet(ServiceKeys.tempFile);
        if (!tempFile) {
            tempFile = new RealTempFile(data.tempFileName);
            this._serviceProvider.add(ServiceKeys.tempFile, tempFile);
        }

        if (!this._serviceProvider.tryGet(ServiceKeys.caseSensitivityDetector)) {
            this._serviceProvider.add(ServiceKeys.caseSensitivityDetector, tempFile as RealTempFile);
        }

        if (!this._serviceProvider.tryGet(ServiceKeys.fs)) {
            this._serviceProvider.add(
                ServiceKeys.fs,
                createFromRealFileSystem(
                    this._serviceProvider.get(ServiceKeys.caseSensitivityDetector),
                    this.getConsole()
                )
            );
        }
        if (!this._serviceProvider.tryGet(ServiceKeys.cacheManager)) {
            this._serviceProvider.add(ServiceKeys.cacheManager, new CacheManager());
        }

        // Stash the base directory into a global variable.
        (global as any).__rootDirectory = Uri.parse(data.rootUri, this._serviceProvider).getFilePath();
    }

    protected get fs() {
        return this._serviceProvider.fs();
    }

    protected log(level: LogLevel, msg: string) {
        parentPort?.postMessage({ requestType: 'log', data: serialize({ level: level, message: msg }) });
    }

    protected getConsole() {
        return this._serviceProvider.console();
    }

    protected getServiceProvider() {
        return this._serviceProvider;
    }

    protected handleShutdown() {
        this._serviceProvider.dispose();
        parentPort?.close();
    }
}

// Function used to serialize specific types that can't automatically be serialized.
// Exposed here so it can be reused by a caller that wants to add more cases.
export function serializeReplacer(value: any) {
    if (Uri.is(value) && value.toJsonObj !== undefined) {
        return { __serialized_uri_val: value.toJsonObj() };
    }
    if (value instanceof Map) {
        return { __serialized_map_val: [...value] };
    }
    if (value instanceof Set) {
        return { __serialized_set_val: [...value] };
    }
    if (value instanceof RegExp) {
        return { __serialized_regexp_val: { source: value.source, flags: value.flags } };
    }
    if (value instanceof ConfigOptions) {
        const entries = Object.entries(value);
        return { __serialized_config_options: entries.reduce((obj, e, i) => ({ ...obj, [e[0]]: e[1] }), {}) };
    }
    if (CancellationToken.is(value)) {
        return { cancellation_token_val: getCancellationTokenId(value) ?? null };
    }

    return value;
}

export function serialize(obj: any): string {
    // Convert the object to a string so it can be sent across a message port.
    return JSON.stringify(obj, (k, v) => serializeReplacer(v));
}

export function deserializeReviver(value: any) {
    if (value && typeof value === 'object') {
        if (value.__serialized_uri_val !== undefined) {
            return Uri.fromJsonObj(value.__serialized_uri_val);
        }
        if (value.__serialized_map_val) {
            return new Map(value.__serialized_map_val);
        }
        if (value.__serialized_set_val) {
            return new Set(value.__serialized_set_val);
        }
        if (value.__serialized_regexp_val) {
            return new RegExp(value.__serialized_regexp_val.source, value.__serialized_regexp_val.flags);
        }
        if (value.__serialized_config_options) {
            const configOptions = new ConfigOptions(value.__serialized_config_options.projectRoot);
            Object.assign(configOptions, value.__serialized_config_options);
            return configOptions;
        }
        if (Object.keys(value).includes('cancellation_token_val')) {
            return getCancellationTokenFromId(value.cancellation_token_val);
        }
    }
    return value;
}

export function deserialize<T = any>(json: string | null): T {
    if (!json) {
        return undefined as any;
    }
    // Convert the string back to an object.
    return JSON.parse(json, (k, v) => deserializeReviver(v));
}

export interface MessagePoster {
    postMessage(value: any, transferList?: ReadonlyArray<TransferListItem>): void;
}

export function run<T = any>(code: () => Promise<T>, port: MessagePoster): Promise<void>;
export function run<T = any>(code: () => Promise<T>, port: MessagePoster, serializer: (obj: any) => any): Promise<void>;
export function run<T = any>(code: () => T, port: MessagePoster): void;
export function run<T = any>(code: () => T, port: MessagePoster, serializer: (obj: any) => any): void;
export function run<T = any>(
    code: () => T | Promise<T>,
    port: MessagePoster,
    serializer = serialize
): void | Promise<void> {
    try {
        const result = code();
        if (!isThenable(result)) {
            port.postMessage({ kind: 'ok', data: serializer(result) });
            return;
        }

        return result.then(
            (r) => {
                port.postMessage({ kind: 'ok', data: serializer(r) });
            },
            (e) => {
                if (OperationCanceledException.is(e)) {
                    port.postMessage({ kind: 'cancelled', data: e.message });
                    return;
                }

                port.postMessage({ kind: 'failed', data: `Exception: ${e.message} in ${e.stack}` });
            }
        );
    } catch (e: any) {
        if (OperationCanceledException.is(e)) {
            port.postMessage({ kind: 'cancelled', data: e.message });
            return;
        }

        port.postMessage({ kind: 'failed', data: `Exception: ${e.message} in ${e.stack}` });
    }
}

export function getBackgroundWaiter<T>(port: MessagePort, deserializer: (v: any) => T = deserialize): Promise<T> {
    return new Promise((resolve, reject) => {
        port.on('message', (m: RequestResponse) => {
            switch (m.kind) {
                case 'ok':
                    resolve(deserializer(m.data));
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
    tempFileName: string;
    serviceId: string;
    workerIndex: number;
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
