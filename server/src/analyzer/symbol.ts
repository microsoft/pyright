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
import { InferredType, TypeSourceId } from './inferredType';
import { Type } from './types';

export class Symbol {
    // Inferred type of the symbol.
    private _inferredType: InferredType = new InferredType();

    // Information about the node that declared the value -
    // i.e. where the editor will take the user if "show definition"
    // is selected. Multiple declarations can exist for variables,
    // properties, and functions (in the case of @overload).
    private _declarations?: Declaration[];

    // Indicates that the symbol is initially unbound and can
    // later be unbound through a delete operation.
    private _isInitiallyUnbound: boolean;

    // Indicates that someone read the value of the symbol at
    // some point. This is used for unused symbol detection.
    private _isAccessed = false;

    constructor(isInitiallyUnbound: boolean) {
        this._isInitiallyUnbound = isInitiallyUnbound;
    }

    static createWithType(type: Type, typeSourceId: TypeSourceId) {
        const newSymbol = new Symbol(true);
        newSymbol.setInferredTypeForSource(type, typeSourceId);
        return newSymbol;
    }

    static areDeclarationsEqual(decl1: Declaration, decl2: Declaration) {
        return decl1.category === decl2.category &&
            decl1.node === decl2.node &&
            decl1.path === decl2.path;
    }

    isInitiallyUnbound() {
        return this._isInitiallyUnbound;
    }

    setIsAcccessed() {
        this._isAccessed = true;
    }

    isAccessed() {
        return this._isAccessed;
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
            let declIndex = this._declarations.findIndex(decl => decl.node === declaration.node);
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
        symbol.setIsAcccessed();
    }
}
