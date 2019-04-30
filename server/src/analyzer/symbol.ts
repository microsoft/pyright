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

import { DiagnosticTextRange } from '../common/diagnostic';
import StringMap from '../common/stringMap';
import { ParseNode } from '../parser/parseNodes';
import { InferredType, TypeSourceId } from './inferredType';
import { Type } from './types';

export enum SymbolCategory {
    Variable,
    Parameter,
    Function,
    Method,
    Class,
    Module
}

export interface Declaration {
    // Category of this symbol (function, variable, etc.).
    // Used by hover provider to display helpful text.
    category: SymbolCategory;

    // The node that contains the definition.
    node: ParseNode;

    // Declared type (if specified) of the symbol.
    declaredType?: Type;

    // The file and range within that file that
    // contains the declaration.
    path: string;
    range: DiagnosticTextRange;
}

export class Symbol {
    // Inferred type of the symbol.
    inferredType: InferredType = new InferredType();

    // Information about the node that declared the value -
    // i.e. where the editor will take the user if "show definition"
    // is selected. Multiple declarations can exist for variables,
    // properties, and functions (in the case of @overload).
    declarations?: Declaration[];

    static create(type: Type, typeSourceId: TypeSourceId) {
        const newSymbol = new Symbol();
        newSymbol.setTypeForSource(type, typeSourceId);
        return newSymbol;
    }

    // Returns true if inferred type changed.
    setTypeForSource(type: Type, typeSourceId: TypeSourceId): boolean {
        return this.inferredType.addSource(type, typeSourceId);
    }

    addDeclaration(declaration: Declaration) {
        if (this.declarations) {
            // See if this node was already identified as a declaration. If so,
            // replace it. Otherwise, add it as a new declaration to the end of
            // the list.
            let declIndex = this.declarations.findIndex(decl => decl.node === declaration.node);
            if (declIndex >= 0) {
                // This declaration has already been added. Update the declared
                // type if it's available. The other fields in the declaration
                // should be the same from one analysis pass to the next.
                if (declaration.declaredType) {
                    this.declarations[declIndex].declaredType = declaration.declaredType;
                }
            } else {
                this.declarations.push(declaration);
            }
        } else {
            this.declarations = [declaration];
        }
    }
}

// Maps names to symbol information.
export class SymbolTable extends StringMap<Symbol> {}
