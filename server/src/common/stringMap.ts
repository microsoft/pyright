/*
* stringMap.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Provides a map between an arbitrary set of strings and some
* other type. This wraps the normal JS map and adds a few
* more operations.
*/

export default class StringMap<T> {
    private _map = new Map<string, T>();

    // Adds a new entry, replacing an existing entry.
    // Returns false if it was already present.
    set(key: string, value: T): boolean {
        const wasPresent = this._map.has(key);
        this._map.set(key, value);
        return !wasPresent;
    }

    // Adds a new entry if the key isn't already defined.
    // Returns false if it was already present.
    setIfUnique(key: string, value: T): boolean {
        if (this._map.has(key)) {
            return false;
        }

        this._map.set(key, value);
        return true;
    }

    get(key: string): T | undefined {
        return this._map.get(key);
    }

    delete(key: string) {
        this._map.delete(key);
    }

    getKeys() {
        return Array.from(this._map.keys());
    }

    forEach(callback: (item: T, key: string) => void) {
        this._map.forEach((value, key) => {
            callback(value, key);
        });
    }

    isEmpty() {
        return this._map.size === 0;
    }
}
