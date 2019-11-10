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

import StringMap from '../common/stringMap';
import { Declaration } from './declaration';
import { areDeclarationsSame, hasTypeForDeclaration } from './declarationUtils';
import { Type } from './types';

export const enum SymbolFlags {
    None = 0,

    // Indicates that the symbol is unbound at the start of
    // execution. Some symbols are initialized by the module
    // loader, so they are bound even before the first statement
    // in the module is executed.
    InitiallyUnbound = 1 << 0,

    // Indicates that the symbol is not visible from other files.
    // Used for module-level symbols.
    ExternallyHidden = 1 << 1,

    // Indicates that the symbol is a class member (used for
    // classes).
    ClassMember = 1 << 2,

    // Indicates that the symbol is a class member (used for
    // classes).
    InstanceMember = 1 << 3,

    // Indicates that the symbol is considered "private" to the
    // class and should not be accessed outside or overridden.
    PrivateMember = 1 << 4,

    // Indicates that the symbol is not considered for protocol
    // matching. This applies to some built-in symbols like __class__.
    IgnoredForProtocolMatch = 1 << 5
}

let nextSymbolId = 1;
function getUniqueSymbolId() {
    return nextSymbolId++;
}

// Symbol ID that indicates that there is no specific symbol.
export const indeterminateSymbolId = 0;

export class Symbol {
    // Information about the node that declared the value -
    // i.e. where the editor will take the user if "show definition"
    // is selected. Multiple declarations can exist for variables,
    // properties, and functions (in the case of @overload).
    private _declarations?: Declaration[];

    // Flags that provide information about the symbol.
    private _flags: SymbolFlags;

    // Unique numeric ID for each symbol allocated.
    private _id: number;

    // Symbols that are completely synthesized (i.e. have no
    // corresponding declarations in the program) can have
    // a specified type.
    private _undeclaredType?: Type;

    constructor(flags = SymbolFlags.ClassMember) {
        this._id = getUniqueSymbolId();
        this._flags = flags;
    }

    static createWithType(flags: SymbolFlags, type: Type) {
        const newSymbol = new Symbol(flags);
        newSymbol._undeclaredType = type;
        return newSymbol;
    }

    getId() {
        return this._id;
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

    setIsIgnoredForProtocolMatch() {
        this._flags |= SymbolFlags.IgnoredForProtocolMatch;
    }

    isIgnoredForProtocolMatch() {
        return !!(this._flags & SymbolFlags.IgnoredForProtocolMatch);
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

    setIsPrivateMember() {
        this._flags |= SymbolFlags.PrivateMember;
    }

    isPrivateMember() {
        return !!(this._flags & SymbolFlags.PrivateMember);
    }

    addDeclaration(declaration: Declaration) {
        if (this._declarations) {
            // See if this node was already identified as a declaration. If so,
            // replace it. Otherwise, add it as a new declaration to the end of
            // the list.
            const declIndex = this._declarations.findIndex(
                decl => areDeclarationsSame(decl, declaration));
            if (declIndex < 0) {
                this._declarations.push(declaration);
            } else {
                // If the new declaration has a defined type, it should replace
                // the existing one.
                if (hasTypeForDeclaration(declaration)) {
                    this._declarations[declIndex] = declaration;
                }
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

    hasTypedDeclarations() {
        // We'll treat an undeclared type as an implicit declaration.
        if (this._undeclaredType) {
            return true;
        }

        return this.getDeclarations().some(
            decl => hasTypeForDeclaration(decl));
    }

    getTypedDeclarations() {
        return this.getDeclarations().filter(
            decl => hasTypeForDeclaration(decl));
    }

    getUndeclaredType() {
        return this._undeclaredType;
    }
}

// Maps names to symbol information.
export class SymbolTable extends StringMap<Symbol> {}
