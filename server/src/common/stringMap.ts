/*
* stringMap.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Provides a map between an arbitrary set of strings and some
* other type. This wraps the normal JS map and handles reserved
* keys like "prototype" and "constructor", which cannot be
* entered into a normal JS map.
*/

const _keyPrefix = '$';

export default class StringMap<T> {
    private _map: { [key: string]: T } = {};

    // Adds a new entry, replacing an existing entry.
    // Returns false if it was already present.
    set(key: string, value: T): boolean {
        const encodedKey = this.encodeKey(key);
        const wasPresent = this._map[encodedKey] !== undefined;

        this._map[encodedKey] = value;
        return !wasPresent;
    }

    // Adds a new entry if the key isn't already defined.
    // Returns false if it was already present.
    setIfUnique(key: string, value: T): boolean {
        const encodedKey = this.encodeKey(key);
        if (this._map[encodedKey] !== undefined) {
            return false;
        }

        this._map[encodedKey] = value;
        return true;
    }

    get(key: string): T | undefined {
        return this._map[this.encodeKey(key)];
    }

    delete(key: string) {
        delete this._map[this.encodeKey(key)];
    }

    encodeKey(key: string): string {
        // Prepend a $ to avoid reserved keys like "constructor".
        return _keyPrefix + key;
    }

    decodeKey(key: string): string {
        return key.substr(_keyPrefix.length);
    }

    getKeys(): string[] {
        return Object.keys(this._map).map(k => this.decodeKey(k));
    }

    forEach(callback: (item: T, key: string) => void) {
        Object.keys(this._map).forEach(key => {
            callback(this._map[key], this.decodeKey(key));
        });
    }
}
