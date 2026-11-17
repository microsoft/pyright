// objectURLReceiverStrategy.ts
//
// Based on this here (MIT licensed):
// https://github.com/panstromek/zebra-rs/blob/82d616225930b3ad423a2c6d883c79b94ee08ba6/webzebra/src/objectURL.ts

import * as rpc from 'vscode-jsonrpc';

import { ReceiverTokenSource } from './common';

function isCancellationRequested(requestMessage: rpc.RequestMessage, id: rpc.CancellationId): boolean {
    const objectURL = (requestMessage as any).$objectURL;

    // Other side may have not added the object URL to the request.
    if (!objectURL) {
        return false;
    }

    const request = new XMLHttpRequest();
    request.open('GET', objectURL, /* async */ false);
    try {
        request.send(null);
    } catch {
        return true;
    }
    return false;
}

// See this issue for why the implements is commented out:
// https://github.com/microsoft/vscode-languageserver-node/issues/1425
export class ObjectURLReceiverStrategy {
    // implements rpc.RequestCancellationReceiverStrategy {
    readonly kind = 'request' as const;
    createCancellationTokenSource(requestMessage: rpc.RequestMessage): rpc.AbstractCancellationTokenSource {
        return new ReceiverTokenSource(
            isCancellationRequested.bind(undefined, requestMessage),
            requestMessage.id?.toString() || ''
        );
    }
}
