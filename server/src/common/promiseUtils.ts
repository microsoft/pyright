/*
* promiseUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Utility types that make promises easier to use.
*/

import * as assert from 'assert';

export class PromiseSource<T> {
    private _resolve?: (result: T) => void;
    private _reject?: (error?: any) => void;
    private _promise: Promise<T>;

    constructor() {
        this._promise = new Promise<T>((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
        });
    }

    getPromise() {
        return this._promise;
    }

    resolve(result: T) {
        assert(this._resolve, 'Promise was already resolved or rejected');

        if (this._resolve) {
            let resolve = this._resolve;
            this._resolve = undefined;
            this._reject = undefined;
            resolve(result);
        }
    }

    reject(error?: any) {
        assert(this._reject, 'Promise was already resolved or rejected');

        if (this._reject) {
            let reject = this._reject;
            this._resolve = undefined;
            this._reject = undefined;
            reject(error);
        }
    }
}
