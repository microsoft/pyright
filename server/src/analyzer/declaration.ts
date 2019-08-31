/*
* declaration.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Tracks the location within the code where a named entity
* is declared and its associated declared type (if the type
* is explicitly declared).
*/

import { DiagnosticTextRange } from '../common/diagnostic';
import { ParseNode } from '../parser/parseNodes';
import { Type } from './types';

export enum DeclarationCategory {
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
    category: DeclarationCategory;

    // The node that contains the definition.
    node?: ParseNode;

    // Declared type (if specified) of the symbol.
    declaredType?: Type;

    // Is the declaration considered "constant" (i.e.
    // reassignment is not permitted)?
    isConstant?: boolean;

    // The file and range within that file that
    // contains the declaration.
    path: string;
    range: DiagnosticTextRange;
}
