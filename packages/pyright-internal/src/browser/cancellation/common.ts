import * as rpc from 'vscode-jsonrpc';

import { CancellationThrottle } from '../../common/cancellationUtils';

// For the below, see: https://github.com/microsoft/vscode-languageserver-node/blob/dca3c1a04797aaaa7d48060cca38b16efdf4392f/jsonrpc/src/common/cancellation.ts

const shortcutEvent: rpc.Event<any> = Object.freeze(function (callback: Function, context?: any): any {
    const handle = setTimeout(callback.bind(context), 0);
    return {
        dispose() {
            clearTimeout(handle);
        },
    };
});

class Token implements rpc.CancellationToken {
    private _isCanceled = false;
    private _emitter?: rpc.Emitter<any>;

    constructor(
        private _isCancellationRequested: (id: rpc.CancellationId) => boolean,
        private _id: rpc.CancellationId
    ) {}

    get isCancellationRequested(): boolean {
        if (this._isCanceled) {
            return true;
        }

        if (CancellationThrottle.shouldCheck() && this._isCancellationRequested(this._id)) {
            return (this._isCanceled = true);
        }

        return false;
    }

    get onCancellationRequested(): rpc.Event<any> {
        if (this._isCanceled) {
            return shortcutEvent;
        }
        if (!this._emitter) {
            this._emitter = new rpc.Emitter<any>();
        }
        return this._emitter.event;
    }

    cancel() {
        if (!this._isCanceled) {
            this._isCanceled = true;
            if (this._emitter) {
                this._emitter.fire(undefined);
                this.dispose();
            }
        }
    }

    dispose(): void {
        if (this._emitter) {
            this._emitter.dispose();
            this._emitter = undefined;
        }
    }
}

export class ReceiverTokenSource implements rpc.AbstractCancellationTokenSource {
    private _token?: rpc.CancellationToken;

    constructor(
        private _isCancellationRequested: (id: rpc.CancellationId) => boolean,
        private _id: rpc.CancellationId
    ) {}

    get token(): rpc.CancellationToken {
        return (this._token ??= new Token(this._isCancellationRequested, this._id));
    }

    cancel(): void {
        if (this._token instanceof Token) {
            this._token.cancel();
        } else if (!this._token) {
            this._token = rpc.CancellationToken.Cancelled;
        }
    }

    dispose(): void {
        if (this._token instanceof Token) {
            this._token.dispose();
        } else if (!this._token) {
            this._token = rpc.CancellationToken.None;
        }
    }
}
