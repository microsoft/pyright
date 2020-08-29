/*
 * console.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides an abstraction for console logging and error-reporting
 * methods.
 */

import * as debug from './debug';

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
    log(message: string) {
        console.info(message);
    }

    info(message: string) {
        console.info(message);
    }

    warn(message: string) {
        console.warn(message);
    }

    error(message: string) {
        console.error(message);
    }
}

export class ConsoleWithLogLevel implements ConsoleInterface {
    private _levelMap: Map<string, number> = new Map([
        [LogLevel.Error, 0],
        [LogLevel.Warn, 1],
        [LogLevel.Info, 2],
        [LogLevel.Log, 3],
    ]);

    private _maxLevel = 2;

    constructor(private _console: ConsoleInterface) {}

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
        let maxLevel = this._levelMap.get(value);
        if (maxLevel === undefined) {
            maxLevel = this._levelMap.get(LogLevel.Info)!;
        }

        this._maxLevel = maxLevel;
    }

    error(message: string) {
        this._log(LogLevel.Error, message);
    }

    warn(message: string) {
        this._log(LogLevel.Warn, message);
    }

    info(message: string) {
        this._log(LogLevel.Info, message);
    }

    log(message: string) {
        this._log(LogLevel.Log, message);
    }

    private _log(level: LogLevel, message: string): void {
        if (this._getNumericalLevel(level) > this._maxLevel) {
            return;
        }

        log(this._console, level, message);
    }

    private _getNumericalLevel(level: LogLevel): number {
        const numericLevel = this._levelMap.get(level);
        debug.assert(numericLevel !== undefined, 'Logger: unknown log level.');
        return numericLevel !== undefined ? numericLevel : 2;
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
