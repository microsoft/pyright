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
import { ClassNode, ExpressionNode, FunctionNode, NameNode,
    ParameterNode, ParseNode, StringListNode } from '../parser/parseNodes';
import { ModuleType, Type } from './types';

export const enum DeclarationType {
    BuiltIn,
    Variable,
    Parameter,
    Function,
    Method,
    Class,
    Alias
}

export interface DeclarationBase {
    // Category of this symbol (function, variable, etc.).
    // Used by hover provider to display helpful text.
    type: DeclarationType;

    // Many declarations have a parse node associated with them.
    node?: ParseNode;

    // The file and range within that file that
    // contains the declaration.
    path: string;
    range: DiagnosticTextRange;
}

export interface BuiltInDeclaration extends DeclarationBase {
    type: DeclarationType.BuiltIn;
    declaredType: Type;
}

export interface ClassDeclaration extends DeclarationBase {
    type: DeclarationType.Class;
    node: ClassNode;
}

export interface FunctionDeclaration extends DeclarationBase {
    type: DeclarationType.Function | DeclarationType.Method;
    node: FunctionNode;
}

export interface ParameterDeclaration extends DeclarationBase {
    type: DeclarationType.Parameter;
    node: ParameterNode;
}

export interface VariableDeclaration extends DeclarationBase {
    type: DeclarationType.Variable;
    node: NameNode | StringListNode;

    typeAnnotationNode?: ExpressionNode;

    // Is the declaration considered "constant" (i.e.
    // reassignment is not permitted)?
    isConstant?: boolean;
}

// Alias declarations are used for imports. They are resolved
// after the binding phase.
export interface AliasDeclaration extends DeclarationBase {
    type: DeclarationType.Alias;

    // If a symbol is present, the alias refers to the symbol
    // within a module (whose path is defined in the 'path'
    // field). If symbolName is missing, the alias refers to
    // the module itself.
    symbolName?: string;

    // If there is no symbol specified and the entire module
    // is referenced, should the module type include the
    // implicit imports within its namespace?
    includeImplicitImports?: boolean;
}

export type Declaration = BuiltInDeclaration | ClassDeclaration |
    FunctionDeclaration | ParameterDeclaration | VariableDeclaration |
    AliasDeclaration;
