/*
 * utils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import { binarySearch, insertAt } from '../../common/collectionUtils';
import { identity } from '../../common/core';

export interface SortOptions<T> {
    comparer: (a: T, b: T) => number;
    sort: 'insertion' | 'comparison';
}

export class SortedMap<K, V> {
    private _comparer: (a: K, b: K) => number;
    private _keys: K[] = [];
    private _values: V[] = [];
    private _order: number[] | undefined;
    private _version = 0;
    private _copyOnWrite = false;

    constructor(comparer: ((a: K, b: K) => number) | SortOptions<K>, iterable?: Iterable<[K, V]>) {
        this._comparer = typeof comparer === 'object' ? comparer.comparer : comparer;
        this._order = typeof comparer === 'object' && comparer.sort === 'insertion' ? [] : undefined;
        if (iterable) {
            const iterator = getIterator(iterable);
            try {
                for (let i = nextResult(iterator); i; i = nextResult(iterator)) {
                    const [key, value] = i.value;
                    this.set(key, value);
                }
            } finally {
                closeIterator(iterator);
            }
        }
    }

    get size() {
        return this._keys.length;
    }

    get comparer() {
        return this._comparer;
    }

    get [Symbol.toStringTag]() {
        return 'SortedMap';
    }

    has(key: K) {
        return binarySearch(this._keys, key, identity, this._comparer) >= 0;
    }

    get(key: K) {
        const index = binarySearch(this._keys, key, identity, this._comparer);
        return index >= 0 ? this._values[index] : undefined;
    }

    set(key: K, value: V) {
        const index = binarySearch(this._keys, key, identity, this._comparer);
        if (index >= 0) {
            this._values[index] = value;
        } else {
            this._writePreamble();
            insertAt(this._keys, ~index, key);
            insertAt(this._values, ~index, value);
            if (this._order) {
                insertAt(this._order, ~index, this._version);
            }
            this._writePostScript();
        }
        return this;
    }

    delete(key: K) {
        const index = binarySearch(this._keys, key, identity, this._comparer);
        if (index >= 0) {
            this._writePreamble();
            this._orderedRemoveItemAt(this._keys, index);
            this._orderedRemoveItemAt(this._values, index);
            if (this._order) {
                this._orderedRemoveItemAt(this._order, index);
            }
            this._writePostScript();
            return true;
        }
        return false;
    }

    clear() {
        if (this.size > 0) {
            this._writePreamble();
            this._keys.length = 0;
            this._values.length = 0;
            if (this._order) {
                this._order.length = 0;
            }
            this._writePostScript();
        }
    }

    forEach(callback: (value: V, key: K, collection: this) => void, thisArg?: any) {
        const keys = this._keys;
        const values = this._values;
        const indices = this._getIterationOrder();
        const version = this._version;
        this._copyOnWrite = true;
        try {
            if (indices) {
                for (const i of indices) {
                    callback.call(thisArg, values[i], keys[i], this);
                }
            } else {
                for (let i = 0; i < keys.length; i++) {
                    callback.call(thisArg, values[i], keys[i], this);
                }
            }
        } finally {
            if (version === this._version) {
                this._copyOnWrite = false;
            }
        }
    }

    *keys() {
        const keys = this._keys;
        const indices = this._getIterationOrder();
        const version = this._version;
        this._copyOnWrite = true;
        try {
            if (indices) {
                for (const i of indices) {
                    yield keys[i];
                }
            } else {
                yield* keys;
            }
        } finally {
            if (version === this._version) {
                this._copyOnWrite = false;
            }
        }
    }

    *values() {
        const values = this._values;
        const indices = this._getIterationOrder();
        const version = this._version;
        this._copyOnWrite = true;
        try {
            if (indices) {
                for (const i of indices) {
                    yield values[i];
                }
            } else {
                yield* values;
            }
        } finally {
            if (version === this._version) {
                this._copyOnWrite = false;
            }
        }
    }

    *entries() {
        const keys = this._keys;
        const values = this._values;
        const indices = this._getIterationOrder();
        const version = this._version;
        this._copyOnWrite = true;
        try {
            if (indices) {
                for (const i of indices) {
                    yield [keys[i], values[i]] as [K, V];
                }
            } else {
                for (let i = 0; i < keys.length; i++) {
                    yield [keys[i], values[i]] as [K, V];
                }
            }
        } finally {
            if (version === this._version) {
                this._copyOnWrite = false;
            }
        }
    }

    [Symbol.iterator]() {
        return this.entries();
    }

    private _writePreamble() {
        if (this._copyOnWrite) {
            this._keys = this._keys.slice();
            this._values = this._values.slice();
            if (this._order) {
                this._order = this._order.slice();
            }
            this._copyOnWrite = false;
        }
    }

    private _writePostScript() {
        this._version++;
    }

    private _getIterationOrder() {
        if (this._order) {
            const order = this._order;
            return this._order.map((_, i) => i).sort((x, y) => order[x] - order[y]);
        }
        return undefined;
    }

    /** Remove an item by index from an array, moving everything to its right one space left. */
    private _orderedRemoveItemAt<T>(array: T[], index: number): void {
        // This seems to be faster than either `array.splice(i, 1)` or `array.copyWithin(i, i+ 1)`.
        for (let i = index; i < array.length - 1; i++) {
            array[i] = array[i + 1];
        }
        array.pop();
    }
}

export function getIterator<T>(iterable: Iterable<T>): Iterator<T> {
    return iterable[Symbol.iterator]();
}

export function nextResult<T>(iterator: Iterator<T>): IteratorResult<T> | undefined {
    const result = iterator.next();
    return result.done ? undefined : result;
}

export function closeIterator<T>(iterator: Iterator<T>) {
    const fn = iterator.return;
    if (typeof fn === 'function') {
        fn.call(iterator);
    }
}

/**
 * A collection of metadata that supports inheritance.
 */
export class Metadata {
    private static readonly _undefinedValue = {};
    private _parent: Metadata | undefined;
    private _map: { [key: string]: any };
    private _version = 0;
    private _size = -1;
    private _parentVersion: number | undefined;

    constructor(parent?: Metadata) {
        this._parent = parent;
        this._map = Object.create(parent ? parent._map : null);
    }

    get size(): number {
        if (this._size === -1 || (this._parent && this._parent._version !== this._parentVersion)) {
            this._size = Object.keys(this._map).length;
            if (this._parent) {
                this._parentVersion = this._parent._version;
            }
        }
        return this._size;
    }

    get parent() {
        return this._parent;
    }

    has(key: string): boolean {
        return this._map[Metadata._escapeKey(key)] !== undefined;
    }

    get(key: string): any {
        const value = this._map[Metadata._escapeKey(key)];
        return value === Metadata._undefinedValue ? undefined : value;
    }

    set(key: string, value: any): this {
        this._map[Metadata._escapeKey(key)] = value === undefined ? Metadata._undefinedValue : value;
        this._size = -1;
        this._version++;
        return this;
    }

    delete(key: string): boolean {
        const escapedKey = Metadata._escapeKey(key);
        if (this._map[escapedKey] !== undefined) {
            delete this._map[escapedKey];
            this._size = -1;
            this._version++;
            return true;
        }
        return false;
    }

    clear(): void {
        this._map = Object.create(this._parent ? this._parent._map : null);
        this._size = -1;
        this._version++;
    }

    forEach(callback: (value: any, key: string, map: this) => void) {
        for (const key of Object.keys(this._map)) {
            callback(this._map[key], Metadata._unescapeKey(key), this);
        }
    }

    private static _escapeKey(text: string) {
        return text.length >= 2 && text.charAt(0) === '_' && text.charAt(1) === '_' ? '_' + text : text;
    }

    private static _unescapeKey(text: string) {
        return text.length >= 3 && text.charAt(0) === '_' && text.charAt(1) === '_' && text.charAt(2) === '_'
            ? text.slice(1)
            : text;
    }
}

export function bufferFrom(input: string, encoding?: BufferEncoding): Buffer {
    // See https://github.com/Microsoft/TypeScript/issues/25652
    return Buffer.from && (Buffer.from as Function) !== Int8Array.from
        ? Buffer.from(input, encoding)
        : new Buffer(input, encoding);
}

export const IO_ERROR_MESSAGE = Object.freeze({
    EACCES: 'access denied',
    EIO: 'an I/O error occurred',
    ENOENT: 'no such file or directory',
    EEXIST: 'file already exists',
    ELOOP: 'too many symbolic links encountered',
    ENOTDIR: 'no such directory',
    EISDIR: 'path is a directory',
    EBADF: 'invalid file descriptor',
    EINVAL: 'invalid value',
    ENOTEMPTY: 'directory not empty',
    EPERM: 'operation not permitted',
    EROFS: 'file system is read-only',
});

export function createIOError(code: keyof typeof IO_ERROR_MESSAGE, details = '') {
    const err: NodeJS.ErrnoException = new Error(`${code}: ${IO_ERROR_MESSAGE[code]} ${details}`);
    err.code = code;
    if (Error.captureStackTrace) {
        Error.captureStackTrace(err, createIOError);
    }
    return err;
}

export function stringify(data: any, replacer?: (key: string, value: any) => any): string {
    return JSON.stringify(data, replacer, 2);
}
