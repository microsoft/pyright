/*
* nameBindings.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Tracks the names that are declared within a Python scope (module, class,
* function or lambda). Note that only the the names are tracked here, not
* the values to which they are bound at runtime. By default, names declared
* within a scope (via a parameter, assignment, class, or function) have local
* binding. This default can be overridden through the use of a "global"
* or "nonlocal" statement, as long as that statement comes before an implied
* local binding within the block. It is an error condition for a name to have
* inconsistent bindings, and this module is used to detect that condition.
*/

import StringMap from '../common/stringMap';

export enum NameBindingType {
    // Class or function
    Local,

    // With "nonlocal" keyword
    Nonlocal,

    // Module level or with "global" keyword
    Global,

    // Marked both global and nonlocal
    Inconsistent
}

export class NameBindings {
    private _bindingType: NameBindingType;
    private _parentScope: NameBindings | undefined;
    private _names = new StringMap<NameBindingType>();

    constructor(bindingType: NameBindingType, parentScope: NameBindings | undefined) {
        this._bindingType = bindingType;
        this._parentScope = parentScope;
    }

    getBindingType() {
        return this._bindingType;
    }

    getParentScope() {
        return this._parentScope;
    }

    lookUpName(name: string): NameBindingType | undefined {
        const entry = this._names.get(name);
        if (entry) {
            return entry;
        }

        return undefined;
    }

    getGlobalNames(): string[] {
        return this._getNamesOfBindingType(NameBindingType.Global);
    }

    getLocalNames(): string[] {
        return this._getNamesOfBindingType(NameBindingType.Local);
    }

    // Adds a name and associated binding type. Returns false if the
    // name already exists but is a different type than it was previously.
    addName(name: string, bindingType: NameBindingType): boolean {
        const entry = this._names.get(name);
        if (entry === bindingType) {
            return true;
        }

        if (entry === undefined) {
            this._names.set(name, bindingType);
            return true;
        }

        // If the name was already marked as inconsistent, return true
        // so we don't report errors multiple times.
        if (entry === NameBindingType.Inconsistent) {
            return true;
        }

        // Mark the type as inconsistent so we don't use it in subsequent
        // analysis and we can generate a diagnostic.
        this._names.set(name, NameBindingType.Inconsistent);
        return false;
    }

    // Returns all of the names with a specified binding type.
    private _getNamesOfBindingType(type: NameBindingType): string[] {
        const nameList: string[] = [];

        this._names.forEach((entry, name) => {
            // Include names with inconsistent binding types as well to
            // eliminate extraneous errors during analysis.
            if (entry === type || entry === NameBindingType.Inconsistent) {
                nameList.push(name);
            }
        });

        return nameList;
    }

}
