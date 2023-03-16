/*
 * extensions.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Extension methods to various types.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */
// Jest won't load index.d.ts so put it in the same file.
declare interface Promise<T> {
    // Catches task error and ignores them.
    ignoreErrors(): void;
}

/* eslint-disable @typescript-eslint/no-empty-function */
// Explicitly tells that promise should be run asynchronously.
Promise.prototype.ignoreErrors = function <T>(this: Promise<T>) {
    this.catch((e) => {
        console.log(e);
    });
};
