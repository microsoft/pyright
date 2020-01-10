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

import { Type } from "./types";

export class TypeVarMap {
    private _typeMap: Map<string, Type>;

    constructor() {
        this._typeMap = new Map<string, Type>();
    }

    clone() {
        const newTypeVarMap = new TypeVarMap();

        this._typeMap.forEach((value, name) => {
            newTypeVarMap.set(name, value);
        });

        return newTypeVarMap;
    }

    has(name: string): boolean {
        return this._typeMap.has(name);
    }

    get(name: string): Type | undefined {
        return this._typeMap.get(name);
    }

    set(name: string, type: Type) {
        this._typeMap.set(name, type);
    }

    size() {
        return this._typeMap.size;
    }
}
