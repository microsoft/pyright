/*
* console.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Provides an abstraction for console logging and error-reporting
* methods.
*/

export interface ConsoleInterface {
    log: (message: string) => void;
    error: (message: string) => void;
}

// Avoids outputting errors to the console but counts
// the number of logs and errors, which can be useful
// for unit tests.
export class NullConsole implements ConsoleInterface {
    logCount = 0;
    errorCount = 0;

    log(message: string) {
        this.logCount++;
    }

    error(message: string) {
        this.errorCount++;
    }
}

export class StandardConsole implements ConsoleInterface {
    log(message: string) {
        console.log(message);
    }

    error(message: string) {
        console.error(message);
    }
}
