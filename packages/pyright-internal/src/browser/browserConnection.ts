import {
    BrowserMessageReader,
    BrowserMessageWriter,
    createConnection,
    SharedArrayReceiverStrategy,
    SharedArraySenderStrategy,
} from 'vscode-languageserver/browser';

import { ObjectURLReceiverStrategy } from './cancellation/objectURLReceiverStrategy';
import { ObjectURLSenderStrategy } from './cancellation/objectURLSenderStrategy';

export type BrowserCancellationMethod = 'default' | 'sharedArray' | 'url';

export function createBrowserCancellationStrategy(method: BrowserCancellationMethod) {
    switch (method) {
        case 'sharedArray':
            return { receiver: new SharedArrayReceiverStrategy(), sender: new SharedArraySenderStrategy() };
        case 'url':
            return { receiver: new ObjectURLReceiverStrategy(), sender: new ObjectURLSenderStrategy() };
        case 'default':
            return undefined;
    }
}

export function createBrowserConnection(
    target: ConstructorParameters<typeof BrowserMessageReader>[0],
    method: BrowserCancellationMethod
) {
    return createConnection(new BrowserMessageReader(target), new BrowserMessageWriter(target), {
        cancellationStrategy: createBrowserCancellationStrategy(method),
    });
}
