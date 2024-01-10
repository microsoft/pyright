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
        parentPort?.postMessage({ requestType: 'log', data: serialize({ level: level, message: msg }) });
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

// Function used to serialize specific types that can't automatically be serialized.
// Exposed here so it can be reused by a caller that wants to add more cases.
export function serializeReplacer(key: string, value: any) {
    if (Uri.isUri(value)) {
        return { uri_str: value.toString(), case_sensitive: value.isCaseSensitive };
    }
    if (value instanceof Map) {
        return { map_val: [...value] };
    }
    if (value instanceof Set) {
        return { set_val: [...value] };
    }
    if (value instanceof RegExp) {
        return { regexp_val: { source: value.source, flags: value.flags } };
    }
    if (value instanceof ConfigOptions) {
        const entries = Object.entries(value);
        return { config_options: entries.reduce((obj, e, i) => ({ ...obj, [e[0]]: e[1] }), {}) };
    }

    return value;
}

export function serialize(obj: any): string {
    // Convert the object to a string so it can be sent across a message port.
    return JSON.stringify(obj, serializeReplacer);
}

export function deserializeReviver(key: string, value: any) {
    if (value && typeof value === 'object') {
        if (value.uri_str !== undefined) {
            return Uri.parse(value.uri_str, value.case_sensitive);
        }
        if (value.map_val) {
            return new Map(value.map_val);
        }
        if (value.set_val) {
            return new Set(value.set_val);
        }
        if (value.regexp_val) {
            return new RegExp(value.regexp_val.source, value.regexp_val.flags);
        }
        if (value.config_options) {
            const configOptions = new ConfigOptions(value.config_options.projectRoot);
            Object.assign(configOptions, value.config_options);
            return configOptions;
        }
    }
    return value;
}

export function deserialize<T = any>(json: string | null): T {
    if (!json) {
        return undefined as any;
    }
    // Convert the string back to an object.
    return JSON.parse(json, deserializeReviver);
}

export interface MessagePoster {
    postMessage(value: any, transferList?: ReadonlyArray<TransferListItem>): void;
}

export function run<T = any>(code: () => T, port: MessagePoster, serializer = serialize) {
    try {
        const result = code();
        port.postMessage({ kind: 'ok', data: serializer(result) });
    } catch (e: any) {
        if (OperationCanceledException.is(e)) {
            port.postMessage({ kind: 'cancelled', data: e.message });
            return;
        }

        port.postMessage({ kind: 'failed', data: `Exception: ${e.message} in ${e.stack}` });
    }
}

export function getBackgroundWaiter<T>(port: MessagePort, deserializer = deserialize): Promise<T> {
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
