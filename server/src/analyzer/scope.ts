/*
* scope.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Represents a symbolic scope and its defined symbols. Unlike
* a "Namespace", a scope object tracks dynamic (runtime)
* bindings between names types. The analyzer stores these types
* in the scope as it walks through the program, effective doing
* what the Python interpreter will do.
*/

import * as assert from 'assert';

import { Declaration } from './declaration';
import { InferredType } from './inferredType';
import { setSymbolPreservingAccess, Symbol, SymbolTable } from './symbol';
import { TypeConstraint } from './typeConstraint';
import { TypeConstraintUtils } from './typeConstraintUtils';

export enum ScopeType {
    // Temporary scopes are used temporarily during analysis
    // to represent conditional blocks.
    Temporary,

    // Function scopes are used for lambdas and functions.
    Function,

    // Class scopes are used for classes.
    Class,

    // Module scopes are used for modules.
    Module,

    // Built-in scopes are used for all ambient symbols provided
    // by the Python environment.
    BuiltIn
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
    // scope. An execution scope is defined as a function
    // or a module. Classes are not considered execution
    // scopes because they are "executed" immediately as
    // part of the scope in which they are contained.
    isBeyondExecutionScope: boolean;
}

export class Scope {
    // The scope type, as defined in the enumeration.
    private _scopeType: ScopeType;

    // The next scope in the hierarchy or undefined if it's the
    // top-most scope.
    private _parent?: Scope;

    // Associations between names, type, and declarations.
    private _symbolTable: SymbolTable = new SymbolTable();

    // Names not in _exportFilterMap will be hidden from child scopes.
    private _exportFilterMap: { [name: string]: string } | undefined;

    // Indicates whether the scope is conditionally executed
    // (i.e. is not guaranteed to be executed).
    private _isConditional: boolean;

    // Indicates whether the scope is associated with a looping
    // construct like while or for.
    private _isLooping = false;

    // Tracks whether the code flow for the scope always returns
    // before exiting the block.
    private _alwaysReturns = false;

    // Tracks whether the code flow for the scope always raises
    // an exception before exiting the block.
    private _alwaysRaises = false;

    // Tracks whether a "break" statement was executed within
    // the loop.
    private _mayBreak = false;

    // Tracks whether a "break" statement is always executed
    // along all paths within this scope.
    private _alwaysBreaks = false;

    // Inferred return and yield types for the scope.
    private _returnType = new InferredType();
    private _yieldType = new InferredType();

    // Active type constraints for this scope -- used for conditional
    // scopes where the condition constrains the types of certain
    // expressions.
    private _typeConstraints: TypeConstraint[] = [];

    // Groups of type constriants that are active at the time
    // a loop continuation is encountered. This can be an explicit
    // "continue" statement or an implicit continue at the bottom
    // of a loop. This is used only for looping scopes
    // (_isLooping is true).
    private _continueTypeConstraints: TypeConstraint[][] = [];

    // Groups of type constraints that are active at the time
    // a loop break is encountered. This includes explicit
    // "break" statements or an implicit break a the top of
    // a loop. This is used only for looping scopes
    // (_isLooping is true).
    private _breakTypeConstraints: TypeConstraint[][] = [];

    constructor(type: ScopeType, parent?: Scope) {
        this._scopeType = type;
        this._parent = parent;
        this._isConditional = false;
    }

    setExportFilter(namesToExport: string[]) {
        this._exportFilterMap = {};
        for (const name of namesToExport) {
            this._exportFilterMap[name] = name;
        }
    }

    getSymbolTable(filterNonexports = false): SymbolTable {
        if (filterNonexports && this._exportFilterMap) {
            const filteredSymbolTable = new SymbolTable();
            this._symbolTable.forEach((symbol, name) => {
                if (!this.isSymbolExported(name)) {
                    filteredSymbolTable.set(name, symbol);
                }
            });
            return filteredSymbolTable;
        }
        return this._symbolTable;
    }

    isSymbolExported(name: string) {
        if (!this._exportFilterMap) {
            return true;
        }

        if (this._exportFilterMap[name]) {
            return true;
        }

        return false;
    }

    getSymbols(): string[] {
        return this._symbolTable.getKeys();
    }

    getType(): ScopeType {
        return this._scopeType;
    }

    getParent(): Scope | undefined {
        return this._parent;
    }

    setParent(scope?: Scope) {
        this._parent = scope;
    }

    getReturnType(): InferredType {
        return this._returnType;
    }

    getYieldType(): InferredType {
        return this._yieldType;
    }

    setConditional() {
        // Only temporary scopes can be conditional.
        assert(this._scopeType === ScopeType.Temporary);
        this._isConditional = true;
    }

    setUnconditional() {
        // Only temporary scopes can be conditional.
        assert(this._scopeType === ScopeType.Temporary);
        this._isConditional = false;
    }

    isConditional() {
        return this._isConditional;
    }

    // Independently-executable scopes are those that are executed independently
    // of their parent scopes. Classes and temporary scopes are executed in the
    // context of their parent scope, so they don't fit this category.
    isIndependentlyExecutable(): boolean {
        return this._scopeType === ScopeType.Module ||
            this._scopeType === ScopeType.Function;
    }

    setIsLooping() {
        this._isLooping = true;
    }

    lookUpSymbol(name: string): Symbol | undefined {
        return this._symbolTable.get(name);
    }

    lookUpSymbolRecursive(name: string): SymbolWithScope | undefined {
        return this._lookUpSymbolRecursiveInternal(name, false, false);
    }

    // Adds a new untyped symbol to the scope.
    addSymbol(name: string, isInitiallyUnbound: boolean): Symbol {
        const symbol = new Symbol(isInitiallyUnbound);
        setSymbolPreservingAccess(this._symbolTable, name, symbol);
        return symbol;
    }

    addSymbolDeclaration(name: string, declaration: Declaration) {
        const symbol = this._symbolTable.get(name)!;
        assert(symbol !== undefined);

        symbol.addDeclaration(declaration);
    }

    // Merges a specified temporary scope into another scope (which is
    // assumed to be its parent or a direct ancestor). Returns true if
    // a scope was modified in a meaningful way.
    mergeScope(scopeToMerge: Scope) {
        assert(scopeToMerge.getType() === ScopeType.Temporary);

        // If the scope we're merging isn't conditional, transfer
        // the return and raises flags.
        if (!scopeToMerge._isConditional) {
            if (scopeToMerge.getAlwaysReturns()) {
                this.setAlwaysReturns();
            }

            if (scopeToMerge.getAlwaysRaises()) {
                this.setAlwaysRaises();
            }
        }

        // If the scope we're merging isn't a looping scope,
        // transfer the break to the this scope. This allows the break
        // to propagate to the nearest looping scope but no further.
        if (!scopeToMerge._isLooping) {
            if (scopeToMerge._mayBreak) {
                this._mayBreak = true;
            }

            if (scopeToMerge._alwaysBreaks) {
                this._alwaysBreaks = true;
            }
        }

        const typeConstraints = TypeConstraintUtils.dedupeTypeConstraints(
            scopeToMerge.getTypeConstraints(), scopeToMerge.isConditional());
        this.addTypeConstraints(typeConstraints);
    }

    // Combines multiple conditional scopes -- for example, an "if" scope
    // with an "else" scope.
    static combineConditionalScopes(scopes: Scope[]): Scope {
        assert(scopes.length > 1);

        const parentScope = scopes[0]._parent;
        for (const scope of scopes) {
            assert(scope._isConditional);
            assert(scope._scopeType === ScopeType.Temporary);
            assert(scope._parent === parentScope);
        }

        const combinedScope = new Scope(ScopeType.Temporary, parentScope);

        // Combine type constraints from the scopes.
        const contributingTypeConstraints = scopes.filter(s => !s.getAlwaysReturnsOrRaises());
        const combinedTypeConstraints = TypeConstraintUtils.combineTypeConstraints(
            contributingTypeConstraints.map(s => s.getTypeConstraints()));
        combinedScope.addTypeConstraints(combinedTypeConstraints);

        // Combine the return and yield types and break flags.
        combinedScope._alwaysBreaks = scopes.length > 0;
        for (const scope of scopes) {
            combinedScope._returnType.addSources(scope._returnType);
            combinedScope._yieldType.addSources(scope._yieldType);

            if (scope._mayBreak) {
                combinedScope._mayBreak = true;
            }

            if (!scope._alwaysRaises && !scope._alwaysReturns && !scope._alwaysBreaks) {
                combinedScope._alwaysBreaks = false;
            }
        }

        return combinedScope;
    }

    mergeReturnType(scopeToMerge: Scope): boolean {
        return this._returnType.addSources(scopeToMerge._returnType);
    }

    mergeYieldType(scopeToMerge: Scope): boolean {
        return this._yieldType.addSources(scopeToMerge._yieldType);
    }

    setAlwaysReturns() {
        this._alwaysReturns = true;
    }

    clearAlwaysReturns() {
        this._alwaysReturns = false;
    }

    getAlwaysReturns() {
        return this._alwaysReturns;
    }

    setAlwaysRaises() {
        this._alwaysRaises = true;
    }

    clearAlwaysRaises() {
        this._alwaysRaises = false;
    }

    getAlwaysRaises() {
        return this._alwaysRaises;
    }

    getAlwaysReturnsOrRaises() {
        return this._alwaysReturns || this._alwaysRaises;
    }

    setMayBreak() {
        this._mayBreak = true;
    }

    getMayBreak() {
        return this._mayBreak;
    }

    clearBreaks() {
        this._mayBreak = false;
        this._alwaysBreaks = false;
    }

    setAlwaysBreaks() {
        this._alwaysBreaks = true;
    }

    getAlwaysBreaks() {
        return this._alwaysBreaks;
    }

    getTypeConstraints() {
        return this._typeConstraints;
    }

    addTypeConstraint(constraint: TypeConstraint) {
        this._typeConstraints.push(constraint);
    }

    clearTypeConstraints() {
        this._typeConstraints = [];
        this._continueTypeConstraints = [];
        this._breakTypeConstraints = [];
    }

    addTypeConstraints(constraints: TypeConstraint[]) {
        constraints.forEach(constraint => {
            this.addTypeConstraint(constraint);
        });
    }

    setTypeConstraints(constraints: TypeConstraint[]) {
        this._typeConstraints = [];
        this.addTypeConstraints(constraints);
    }

    snapshotTypeConstraintsForBreak() {
        const snapshot = this._snapshotTypeConstraintsForLoop();
        const loopScope = this._getFirstLoopScope();
        if (loopScope) {
            loopScope._breakTypeConstraints.push(snapshot);
        }
    }

    snapshotTypeConstraintsForContinue() {
        const snapshot = this._snapshotTypeConstraintsForLoop();
        const loopScope = this._getFirstLoopScope();
        if (loopScope) {
            loopScope._continueTypeConstraints.push(snapshot);
        }
    }

    combineContinueTypeConstraints() {
        const combinedTCs = TypeConstraintUtils.combineTypeConstraints(this._continueTypeConstraints);

        // Dedup and mark conditional because continue type constraints
        // are always combined conditionally with incoming type constraints
        // at the top of the loop.
        return TypeConstraintUtils.dedupeTypeConstraints(combinedTCs, true);
    }

    combineBreakTypeConstraints() {
        const combinedTCs = TypeConstraintUtils.combineTypeConstraints(this._breakTypeConstraints);
        return TypeConstraintUtils.dedupeTypeConstraints(combinedTCs);
    }

    // Returns the first looping scope in the hierarchy starting
    // with the current scope.
    private _getFirstLoopScope() {
        let curScope: Scope | undefined = this;

        while (curScope) {
            // If the scope always breaks, raises or returns, we can't
            // get to the current location, so return undefined to
            // indicate that the caller shouldn't bother.
            if (curScope._alwaysBreaks || curScope._alwaysRaises || curScope._alwaysReturns) {
                return undefined;
            }

            if (curScope._isLooping) {
                return curScope;
            }

            curScope = curScope.getParent();
        }

        return undefined;
    }

    // Combines all of the type constraints for this scope
    // and all parent scopes up to and including the first
    // looping scope encountered in the scope hierarchy.
    private _snapshotTypeConstraintsForLoop(): TypeConstraint[] {
        // Create a list of scopes to explore.
        const scopeList: Scope[] = [];
        let curScope: Scope | undefined = this;
        while (curScope) {
            scopeList.push(curScope);
            if (curScope._isLooping) {
                break;
            }
            curScope = curScope.getParent();
        }

        // We didn't find a looping scope, so return an empty list.
        if (!curScope) {
            return [];
        }

        const constraints: TypeConstraint[] = [];
        let isConditional = false;

        // Now append the type constraints starting with the
        // outermost scope moving inward.
        while (scopeList.length > 0) {
            const curScope = scopeList.pop()!;
            let localContraints = curScope.getTypeConstraints();
            localContraints = localContraints.map(c => isConditional ? c.cloneAsConditional() : c);
            constraints.push(...localContraints);

            if (curScope.isConditional()) {
                isConditional = true;
            }
        }

        return TypeConstraintUtils.dedupeTypeConstraints(constraints);
    }

    private _lookUpSymbolRecursiveInternal(name: string, isOutsideCallerModule: boolean,
            isBeyondExecutionScope: boolean): SymbolWithScope | undefined {

        // If we're searching outside of the original caller's module (global) scope,
        // hide any names that are not meant to be visible to importers.
        if (isOutsideCallerModule && this._exportFilterMap && !this._exportFilterMap[name]) {
            return undefined;
        }

        const symbol = this._symbolTable.get(name);
        if (symbol) {
            return {
                symbol,
                isOutsideCallerModule,
                isBeyondExecutionScope,
                scope: this
            };
        }

        if (this._parent) {
            // If our recursion is about to take us outside the scope of the current
            // module (i.e. into a built-in scope), indicate as such with the second
            // parameter.
            return this._parent._lookUpSymbolRecursiveInternal(name,
                isOutsideCallerModule || this._scopeType === ScopeType.Module,
                isBeyondExecutionScope || this.isIndependentlyExecutable());
        }

        return undefined;
    }
}
