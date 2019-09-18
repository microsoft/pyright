/*
* symbol.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Represents an association between a name and the type
* (or multiple types) that the symbol is associated with
* in the program.
*/

import * as assert from 'assert';

import StringMap from '../common/stringMap';
import { Declaration } from './declaration';
import { InferredType, TypeSourceId } from './inferredType';
import { Type } from './types';

export enum SymbolFlags {
    None = 0,

    // Indicates that the symbol is unbound at the start of
    // execution. Some symbols are initialized by the module
    // loader, so they are bound even before the first statement
    // in the module is executed.
    InitiallyUnbound = 1 << 0,

    // Indicates that the symbol is not visible from other files.
    // Used for module-level symbols.
    ExternallyHidden = 1 << 1,

    // Indicates that someone read the value of the symbol at
    // some point. This is used for unused symbol detection.
    Accessed = 1 << 2,

    // Indicates that the symbol is a class member (used for
    // classes).
    ClassMember = 1 << 3,

    // Indicates that the symbol is a class member (used for
    // classes).
    InstanceMember = 1 << 4
}

export class Symbol {
    // Inferred type of the symbol.
    private _inferredType: InferredType = new InferredType();

    // Information about the node that declared the value -
    // i.e. where the editor will take the user if "show definition"
    // is selected. Multiple declarations can exist for variables,
    // properties, and functions (in the case of @overload).
    private _declarations?: Declaration[];

    // Flags that provide information about the symbol.
    private _flags: SymbolFlags;

    constructor(flags = SymbolFlags.ClassMember) {
        this._flags = flags;
    }

    static createWithType(flags: SymbolFlags, type: Type, typeSourceId: TypeSourceId) {
        const newSymbol = new Symbol(flags);
        newSymbol.setInferredTypeForSource(type, typeSourceId);
        return newSymbol;
    }

    static areDeclarationsEqual(decl1: Declaration, decl2: Declaration) {
        return decl1.category === decl2.category &&
            decl1.node === decl2.node &&
            decl1.path === decl2.path;
    }

    isInitiallyUnbound() {
        return !!(this._flags & SymbolFlags.InitiallyUnbound);
    }

    isExternallyHidden() {
        return !!(this._flags & SymbolFlags.ExternallyHidden);
    }

    setIsExternallyHidden(isHidden: boolean) {
        if (isHidden) {
            this._flags |= SymbolFlags.ExternallyHidden;
        } else {
            this._flags &= ~SymbolFlags.ExternallyHidden;
        }
    }

    setIsAccessed() {
        this._flags |= SymbolFlags.Accessed;
    }

    isAccessed() {
        return !!(this._flags & SymbolFlags.Accessed);
    }

    setIsClassMember() {
        this._flags |= SymbolFlags.ClassMember;
    }

    isClassMember() {
        return !!(this._flags & SymbolFlags.ClassMember);
    }

    setIsInstanceMember() {
        this._flags |= SymbolFlags.InstanceMember;
    }

    isInstanceMember() {
        return !!(this._flags & SymbolFlags.InstanceMember);
    }

    // Returns true if inferred type changed.
    setInferredTypeForSource(type: Type, typeSourceId: TypeSourceId): boolean {
        return this._inferredType.addSource(type, typeSourceId);
    }

    getInferredType() {
        return this._inferredType.getType();
    }

    addDeclaration(declaration: Declaration) {
        if (this._declarations) {
            // See if this node was already identified as a declaration. If so,
            // replace it. Otherwise, add it as a new declaration to the end of
            // the list.
            const declIndex = this._declarations.findIndex(decl => decl.node === declaration.node);
            if (declIndex >= 0) {
                // This declaration has already been added. Update the declared
                // type if it's available. The other fields in the declaration
                // should be the same from one analysis pass to the next.
                if (declaration.declaredType) {
                    this._declarations[declIndex].declaredType = declaration.declaredType;
                }
            } else {
                this._declarations.push(declaration);
            }
        } else {
            this._declarations = [declaration];
        }
    }

    getDeclarationCount() {
        return this._declarations ? this._declarations.length : 0;
    }

    hasDeclarations() {
        return this.getDeclarationCount() > 0;
    }

    getDeclarations() {
        return this._declarations ? this._declarations : [];
    }
}

// Maps names to symbol information.
export class SymbolTable extends StringMap<Symbol> {}

// Use this helper method rather than symbolTable.set() if
// it's important to preserve the "isAccessed" state of the
// previous symbol that the new symbol is replacing.
export function setSymbolPreservingAccess(symbolTable: SymbolTable, name: string, symbol: Symbol) {
    const oldSymbol = symbolTable.get(name);
    symbolTable.set(name, symbol);
    if (oldSymbol && oldSymbol.isAccessed()) {
        symbol.setIsAccessed();
    }
}
