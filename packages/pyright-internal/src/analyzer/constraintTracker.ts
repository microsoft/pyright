/*
 * constraintTracker.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Module that tracks the constraints for a set of type variables.
 * It is used by the constraint solver to solve for the type of
 * each type variable.
 */

import { assert } from '../common/debug';
import { getComplexityScoreForType } from './typeComplexity';
import { Type, TypeVarScopeId, TypeVarType, isTypeSame } from './types';

// The maximum number of constraint sets that can be associated
// with a constraint tracker. This equates to the number of overloads
// that can be captured by a ParamSpec (or multiple ParamSpecs).
// We should never hit this limit in practice, but there are certain
// pathological cases where we could, and we need to protect against
// this so it doesn't completely exhaust memory. This was previously
// set to 64, but we have seen cases where a library uses in excess
// of 300 overloads on a single function.
const maxConstraintSetCount = 1024;

// Records constraint information about a single type variable.
export interface TypeVarConstraints {
    typeVar: TypeVarType;

    // Bounds for solved type variable as constraints are added.
    lowerBound?: Type | undefined;
    upperBound?: Type | undefined;

    // Should the lower bound include literal values?
    retainLiterals?: boolean;
}

// Records the constraints information for a set of type variables
// associated with a callee's signature.
export class ConstraintSet {
    // Maps type variable IDs to their current constraints.
    private _typeVarMap: Map<string, TypeVarConstraints>;

    // A set of one or more TypeVar scope IDs that identify this constraint set.
    // This corresponds to the scope ID of the overload signature. Normally
    // there will be only one scope ID associated with each signature, but
    // we can have multiple if we are solving for multiple ParamSpecs. If
    // there are two ParamSpecs P1 and P2 and both are bound to 3 overloads,
    // we'll have 9 sets of TypeVars that we're solving, for all combinations
    // of P1 and P2).
    private _scopeIds: Set<string> | undefined;

    constructor() {
        this._typeVarMap = new Map<string, TypeVarConstraints>();
    }

    clone() {
        const constraintSet = new ConstraintSet();

        this._typeVarMap.forEach((value) => {
            constraintSet.setBounds(value.typeVar, value.lowerBound, value.upperBound, value.retainLiterals);
        });

        if (this._scopeIds) {
            this._scopeIds.forEach((scopeId) => constraintSet.addScopeId(scopeId));
        }

        return constraintSet;
    }

    isSame(other: ConstraintSet) {
        if (this._typeVarMap.size !== other._typeVarMap.size) {
            return false;
        }

        function typesMatch(type1: Type | undefined, type2: Type | undefined) {
            if (!type1 || !type2) {
                return type1 === type2;
            }

            return isTypeSame(type1, type2, { honorIsTypeArgExplicit: true, honorTypeForm: true });
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
        this._typeVarMap.forEach((entry) => {
            // Add 1 to the score for each type variable defined.
            score += 1;

            // Add a fractional amount based on the simplicity of the definition.
            // The more complex, the lower the score. In the spirit of Occam's
            // Razor, we always want to favor simple answers.
            const typeVarType = entry.lowerBound ?? entry.upperBound;
            if (typeVarType) {
                score += 1.0 - getComplexityScoreForType(typeVarType);
            }
        });

        return score;
    }

    setBounds(typeVar: TypeVarType, lowerBound: Type | undefined, upperBound?: Type, retainLiterals?: boolean) {
        const key = TypeVarType.getNameWithScope(typeVar);
        this._typeVarMap.set(key, {
            typeVar,
            lowerBound,
            upperBound,
            retainLiterals,
        });
    }

    doForEachTypeVar(cb: (entry: TypeVarConstraints) => void) {
        this._typeVarMap.forEach(cb);
    }

    getTypeVar(typeVar: TypeVarType): TypeVarConstraints | undefined {
        const key = TypeVarType.getNameWithScope(typeVar);
        return this._typeVarMap.get(key);
    }

    getTypeVars(): TypeVarConstraints[] {
        const entries: TypeVarConstraints[] = [];

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

    getScopeIds() {
        return this._scopeIds ? [...this._scopeIds] : [];
    }

    hasUnificationVars() {
        for (const entry of this._typeVarMap.values()) {
            if (TypeVarType.isUnification(entry.typeVar)) {
                return true;
            }
        }

        return false;
    }
}

export class ConstraintTracker {
    private _constraintSets: ConstraintSet[];

    constructor() {
        this._constraintSets = [new ConstraintSet()];
    }

    clone() {
        const newTypeVarMap = new ConstraintTracker();

        newTypeVarMap._constraintSets = this._constraintSets.map((set) => set.clone());

        return newTypeVarMap;
    }

    cloneWithSignature(scopeIds: TypeVarScopeId[]): ConstraintTracker {
        const cloned = this.clone();

        const nonEmptyScopeIds = scopeIds.filter((scopeId) => !!scopeId);

        if (nonEmptyScopeIds.length > 0) {
            const filteredSets = this._constraintSets.filter((context) =>
                nonEmptyScopeIds.every((scopeId) => context.hasScopeId(scopeId))
            );

            // If there are already some constraints that match the scopeIDs,
            // reuse them. Otherwise, duplicate all existing constraint sets
            // and add the new scope IDs.
            if (filteredSets.length > 0) {
                cloned._constraintSets = filteredSets;
            } else {
                cloned._constraintSets.forEach((context) => {
                    nonEmptyScopeIds.forEach((scopeId) => {
                        context.addScopeId(scopeId);
                    });
                });
            }
        }

        return cloned;
    }

    // Copies a cloned type var context back into this object.
    copyFromClone(clone: ConstraintTracker) {
        this._constraintSets = clone._constraintSets.map((context) => context.clone());
    }

    copyBounds(entry: TypeVarConstraints) {
        this._constraintSets.forEach((set) => {
            set.setBounds(entry.typeVar, entry.lowerBound, entry.upperBound, entry.retainLiterals);
        });
    }

    // Copy the specified constraint sets into this type var context.
    addConstraintSets(contexts: ConstraintSet[]) {
        assert(contexts.length > 0);

        // Limit the number of constraint sets. There are rare circumstances
        // where this can grow to unbounded numbers and exhaust memory.
        if (contexts.length < maxConstraintSetCount) {
            this._constraintSets = Array.from(contexts);
        }
    }

    isSame(other: ConstraintTracker) {
        if (other._constraintSets.length !== this._constraintSets.length) {
            return false;
        }

        return this._constraintSets.every((set, index) => set.isSame(other._constraintSets[index]));
    }

    isEmpty() {
        return this._constraintSets.every((set) => set.isEmpty());
    }

    setBounds(typeVar: TypeVarType, lowerBound: Type | undefined, upperBound?: Type, retainLiterals?: boolean) {
        return this._constraintSets.forEach((set) => {
            set.setBounds(typeVar, lowerBound, upperBound, retainLiterals);
        });
    }

    getScore() {
        let total = 0;

        this._constraintSets.forEach((set) => {
            total += set.getScore();
        });

        // Return the average score among all constraint sets.
        return total / this._constraintSets.length;
    }

    getMainConstraintSet() {
        return this._constraintSets[0];
    }

    getConstraintSets() {
        return this._constraintSets;
    }

    doForEachConstraintSet(callback: (constraintSet: ConstraintSet, index: number) => void) {
        this.getConstraintSets().forEach((set, index) => {
            callback(set, index);
        });
    }

    getConstraintSet(index: number) {
        assert(index >= 0 && index < this._constraintSets.length);
        return this._constraintSets[index];
    }
}
