// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-empty-function */

// tslint:disable-next-line:interface-name
declare interface Promise<T> {
    // Catches task error and ignores them.
    ignoreErrors(): void;
}

// Explicitly tells that promise should be run asynchonously.
Promise.prototype.ignoreErrors = function<T>(this: Promise<T>) {
    // tslint:disable-next-line:no-empty
    this.catch(() => {});
};
