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
import { Type, TypeCategory } from './types';

export enum SymbolCategory {
    Variable,
    Import,
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

    // Type currently bound to the name as analyzer progresses through
    // the code flow. Can be UnboundType.
    currentType: Type;

    // Indicates that the type is conditionally bound (e.g. inside of an
    // if statement). Used during analysis to determine how and whether to
    // merge types. For example, if both parts of an if/else statement
    // conditionally set a value, the combination of the two is unconditional.
    // This is used only in temporary scopes.
    isConditional?: boolean;

    constructor(currentType: Type, typeSourceId: TypeSourceId) {
        this.currentType = currentType;
        this.addInferredType(currentType, typeSourceId);
    }

    // Returns true if inferred type changed.
    setCurrentType(currentType: Type, typeSourceId: TypeSourceId): boolean {
        this.currentType = currentType;
        return this.addInferredType(currentType, typeSourceId);
    }

    // Returns true if inferred type changed.
    addInferredType(type: Type, typeSourceId: TypeSourceId): boolean {
        if (type.category !== TypeCategory.Unbound) {
            return this.inferredType.addSource(type, typeSourceId);
        }

        return false;
    }

    addDeclaration(declaration: Declaration) {
        if (this.declarations) {
            // See if this node was already identified as a declaration. If so,
            // replace it. Otherwise, add it as a new declaration to the end of
            // the list.
            let declIndex = this.declarations.findIndex(decl => decl.node === declaration.node);
            if (declIndex >= 0) {
                this.declarations[declIndex] = declaration;
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
