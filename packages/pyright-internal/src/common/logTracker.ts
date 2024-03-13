/*
 * logTracker.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * A simple logging class that can be used to track nested loggings.
 */

import { ConsoleInterface, LogLevel } from './console';
import { ReadOnlyFileSystem } from './fileSystem';
import { Duration, timingStats } from './timing';
import { Uri } from './uri/uri';

// Consider an operation "long running" if it goes longer than this.
const durationThresholdForInfoInMs = 2000;

export function getPathForLogging(fs: ReadOnlyFileSystem, fileUri: Uri) {
    if (fs.isMappedUri(fileUri)) {
        return fs.getOriginalUri(fileUri);
    }

    return fileUri;
}

export class LogTracker {
    private readonly _dummyState = new State();
    private readonly _previousTitles: string[] = [];

    private _indentation = '';

    constructor(private readonly _console: ConsoleInterface | undefined, readonly prefix: string) {
        // Empty
    }

    get logLevel() {
        const level = (this._console as any).level;
        return level ?? LogLevel.Error;
    }

    log<T>(title: string, callback: (state: LogState) => T, minimalDuration = -1, logParsingPerf = false) {
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
        const current = this._indentation;
        this._previousTitles.push(`${current}${title} ...`);

        this._indentation += '  ';
        const state = new State();

        try {
            return callback(state);
        } finally {
            const msDuration = state.duration;
            this._indentation = current;

            // if we already printed our header (by nested calls), then it can't be skipped.
            if (this._previousTitles.length > 0 && (state.isSuppressed() || msDuration <= minimalDuration)) {
                // Get rid of myself so we don't even show header.
                this._previousTitles.pop();
            } else {
                this._printPreviousTitles();

                let output = `[${this.prefix}] ${this._indentation}${title}${state.get()} (${msDuration}ms)`;

                // Report parsing related perf info only if they occurred.
                if (
                    logParsingPerf &&
                    state.fileReadTotal +
                        state.tokenizeTotal +
                        state.parsingTotal +
                        state.resolveImportsTotal +
                        state.bindingTotal >
                        0
                ) {
                    output += ` [f:${state.fileReadTotal}, t:${state.tokenizeTotal}, p:${state.parsingTotal}, i:${state.resolveImportsTotal}, b:${state.bindingTotal}]`;
                }

                this._console.log(output);

                // If the operation took really long, log it as "info" so it is more visible.
                if (msDuration >= durationThresholdForInfoInMs) {
                    this._console.info(`[${this.prefix}] Long operation: ${title} (${msDuration}ms)`);
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
            this._console!.log(`[${this.prefix}] ${previousTitle}`);
        }

        this._previousTitles.length = 0;
    }
}

export interface LogState {
    add(addendum: string | undefined): void;
    suppress(): void;
}

class State {
    private _addendum: string | undefined;
    private _suppress: boolean | undefined;

    private _start = new Duration();
    private _startFile = timingStats.readFileTime.totalTime;
    private _startToken = timingStats.tokenizeFileTime.totalTime;
    private _startParse = timingStats.parseFileTime.totalTime;
    private _startImport = timingStats.resolveImportsTime.totalTime;
    private _startBind = timingStats.bindTime.totalTime;

    get duration() {
        return this._start.getDurationInMilliseconds();
    }

    get fileReadTotal() {
        return timingStats.readFileTime.totalTime - this._startFile;
    }

    get tokenizeTotal() {
        return timingStats.tokenizeFileTime.totalTime - this._startToken;
    }

    get parsingTotal() {
        return timingStats.parseFileTime.totalTime - this._startParse;
    }

    get resolveImportsTotal() {
        return timingStats.resolveImportsTime.totalTime - this._startImport;
    }

    get bindingTotal() {
        return timingStats.bindTime.totalTime - this._startBind;
    }

    add(addendum: string | undefined) {
        if (addendum) {
            this._addendum = addendum;
        }
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
