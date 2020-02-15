/*
* typeVarMap.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Module that records the relationship between named TypeVars
* (type variables) and their types. It is used by the type
* evaluator to "solve" for the type of each type variable.
*/

import { assert } from "../common/debug";
import { Type } from "./types";

export class TypeVarMap {
    private _typeMap: Map<string, Type>;
    private _isNarrowableMap: Map<string, boolean>;
    private _isLocked = false;

    constructor() {
        this._typeMap = new Map<string, Type>();
        this._isNarrowableMap = new Map<string, boolean>();
    }

    clone() {
        const newTypeVarMap = new TypeVarMap();

        this._typeMap.forEach((value, name) => {
            newTypeVarMap.set(name, value, this.isNarrowable(name));
        });

        newTypeVarMap._isLocked = this._isLocked;

        return newTypeVarMap;
    }

    has(name: string): boolean {
        return this._typeMap.has(name);
    }

    get(name: string): Type | undefined {
        return this._typeMap.get(name);
    }

    forEach(callback: (value: Type, key: string) => void) {
        return this._typeMap.forEach(callback);
    }

    set(name: string, type: Type, isNarrowable: boolean) {
        assert(!this._isLocked);
        this._typeMap.set(name, type);
        this._isNarrowableMap.set(name, isNarrowable);
    }

    size() {
        return this._typeMap.size;
    }

    isNarrowable(name: string): boolean {
        const isNarrowable = this._isNarrowableMap.get(name);

        // Unless told otherwise, assume type is narrowable.
        return isNarrowable !== undefined ? isNarrowable : true;
    }

    lock() {
        // Locks the type var map, preventing any further changes.
        assert(!this._isLocked);
        this._isLocked = true;
    }

    isLocked(): boolean {
        return this._isLocked;
    }
}
