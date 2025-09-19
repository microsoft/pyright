/*
 * importLogging.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Utilities for logging information about import resolution failures.
 */

export class ImportLogger {
    private _logs: string[] = [];

    log(message: string) {
        this._logs.push(message);
    }

    getLogs() {
        return this._logs;
    }
}
