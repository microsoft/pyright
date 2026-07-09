/*
 * eventEmitter.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * A simple event emitter implementation.
 */

import { Disposable } from 'vscode-jsonrpc';

export interface Event<T> {
    (listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]): Disposable;
}

export interface EventEmitter<T> {
    event: Event<T>;
    fire: (data: T) => void;
    dispose: () => void;
}

export namespace EventEmitter {
    export function create<T>(): EventEmitter<T> {
        const listeners = new Set<(data: T) => void>();
        return {
            event: (listener: (data: T) => void) => {
                listeners.add(listener);
                return {
                    dispose: () => listeners.delete(listener),
                };
            },
            fire: (data: T) => {
                for (const listener of listeners) {
                    listener(data);
                }
            },
            dispose: () => listeners.clear(),
        };
    }
}
