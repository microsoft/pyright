/*
 * uriMap.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Map specifically made to support a URI as a key.
 */

import { Uri } from './uri';

export class UriMap<T> implements Map<Uri, T> {
    private _keys = new Map<string, Uri>();
    private _values = new Map<string, T>();

    get size(): number {
        return this._values.size;
    }
    get [Symbol.toStringTag](): string {
        return '';
    }
    clear(): void {
        this._keys.clear();
        this._values.clear();
    }
    forEach(callbackfn: (value: T, key: Uri, map: Map<Uri, T>) => void, thisArg?: any): void {
        this._keys.forEach((v, k) => {
            callbackfn(this._values.get(k)!, v, this);
        });
    }
    values(): IterableIterator<T> {
        return this._values.values();
    }
    [Symbol.iterator](): IterableIterator<[Uri, T]> {
        return this.entries();
    }
    get(key: Uri | undefined): T | undefined {
        return key ? this._values.get(key.key) : undefined;
    }

    set(key: Uri | undefined, value: T): this {
        if (key) {
            this._keys.set(key.key, key);
            this._values.set(key.key, value);
        }
        return this;
    }

    has(key: Uri): boolean {
        return this._values.has(key.key);
    }

    delete(key: Uri): boolean {
        this._keys.delete(key.key);
        return this._values.delete(key.key);
    }

    entries(): IterableIterator<[Uri, T]> {
        const keys = this._keys.entries();
        const values = this._values.entries();

        return new (class implements IterableIterator<[Uri, T]> {
            [Symbol.iterator](): IterableIterator<[Uri, T]> {
                return this;
            }
            next(...args: [] | [undefined]): IteratorResult<[Uri, T], any> {
                const key = keys.next();
                const value = values.next();
                if (key.done || value.done) {
                    return { done: true, value: undefined };
                }
                return { done: false, value: [key.value[1], value.value[1]] };
            }
        })();
    }

    keys(): IterableIterator<Uri> {
        return this._keys.values();
    }
}
