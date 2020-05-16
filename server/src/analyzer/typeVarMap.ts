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

import { assert } from '../common/debug';
import { FunctionType, Type } from './types';

export class TypeVarMap {
    private _typeVarMap: Map<string, Type>;
    private _parameterSpecificationMap: Map<string, FunctionType>;
    private _isNarrowableMap: Map<string, boolean>;
    private _isLocked = false;

    constructor() {
        this._typeVarMap = new Map<string, Type>();
        this._parameterSpecificationMap = new Map<string, FunctionType>();
        this._isNarrowableMap = new Map<string, boolean>();
    }

    clone() {
        const newTypeVarMap = new TypeVarMap();

        this._typeVarMap.forEach((value, name) => {
            newTypeVarMap.setTypeVar(name, value, this.isNarrowable(name));
        });

        this._parameterSpecificationMap.forEach((value, name) => {
            newTypeVarMap.setParameterSpecification(name, value);
        });

        newTypeVarMap._isLocked = this._isLocked;

        return newTypeVarMap;
    }

    hasTypeVar(name: string): boolean {
        return this._typeVarMap.has(name);
    }

    getTypeVar(name: string): Type | undefined {
        return this._typeVarMap.get(name);
    }

    setTypeVar(name: string, type: Type, isNarrowable: boolean) {
        assert(!this._isLocked);
        this._typeVarMap.set(name, type);
        this._isNarrowableMap.set(name, isNarrowable);
    }

    hasParameterSpecification(name: string): boolean {
        return this._parameterSpecificationMap.has(name);
    }

    getParameterSpecification(name: string): FunctionType | undefined {
        return this._parameterSpecificationMap.get(name);
    }

    setParameterSpecification(name: string, type: FunctionType) {
        assert(!this._isLocked);
        this._parameterSpecificationMap.set(name, type);
    }

    typeVarCount() {
        return this._typeVarMap.size;
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
