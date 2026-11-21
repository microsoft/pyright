import assert from 'assert';

import { ObjectURLReceiverStrategy } from '../browser/cancellation/objectURLReceiverStrategy';
import { ObjectURLSenderStrategy } from '../browser/cancellation/objectURLSenderStrategy';

test('revoking a request URL is observed by the synchronous cancellation token', () => {
    const urls = new Set<string>();
    const create = jest.spyOn(URL, 'createObjectURL').mockImplementation(() => {
        const url = `blob:request-${urls.size}`;
        urls.add(url);
        return url;
    });
    const revoke = jest.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
        urls.delete(url);
    });
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'XMLHttpRequest');
    Object.defineProperty(globalThis, 'XMLHttpRequest', {
        configurable: true,
        value: class {
            private _url = '';
            open(_method: string, url: string) {
                this._url = url;
            }
            send() {
                if (!urls.has(this._url)) {
                    throw new Error('Object URL was revoked');
                }
            }
        },
    });
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 100);
    const sender = new ObjectURLSenderStrategy();
    const message = { jsonrpc: '2.0' as const, id: 1, method: 'textDocument/hover' };
    sender.enableCancellation(message);
    const source = new ObjectURLReceiverStrategy().createCancellationTokenSource(message);
    try {
        assert.strictEqual(source.token.isCancellationRequested, false);
        sender.cleanup(1);
        clock.mockReturnValue(now + 110);
        assert.strictEqual(source.token.isCancellationRequested, true);
        sender.cleanup(1);
        assert.strictEqual(revoke.mock.calls.length, 1);
    } finally {
        source.dispose();
        create.mockRestore();
        revoke.mockRestore();
        clock.mockRestore();
        if (descriptor) {
            Object.defineProperty(globalThis, 'XMLHttpRequest', descriptor);
        } else {
            Reflect.deleteProperty(globalThis, 'XMLHttpRequest');
        }
    }
});
