/*
 * typeVarContext.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Module that records the relationship between type variables and their
 * types. It is used by the constraint solver to solve for the type of
 * each type variable.
 */

import { assert } from '../common/debug';
import { getComplexityScoreForType } from './typeComplexity';
import {
    FunctionType,
    InScopePlaceholderScopeId,
    ParamSpecType,
    Type,
    TypeVarScopeId,
    TypeVarType,
    isAnyOrUnknown,
    isFunction,
    isParamSpec,
    isTypeSame,
} from './types';

// The maximum number of solution sets that can be associated
// with a TypeVarContext. This equates to the number of overloads
// that can be captured by a ParamSpec (or multiple ParamSpecs).
// We should never hit this limit in practice, but there are certain
// pathological cases where we could, and we need to protect against
// this so it doesn't completely exhaust memory. This was previously
// set to 64, but we have seen cases where a library uses in excess
// of 300 overloads on a single function.
const maxSolutionSetCount = 1024;

// Records information that is used to solve for the type of a type variable.
export interface TypeVarSolution {
    // The type variable being solved.
    typeVar: TypeVarType;

    // Running bounds for the solved type variable as constraints are added.

    // The final type must "fit" between the lower and upper bound.
    // If there are literal subtypes in the lower bound, these are stripped,
    // and the resulting type is placed in lowerBoundNoLiterals as
    // long as it does not exceed the upper bound.
    lowerBound?: Type | undefined;
    lowerBoundNoLiterals?: Type | undefined;
    upperBound?: Type | undefined;
}

// Records the solution information for a set of type variables associated
// with a callee's signature.
export class TypeVarSolutionSet {
    private _typeVarMap: Map<string, TypeVarSolution>;

    // A set of one or more TypeVar scope IDs that identify this solution set.
    // This corresponds to the scope ID of the overload signature. Normally
    // there will be only one scope ID associated with each signature, but
    // we can have multiple if we are solving for multiple ParamSpecs. If
    // there are two ParamSpecs P1 and P2 and both are bound to 3 overloads,
    // we'll have 9 sets of TypeVars that we're solving, for all combinations
    // of P1 and P2).
    private _scopeIds: Set<string> | undefined;

    constructor() {
        this._typeVarMap = new Map<string, TypeVarSolution>();
    }

    clone() {
        const solutionSet = new TypeVarSolutionSet();

        this._typeVarMap.forEach((value) => {
            solutionSet.setTypeVarType(value.typeVar, value.lowerBound, value.lowerBoundNoLiterals, value.upperBound);
        });

        if (this._scopeIds) {
            this._scopeIds.forEach((scopeId) => solutionSet.addScopeId(scopeId));
        }

        return solutionSet;
    }

    isSame(other: TypeVarSolutionSet) {
        if (this._typeVarMap.size !== other._typeVarMap.size) {
            return false;
        }

        function typesMatch(type1: Type | undefined, type2: Type | undefined) {
            if (!type1 || !type2) {
                return type1 === type2;
            }

            return isTypeSame(type1, type2);
        }

        let isSame = true;
        this._typeVarMap.forEach((value, key) => {
            const otherValue = other._typeVarMap.get(key);
            if (
                !otherValue ||
                !typesMatch(value.lowerBound, otherValue.lowerBound) ||
                !typesMatch(value.upperBound, otherValue.upperBound)
            ) {
                isSame = false;
            }
        });

        return isSame;
    }

    isEmpty() {
        return this._typeVarMap.size === 0;
    }

    // Provides a "score" - a value that values completeness (number
    // of type variables that are assigned) and simplicity.
    getScore() {
        let score = 0;

        // Sum the scores for the defined type vars.
        this._typeVarMap.forEach((value) => {
            // Add 1 to the score for each type variable defined.
            score += 1;

            // Add a fractional amount based on the simplicity of the definition.
            // The more complex, the lower the score. In the spirit of Occam's
            // Razor, we always want to favor simple answers.
            const typeVarType = this.getTypeVarType(value.typeVar)!;
            score += 1.0 - getComplexityScoreForType(typeVarType);
        });

        return score;
    }

    getTypeVarType(reference: ParamSpecType): FunctionType | undefined;
    getTypeVarType(reference: TypeVarType, useLowerBoundOnly?: boolean): Type | undefined;
    getTypeVarType(reference: TypeVarType, useLowerBoundOnly = false): Type | undefined {
        const entry = this.getTypeVar(reference);
        if (!entry) {
            return undefined;
        }

        if (isParamSpec(reference)) {
            if (!entry.lowerBound) {
                return undefined;
            }

            if (isFunction(entry.lowerBound)) {
                return entry.lowerBound;
            }

            if (isAnyOrUnknown(entry.lowerBound)) {
                return ParamSpecType.getUnknown();
            }
        }

        if (useLowerBoundOnly) {
            return entry.lowerBound;
        }

        // Prefer the lower bound with no literals. It will be undefined
        // if the literal type couldn't be widened due to constraints imposed
        // by the upper bound.
        return entry.lowerBoundNoLiterals ?? entry.lowerBound ?? entry.upperBound;
    }

    setTypeVarType(
        reference: TypeVarType,
        lowerBound: Type | undefined,
        lowerBoundNoLiterals?: Type,
        upperBound?: Type
    ) {
        const key = TypeVarType.getNameWithScope(reference);
        this._typeVarMap.set(key, {
            typeVar: reference,
            lowerBound,
            lowerBoundNoLiterals,
            upperBound,
        });
    }

    getTypeVar(reference: TypeVarType): TypeVarSolution | undefined {
        const key = TypeVarType.getNameWithScope(reference);
        return this._typeVarMap.get(key);
    }

    getTypeVars(): TypeVarSolution[] {
        const entries: TypeVarSolution[] = [];

        this._typeVarMap.forEach((entry) => {
            entries.push(entry);
        });

        return entries;
    }

    addScopeId(scopeId: TypeVarScopeId) {
        if (!this._scopeIds) {
            this._scopeIds = new Set<string>();
        }

        this._scopeIds.add(scopeId);
    }

    hasScopeId(scopeId: TypeVarScopeId) {
        if (!this._scopeIds) {
            return false;
        }

        return this._scopeIds.has(scopeId);
    }
}

export class TypeVarContext {
    private _solveForScopes: TypeVarScopeId[] | undefined;
    private _isLocked = false;
    private _solutionSets: TypeVarSolutionSet[];

    constructor(solveForScopes?: TypeVarScopeId[] | TypeVarScopeId) {
        if (Array.isArray(solveForScopes)) {
            this._solveForScopes = solveForScopes;
        } else if (solveForScopes !== undefined) {
            this._solveForScopes = [solveForScopes];
        } else {
            this._solveForScopes = undefined;
        }

        this._solutionSets = [new TypeVarSolutionSet()];
    }

    clone() {
        const newTypeVarMap = new TypeVarContext();
        if (this._solveForScopes) {
            newTypeVarMap._solveForScopes = Array.from(this._solveForScopes);
        }

        newTypeVarMap._solutionSets = this._solutionSets.map((solutionSet) => solutionSet.clone());
        newTypeVarMap._isLocked = this._isLocked;

        return newTypeVarMap;
    }

    cloneWithSignature(scopeId: TypeVarScopeId): TypeVarContext {
        const cloned = this.clone();

        if (scopeId) {
            const filteredSolutionSets = this._solutionSets.filter((context) => context.hasScopeId(scopeId));

            if (filteredSolutionSets.length > 0) {
                cloned._solutionSets = filteredSolutionSets;
            } else {
                cloned._solutionSets.forEach((context) => {
                    context.addScopeId(scopeId);
                });
            }
        }

        return cloned;
    }

    // Copies a cloned type var context back into this object.
    copyFromClone(clone: TypeVarContext) {
        this._solutionSets = clone._solutionSets.map((context) => context.clone());
        this._isLocked = clone._isLocked;
    }

    // Copy the specified solution sets into this type var context.
    addSolutionSets(contexts: TypeVarSolutionSet[]) {
        assert(contexts.length > 0);

        // Limit the number of solution sets. There are rare circumstances
        // where this can grow to unbounded numbers and exhaust memory.
        if (contexts.length < maxSolutionSetCount) {
            this._solutionSets = Array.from(contexts);
        }
    }

    isSame(other: TypeVarContext) {
        if (other._solutionSets.length !== this._solutionSets.length) {
            return false;
        }

        return this._solutionSets.every((solutionSet, index) => solutionSet.isSame(other._solutionSets[index]));
    }

    // Returns the list of scopes this type var map is "solving".
    getSolveForScopes() {
        return this._solveForScopes;
    }

    hasSolveForScope(scopeId: TypeVarScopeId | TypeVarScopeId[] | undefined): boolean {
        if (Array.isArray(scopeId)) {
            return scopeId.some((s) => this.hasSolveForScope(s));
        }

        if (scopeId === InScopePlaceholderScopeId) {
            return true;
        }

        return (
            scopeId !== undefined &&
            this._solveForScopes !== undefined &&
            this._solveForScopes.some((s) => s === scopeId)
        );
    }

    setSolveForScopes(scopeIds: TypeVarScopeId[]) {
        scopeIds.forEach((scopeId) => {
            this.addSolveForScope(scopeId);
        });
    }

    addSolveForScope(scopeId?: TypeVarScopeId | TypeVarScopeId[]) {
        if (Array.isArray(scopeId)) {
            scopeId.forEach((s) => this.addSolveForScope(s));
            return;
        }

        if (scopeId !== undefined && !this.hasSolveForScope(scopeId)) {
            if (!this._solveForScopes) {
                this._solveForScopes = [];
            }
            this._solveForScopes.push(scopeId);
        }
    }

    lock() {
        // Locks the type var map, preventing any further changes.
        assert(!this._isLocked);
        this._isLocked = true;
    }

    unlock() {
        // Unlocks the type var map, allowing further changes.
        this._isLocked = false;
    }

    isLocked(): boolean {
        return this._isLocked;
    }

    isEmpty() {
        return this._solutionSets.every((solutionSet) => solutionSet.isEmpty());
    }

    setTypeVarType(
        reference: TypeVarType,
        lowerBound: Type | undefined,
        lowerBoundNoLiterals?: Type,
        upperBound?: Type
    ) {
        assert(!this._isLocked);

        return this._solutionSets.forEach((solutionSet) => {
            solutionSet.setTypeVarType(reference, lowerBound, lowerBoundNoLiterals, upperBound);
        });
    }

    getScore() {
        let total = 0;

        this._solutionSets.forEach((solutionSet) => {
            total += solutionSet.getScore();
        });

        // Return the average score among all solution sets.
        return total / this._solutionSets.length;
    }

    getMainSolutionSet() {
        return this._solutionSets[0];
    }

    getSolutionSets() {
        return this._solutionSets;
    }

    doForEachSolutionSet(callback: (solutionSet: TypeVarSolutionSet, index: number) => void) {
        const wasLocked = this.isLocked();
        this.unlock();

        this.getSolutionSets().forEach((solutionSet, index) => {
            callback(solutionSet, index);
        });

        if (wasLocked) {
            this.lock();
        }
    }

    getSolutionSet(index: number) {
        assert(index >= 0 && index < this._solutionSets.length);
        return this._solutionSets[index];
    }
}
