/*
 * scope.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Represents an evaluation scope and its defined symbols.
 * It also contains a link to a parent scope (except for the
 * top-most built-in scope).
 */

import { fail } from '../common/debug';
import { DeclarationType } from './declaration';
import { Symbol, SymbolFlags, SymbolTable } from './symbol';

export const enum ScopeType {
    // Used for list comprehension nodes.
    ListComprehension,

    // Function scopes are used for lambdas and functions.
    Function,

    // Class scopes are used for classes.
    Class,

    // Module scopes are used for modules.
    Module,

    // Built-in scopes are used for all ambient symbols provided
    // by the Python environment.
    Builtin,
}

export const enum NameBindingType {
    // With "nonlocal" keyword
    Nonlocal,

    // With "global" keyword
    Global,
}

// Provides information for recursive scope lookups.
export interface SymbolWithScope {
    // Found symbol
    symbol: Symbol;

    // Scope in which symbol was found
    scope: Scope;

    // Indicates that the recursion needed to proceed
    // outside of the module's scope into the builtins
    // scope.
    isOutsideCallerModule: boolean;

    // Indicates that the recursion needed to proceed
    // to a scope that is beyond the current execution
    // scope. An execution scope is defined as a function,
    // module, or lambda. Classes are not considered execution
    // scopes because they are "executed" immediately as
    // part of the scope in which they are contained.
    isBeyondExecutionScope: boolean;
}

export class Scope {
    // The scope type, as defined in the enumeration.
    readonly type: ScopeType;

    // The next scope in the hierarchy or undefined if it's the
    // top-most scope.
    readonly parent: Scope | undefined;

    // Association between names and symbols.
    readonly symbolTable: SymbolTable = new Map<string, Symbol>();

    // Names within this scope that are bound to other scopes
    // (either nonlocal or global).
    readonly notLocalBindings = new Map<string, NameBindingType>();

    // Names defined by __slots__ within this scope (used only
    // for class scopes).
    slotsNames: string[] | undefined;

    constructor(type: ScopeType, parent?: Scope) {
        this.type = type;
        this.parent = parent;
    }

    getGlobalScope(): Scope {
        let curScope: Scope | undefined = this;
        while (curScope) {
            if (curScope.type === ScopeType.Module || curScope.type === ScopeType.Builtin) {
                return curScope;
            }

            curScope = curScope.parent;
        }

        fail('failed to find scope');
        return this;
    }

    // Independently-executable scopes are those that are executed independently
    // of their parent scopes. Classes are executed in the context of their parent
    // scope, so they don't fit this category.
    isIndependentlyExecutable(): boolean {
        return this.type === ScopeType.Module || this.type === ScopeType.Function;
    }

    lookUpSymbol(name: string): Symbol | undefined {
        return this.symbolTable.get(name);
    }

    lookUpSymbolRecursive(
        name: string,
        isOutsideCallerModule = false,
        isBeyondExecutionScope = false
    ): SymbolWithScope | undefined {
        const symbol = this.symbolTable.get(name);

        if (symbol) {
            // If we're searching outside of the original caller's module (global) scope,
            // hide any names that are not meant to be visible to importers.
            if (isOutsideCallerModule && symbol.isExternallyHidden()) {
                return undefined;
            }

            // If the symbol is a class variable that is defined only in terms of
            // member accesses, it is not accessible directly by name, so hide it.
            const decls = symbol.getDeclarations();
            if (
                decls.length === 0 ||
                decls.some((decl) => decl.type !== DeclarationType.Variable || !decl.isDefinedByMemberAccess)
            ) {
                return {
                    symbol,
                    isOutsideCallerModule,
                    isBeyondExecutionScope,
                    scope: this,
                };
            }
        }

        let parentScope: Scope | undefined;
        if (this.notLocalBindings.get(name) === NameBindingType.Global) {
            parentScope = this.getGlobalScope();
        } else {
            parentScope = this.parent;
        }

        if (parentScope) {
            // If our recursion is about to take us outside the scope of the current
            // module (i.e. into a built-in scope), indicate as such with the second
            // parameter.
            return parentScope.lookUpSymbolRecursive(
                name,
                isOutsideCallerModule || this.type === ScopeType.Module,
                isBeyondExecutionScope || this.isIndependentlyExecutable()
            );
        }

        return undefined;
    }

    addSymbol(name: string, flags: SymbolFlags): Symbol {
        const symbol = new Symbol(flags);
        this.symbolTable.set(name, symbol);
        return symbol;
    }

    getBindingType(name: string) {
        return this.notLocalBindings.get(name);
    }

    setBindingType(name: string, bindingType: NameBindingType) {
        return this.notLocalBindings.set(name, bindingType);
    }

    setSlotsNames(names: string[]) {
        this.slotsNames = names;
    }

    getSlotsNames(): string[] | undefined {
        return this.slotsNames;
    }
}
