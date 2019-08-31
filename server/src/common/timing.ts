/*
* timing.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* A simple duration class that can be used to record and report
* durations at the millisecond level of resolution.
*/

import { ConsoleInterface } from './console';

export class Duration {
    private _startTime: number;

    constructor() {
        this._startTime = Date.now();
    }

    restart() {
        this._startTime = Date.now();
    }

    getDurationInMilliseconds() {
        const curTime = Date.now();
        return curTime - this._startTime;
    }

    getDurationInSeconds() {
        return this.getDurationInMilliseconds() / 1000;
    }
}

export class TimingStat {
    totalTime = 0;

    timeOperation(callback: () => void) {
        const duration = new Duration();
        callback();
        this.totalTime += duration.getDurationInMilliseconds();
    }

    printTime(): string {
        const totalTimeInSec = this.totalTime / 1000;
        const roundedTime = Math.round(totalTimeInSec * 100) / 100;
        return roundedTime.toString() + 'sec';
    }
}

export class TimingStats {
    totalDuration = new Duration();
    findFilesTime = new TimingStat();
    readFileTime = new TimingStat();
    tokenizeFileTime = new TimingStat();
    parseFileTime = new TimingStat();
    postParseWalkerTime = new TimingStat();
    resolveImportsTime = new TimingStat();
    semanticAnalyzerTime = new TimingStat();
    typeAnalyzerTime = new TimingStat();

    printSummary(console: ConsoleInterface) {
        console.log(`Completed in ${ this.totalDuration.getDurationInSeconds() }sec`);
    }

    printDetails(console: ConsoleInterface) {
        console.log('');
        console.log('Timing stats');
        console.log('Find Source Files:    ' + this.findFilesTime.printTime());
        console.log('Read Source Files:    ' + this.readFileTime.printTime());
        console.log('Tokenize:             ' + this.tokenizeFileTime.printTime());
        console.log('Parse:                ' + this.parseFileTime.printTime());
        console.log('Post-parse Walker:    ' + this.postParseWalkerTime.printTime());
        console.log('Resolve Imports:      ' + this.resolveImportsTime.printTime());
        console.log('Semantic Analyzer:    ' + this.semanticAnalyzerTime.printTime());
        console.log('Type Analyzer:        ' + this.typeAnalyzerTime.printTime());
    }
}

export let timingStats = new TimingStats();
