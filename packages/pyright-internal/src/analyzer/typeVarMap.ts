/*
 * typeVarMap.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Module that records the relationship between named TypeVars
 * (type variables) and their types. It is used by the type
 * evaluator to "solve" for the type of each type variable.
 */

import { assert } from '../common/debug';
import {
    ClassType,
    maxTypeRecursionCount,
    ParamSpecValue,
    Type,
    TypeCategory,
    TypeVarScopeId,
    TypeVarType,
    WildcardTypeVarScopeId,
} from './types';
import { doForEachSubtype } from './typeUtils';

export interface TypeVarMapEntry {
    typeVar: TypeVarType;

    // The final type must "fit" between the narrow and
    // wide type bound.
    narrowBound?: Type;
    wideBound?: Type;

    retainLiteral?: boolean;
}

export interface ParamSpecMapEntry {
    paramSpec: TypeVarType;
    type: ParamSpecValue;
}

export interface VariadicTypeVarMapEntry {
    typeVar: TypeVarType;
    types: Type[];
}

export class TypeVarMap {
    private _solveForScopes: TypeVarScopeId[] | undefined;
    private _typeVarMap: Map<string, TypeVarMapEntry>;
    private _variadicTypeVarMap: Map<string, VariadicTypeVarMapEntry> | undefined;
    private _paramSpecMap: Map<string, ParamSpecMapEntry>;
    private _isLocked = false;

    constructor(solveForScopes?: TypeVarScopeId[] | TypeVarScopeId) {
        if (Array.isArray(solveForScopes)) {
            this._solveForScopes = solveForScopes;
        } else if (solveForScopes !== undefined) {
            this._solveForScopes = [solveForScopes];
        } else {
            this._solveForScopes = undefined;
        }

        this._typeVarMap = new Map<string, TypeVarMapEntry>();
        this._paramSpecMap = new Map<string, ParamSpecMapEntry>();
    }

    clone() {
        const newTypeVarMap = new TypeVarMap();
        if (this._solveForScopes) {
            newTypeVarMap._solveForScopes = [...this._solveForScopes];
        }

        this._typeVarMap.forEach((value) => {
            newTypeVarMap.setTypeVarType(value.typeVar, value.narrowBound, value.wideBound, value.retainLiteral);
        });

        this._paramSpecMap.forEach((value) => {
            newTypeVarMap.setParamSpec(value.paramSpec, value.type);
        });

        if (this._variadicTypeVarMap) {
            this._variadicTypeVarMap.forEach((value) => {
                newTypeVarMap.setVariadicTypeVar(value.typeVar, value.types);
            });
        }

        newTypeVarMap._isLocked = this._isLocked;

        return newTypeVarMap;
    }

    // Copies a cloned type var map back into this object.
    copyFromClone(clone: TypeVarMap) {
        this._typeVarMap = clone._typeVarMap;
        this._paramSpecMap = clone._paramSpecMap;
        this._variadicTypeVarMap = clone._variadicTypeVarMap;
        this._isLocked = clone._isLocked;
    }

    // Returns the list of scopes this type var map is "solving".
    getSolveForScopes() {
        return this._solveForScopes;
    }

    hasSolveForScope(scopeId: TypeVarScopeId | undefined) {
        return (
            scopeId !== undefined &&
            this._solveForScopes !== undefined &&
            this._solveForScopes.some((s) => s === scopeId || s === WildcardTypeVarScopeId)
        );
    }

    setSolveForScopes(scopeIds: TypeVarScopeId[]) {
        this._solveForScopes = scopeIds;
    }

    addSolveForScope(scopeId?: TypeVarScopeId) {
        if (scopeId !== undefined && !this.hasSolveForScope(scopeId)) {
            if (!this._solveForScopes) {
                this._solveForScopes = [];
            }
            this._solveForScopes.push(scopeId);
        }
    }

    isEmpty() {
        return this._typeVarMap.size === 0 && this._paramSpecMap.size === 0;
    }

    // Provides a "score" - a value that values completeness (number
    // of type variables that are assigned) and completeness.
    getScore() {
        let score = 0;

        // Sum the scores for the defined type vars.
        this._typeVarMap.forEach((value) => {
            // Add 1 to the score for each type variable defined.
            score += 1;

            // Add a fractional amount based on the complexity of the definition.
            // The more complex, the lower the score. In the spirit of Occam's
            // Razor, we always want to favor simple answers.
            const typeVarType = this.getTypeVarType(value.typeVar)!;
            score += this._getComplexityScoreForType(typeVarType);
        });

        score += this._paramSpecMap.size;

        return score;
    }

    hasTypeVar(reference: TypeVarType): boolean {
        return this._typeVarMap.has(this._getKey(reference));
    }

    getTypeVarType(reference: TypeVarType, useNarrowBoundOnly = false): Type | undefined {
        const entry = this._typeVarMap.get(this._getKey(reference));
        if (!entry) {
            return undefined;
        }
        if (entry.narrowBound) {
            return entry.narrowBound;
        }
        if (!useNarrowBoundOnly) {
            return entry.wideBound;
        }
        return undefined;
    }

    setTypeVarType(reference: TypeVarType, narrowBound: Type | undefined, wideBound?: Type, retainLiteral?: boolean) {
        assert(!this._isLocked);
        const key = this._getKey(reference);
        this._typeVarMap.set(key, { typeVar: reference, narrowBound, wideBound, retainLiteral });
    }

    getVariadicTypeVar(reference: TypeVarType): Type[] | undefined {
        return this._variadicTypeVarMap?.get(this._getKey(reference))?.types;
    }

    setVariadicTypeVar(reference: TypeVarType, types: Type[]) {
        assert(!this._isLocked);
        const key = this._getKey(reference);

        // Allocate variadic map on demand since most classes don't use it.
        if (!this._variadicTypeVarMap) {
            this._variadicTypeVarMap = new Map<string, VariadicTypeVarMapEntry>();
        }
        this._variadicTypeVarMap.set(key, { typeVar: reference, types });
    }

    getTypeVar(reference: TypeVarType): TypeVarMapEntry | undefined {
        const key = this._getKey(reference);
        return this._typeVarMap.get(key);
    }

    getTypeVars(): TypeVarMapEntry[] {
        const entries: TypeVarMapEntry[] = [];

        this._typeVarMap.forEach((entry) => {
            entries.push(entry);
        });

        return entries;
    }

    hasParamSpec(reference: TypeVarType): boolean {
        return this._paramSpecMap.has(this._getKey(reference));
    }

    getParamSpec(reference: TypeVarType): ParamSpecValue | undefined {
        return this._paramSpecMap.get(this._getKey(reference))?.type;
    }

    setParamSpec(reference: TypeVarType, type: ParamSpecValue) {
        assert(!this._isLocked);
        this._paramSpecMap.set(this._getKey(reference), { paramSpec: reference, type });
    }

    typeVarCount() {
        return this._typeVarMap.size;
    }

    getWideTypeBound(reference: TypeVarType): Type | undefined {
        const entry = this._typeVarMap.get(this._getKey(reference));
        if (entry) {
            return entry.wideBound;
        }

        return undefined;
    }

    getRetainLiterals(reference: TypeVarType): boolean {
        const entry = this._typeVarMap.get(this._getKey(reference));
        return !!entry?.retainLiteral;
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

    private _getKey(reference: TypeVarType) {
        return TypeVarType.getNameWithScope(reference);
    }

    // Returns a "score" for a type that captures the relative complexity
    // of the type. Scores should all be between 0 and 1 where 0 means
    // very complex and 1 means simple. This is a heuristic, so there's
    // often no objectively correct answer.
    private _getComplexityScoreForType(type: Type, recursionCount = 0): number {
        if (recursionCount > maxTypeRecursionCount) {
            return 0;
        }

        switch (type.category) {
            case TypeCategory.Function:
            case TypeCategory.OverloadedFunction: {
                // For now, return a constant for functions. We may want
                // to make this heuristic in the future.
                return 0.5;
            }

            case TypeCategory.Union: {
                let minScore = 1;

                // If this union has a very large number of subtypes, don't bother
                // accurately computing the score. Assume a fixed value.
                if (type.subtypes.length < 16) {
                    doForEachSubtype(type, (subtype) => {
                        const subtypeScore = this._getComplexityScoreForType(subtype, recursionCount + 1);
                        if (subtypeScore < minScore) {
                            minScore = subtypeScore;
                        }
                    });
                }

                // Assume that a union is more complex than a non-union,
                // and return half of the minimum score of the subtypes.
                return minScore / 2;
            }

            case TypeCategory.Class: {
                // Score a class as 0.5 plus half of the average complexity
                // score of its type arguments.
                return this._getComplexityScoreForClass(type, recursionCount + 1);
            }

            case TypeCategory.Object: {
                return this._getComplexityScoreForClass(type.classType, recursionCount + 1);
            }
        }

        // For all other types, return a score of 0.
        return 0;
    }

    private _getComplexityScoreForClass(classType: ClassType, recursionCount: number): number {
        let typeArgScoreSum = 0;
        let typeArgCount = 0;

        if (classType.tupleTypeArguments) {
            classType.tupleTypeArguments.forEach((type) => {
                typeArgScoreSum += this._getComplexityScoreForType(type, recursionCount + 1);
                typeArgCount++;
            });
        } else if (classType.typeArguments) {
            classType.typeArguments.forEach((type) => {
                typeArgScoreSum += this._getComplexityScoreForType(type, recursionCount + 1);
                typeArgCount++;
            });
        }

        let score = 0.5;
        if (typeArgCount > 0) {
            score += (typeArgScoreSum / typeArgCount) * 0.5;
        }

        return score;
    }
}
