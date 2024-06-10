/*
 * console.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides an abstraction for console logging and error-reporting
 * methods.
 */

import { Disposable } from 'vscode-jsonrpc';
import * as debug from './debug';
import { addIfUnique, removeArrayElements } from './collectionUtils';

export enum LogLevel {
    Error = 'error',
    Warn = 'warn',
    Info = 'info',
    Log = 'log',
}
export interface ConsoleInterface {
    error: (message: string) => void;
    warn: (message: string) => void;
    info: (message: string) => void;
    log: (message: string) => void;
}

export namespace ConsoleInterface {
    export function is(obj: any): obj is ConsoleInterface {
        return obj.error !== undefined && obj.warn !== undefined && obj.info !== undefined && obj.log !== undefined;
    }

    export function hasLevel(console: any): console is ConsoleInterface & { level: LogLevel } {
        return is(console) && 'level' in console;
    }
}

const levelMap = new Map([
    [LogLevel.Error, 0],
    [LogLevel.Warn, 1],
    [LogLevel.Info, 2],
    [LogLevel.Log, 3],
]);

export function getLevelNumber(level: LogLevel): number {
    return levelMap.get(level) ?? 3;
}

// Avoids outputting errors to the console but counts
// the number of logs and errors, which can be useful
// for unit tests.
export class NullConsole implements ConsoleInterface {
    logCount = 0;
    infoCount = 0;
    warnCount = 0;
    errorCount = 0;

    log(message: string) {
        this.logCount++;
    }

    info(message: string) {
        this.infoCount++;
    }

    warn(message: string) {
        this.warnCount++;
    }

    error(message: string) {
        this.errorCount++;
    }
}

export class StandardConsole implements ConsoleInterface {
    constructor(private _maxLevel: LogLevel = LogLevel.Log) {}

    get level(): LogLevel {
        return this._maxLevel;
    }

    log(message: string) {
        if (getLevelNumber(this._maxLevel) >= getLevelNumber(LogLevel.Log)) {
            console.log(message);
        }
    }

    info(message: string) {
        if (getLevelNumber(this._maxLevel) >= getLevelNumber(LogLevel.Info)) {
            console.info(message);
        }
    }

    warn(message: string) {
        if (getLevelNumber(this._maxLevel) >= getLevelNumber(LogLevel.Warn)) {
            console.warn(message);
        }
    }

    error(message: string) {
        if (getLevelNumber(this._maxLevel) >= getLevelNumber(LogLevel.Error)) {
            console.error(message);
        }
    }
}

export class StderrConsole implements ConsoleInterface {
    constructor(private _maxLevel: LogLevel = LogLevel.Log) {}

    get level(): LogLevel {
        return this._maxLevel;
    }

    log(message: string) {
        if (getLevelNumber(this._maxLevel) >= getLevelNumber(LogLevel.Log)) {
            console.error(message);
        }
    }

    info(message: string) {
        if (getLevelNumber(this._maxLevel) >= getLevelNumber(LogLevel.Info)) {
            console.error(message);
        }
    }

    warn(message: string) {
        if (getLevelNumber(this._maxLevel) >= getLevelNumber(LogLevel.Warn)) {
            console.error(message);
        }
    }

    error(message: string) {
        if (getLevelNumber(this._maxLevel) >= getLevelNumber(LogLevel.Error)) {
            console.error(message);
        }
    }
}

export interface Chainable {
    addChain(console: ConsoleInterface): void;
    removeChain(console: ConsoleInterface): void;
}

export namespace Chainable {
    export function is(value: any): value is Chainable {
        return value && value.addChain && value.removeChain;
    }
}

export class ConsoleWithLogLevel implements ConsoleInterface, Chainable, Disposable {
    private readonly _chains: ConsoleInterface[] = [];

    private _maxLevel = 2;
    private _disposed = false;

    constructor(private _console: ConsoleInterface, private _name = '') {}

    get level(): LogLevel {
        switch (this._maxLevel) {
            case 0:
                return LogLevel.Error;

            case 1:
                return LogLevel.Warn;

            case 2:
                return LogLevel.Info;
        }

        return LogLevel.Log;
    }

    set level(value: LogLevel) {
        let maxLevel = getLevelNumber(value);
        if (maxLevel === undefined) {
            maxLevel = getLevelNumber(LogLevel.Info)!;
        }

        this._maxLevel = maxLevel;
    }

    dispose() {
        this._disposed = true;
    }

    error(message: string) {
        this._log(LogLevel.Error, `${this._prefix}${message}`);
    }

    warn(message: string) {
        this._log(LogLevel.Warn, `${this._prefix}${message}`);
    }

    info(message: string) {
        this._log(LogLevel.Info, `${this._prefix}${message}`);
    }

    log(message: string) {
        this._log(LogLevel.Log, `${this._prefix}${message}`);
    }

    addChain(console: ConsoleInterface): void {
        addIfUnique(this._chains, console);
    }

    removeChain(console: ConsoleInterface): void {
        removeArrayElements(this._chains, (i) => i === console);
    }

    private get _prefix() {
        return this._name ? `(${this._name}) ` : '';
    }

    private _log(level: LogLevel, message: string): void {
        if (this._disposed) {
            return;
        }

        this._processChains(level, message);

        if (this._getNumericalLevel(level) > this._maxLevel) {
            return;
        }

        log(this._console, level, message);
    }

    private _getNumericalLevel(level: LogLevel): number {
        const numericLevel = getLevelNumber(level);
        debug.assert(numericLevel !== undefined, 'Logger: unknown log level.');
        return numericLevel !== undefined ? numericLevel : 2;
    }

    private _processChains(level: LogLevel, message: string) {
        this._chains.forEach((c) => log(c, level, message));
    }
}

export function log(console: ConsoleInterface, logType: LogLevel, msg: string) {
    switch (logType) {
        case LogLevel.Log:
            console.log(msg);
            break;

        case LogLevel.Info:
            console.info(msg);
            break;

        case LogLevel.Warn:
            console.warn(msg);
            break;

        case LogLevel.Error:
            console.error(msg);
            break;

        default:
            debug.fail(`${logType} is not expected`);
    }
}

export function convertLogLevel(logLevelValue?: string): LogLevel {
    if (!logLevelValue) {
        return LogLevel.Info;
    }

    switch (logLevelValue.toLowerCase()) {
        case 'error':
            return LogLevel.Error;

        case 'warning':
            return LogLevel.Warn;

        case 'information':
            return LogLevel.Info;

        case 'trace':
            return LogLevel.Log;

        default:
            return LogLevel.Info;
    }
}
