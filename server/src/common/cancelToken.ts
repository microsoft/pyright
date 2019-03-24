/*
* cancelToken.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* A simple class that allows a caller to cancel an async operation.
* The async operation needs to cooperatively check for cancellation.
*/

export class CancelError extends Error {
}

export class CancelToken {
    private _isCanceled = false;

    cancel(): void {
        this._isCanceled = true;
    }

    isCanceled(): boolean {
        return this._isCanceled;
    }

    throwIfCanceled(): void {
        if (this._isCanceled) {
            throw new CancelError();
        }
    }
}
