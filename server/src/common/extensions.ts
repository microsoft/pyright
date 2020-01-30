/*
* extensions.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Extension methods to various types.
*/

/* eslint-disable @typescript-eslint/no-empty-function */

// Explicitly tells that promise should be run asynchonously.
Promise.prototype.ignoreErrors = function <T>(this: Promise<T>) {
  // tslint:disable-next-line:no-empty
  this.catch(() => { });
};
