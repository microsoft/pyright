/*
 * logTracker.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * A simple logging class that can be used to track nested loggings.
 */

import { ConsoleInterface, LogLevel } from './console';
import { Duration } from './timing';

// Consider an operation "long running" if it goes longer than this.
const durationThresholdForInfoInMs = 2000;

export class LogTracker {
    private _dummyState = new State();
    private _indentation = '';
    private _previousTitles: string[] = [];

    constructor(private _console: ConsoleInterface | undefined, private _prefix: string) {}

    log<T>(title: string, callback: (state: LogState) => T, minimalDuration = -1) {
        // If no console is given, don't do anything.
        if (this._console === undefined) {
            return callback(this._dummyState);
        }

        // This is enabled only when level is LogLevel.Log or does not exist.
        const level = (this._console as any).level;
        if (level === undefined || (level !== LogLevel.Log && level !== LogLevel.Info)) {
            return callback(this._dummyState);
        }

        // Since this is only used when LogLevel.Log or LogLevel.Info is set or BG,
        // we don't care much about extra logging cost.
        const duration = new Duration();

        const current = this._indentation;
        this._previousTitles.push(`${current}${title} ...`);

        this._indentation += '  ';
        const state = new State();

        try {
            return callback(state);
        } finally {
            const msDuration = duration.getDurationInMilliseconds();
            this._indentation = current;

            // if we already printed our header (by nested calls), then it can't be skipped.
            if (this._previousTitles.length > 0 && (state.isSuppressed() || msDuration <= minimalDuration)) {
                // Get rid of myself so we don't even show header.
                this._previousTitles.pop();
            } else {
                this._printPreviousTitles();

                this._console.log(`[${this._prefix}] ${this._indentation}${title}${state.get()} (${msDuration}ms)`);

                // If the operation took really long, log it as "info" so it is more visible.
                if (msDuration >= durationThresholdForInfoInMs) {
                    this._console.info(`[${this._prefix}] Long operation: ${title} (${msDuration}ms)`);
                }
            }
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
    suppress(): void;
}

class State {
    private _addendum: string | undefined;
    private _suppress: boolean | undefined;

    add(_addendum: string) {
        this._addendum = _addendum;
    }

    get() {
        if (this._addendum) {
            return ` [${this._addendum}]`;
        }

        return '';
    }

    suppress() {
        this._suppress = true;
    }

    isSuppressed() {
        return !!this._suppress;
    }
}
