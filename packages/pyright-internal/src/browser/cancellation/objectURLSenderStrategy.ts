// objectURLSenderStrategy.ts
//
// Based on this here (MIT licensed):
// https://github.com/panstromek/zebra-rs/blob/82d616225930b3ad423a2c6d883c79b94ee08ba6/webzebra/src/objectURL.ts

import * as rpc from 'vscode-jsonrpc';

export class ObjectURLSenderStrategy implements rpc.CancellationSenderStrategy {
    private _map = new Map<string | number | null, string>();
    enableCancellation(request: rpc.RequestMessage): void {
        // Create the object URL and add its value to the request
        const objectURL = URL.createObjectURL(new Blob());
        (request as any).$objectURL = objectURL;
        this._map.set(request.id, objectURL);
    }
    cleanup(id: rpc.CancellationId): void {
        const objectURL = this._map.get(id);
        if (objectURL) {
            URL.revokeObjectURL(objectURL);
            this._map.delete(id);
        }
    }
    sendCancellation(_conn: rpc.MessageConnection, id: rpc.CancellationId): Promise<void> {
        // Just revoke the object URL
        this.cleanup(id);
        return Promise.resolve();
    }
}
