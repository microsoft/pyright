/*
 * logTracker.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * A simple logging class that can be used to track nested loggings.
 */

import { ConsoleInterface, LogLevel } from './console';
import { Duration } from './timing';

export class LogTracker {
    private _dummyState = new State();
    private _indentation = '';
    private _previousTitles: string[] = [];

    constructor(private _console: ConsoleInterface | undefined, private _prefix: string) {}

    log<T>(title: string, callback: (state: LogState) => T) {
        // If no console is given, don't do anything.
        if (this._console === undefined) {
            return callback(this._dummyState);
        }

        // This is enabled only when level is LogLevel.Log or does not exist.
        const level = (this._console as any).level;
        if (level === undefined || level !== LogLevel.Log) {
            return callback(this._dummyState);
        }

        // Since this is only used when LogLevel.Log is set or BG, we don't care much
        // on extra logging cost.
        const duration = new Duration();

        const current = this._indentation;
        this._previousTitles.push(`${current}${title} ...`);

        this._indentation += '  ';
        const state = new State();

        try {
            return callback(state);
        } finally {
            this._printPreviousTitles();

            this._indentation = current;
            this._console.log(
                `[${this._prefix}] ${
                    this._indentation
                }${title}${state.get()} (${duration.getDurationInMilliseconds()}ms)`
            );
        }
    }

    private _printPreviousTitles() {
        // Get rid of myself
        this._previousTitles.pop();

        if (this._previousTitles.length <= 0) {
            return;
        }

        for (const previousTitle of this._previousTitles) {
            this._console!.log(`[${this._prefix}] ${previousTitle}`);
        }

        this._previousTitles.length = 0;
    }
}

export interface LogState {
    add(_addendum: string): void;
}

class State {
    private _addendum: string | undefined;

    add(_addendum: string) {
        this._addendum = _addendum;
    }

    get() {
        if (this._addendum) {
            return ` [${this._addendum}]`;
        }

        return '';
    }
}
