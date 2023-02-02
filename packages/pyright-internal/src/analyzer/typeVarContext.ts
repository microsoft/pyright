/*
 * typeVarContext.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Module that records the relationship between type variables (and ParamSpecs)
 * and their types. It is used by the type evaluator to "solve" for the type of
 * each type variable.
 */

import { assert } from '../common/debug';
import {
    AnyType,
    ClassType,
    FunctionType,
    isFunction,
    maxTypeRecursionCount,
    TupleTypeArgument,
    Type,
    TypeCategory,
    TypeVarScopeId,
    TypeVarType,
    WildcardTypeVarScopeId,
} from './types';
import { applySolvedTypeVars, doForEachSubtype } from './typeUtils';

export interface TypeVarMapEntry {
    typeVar: TypeVarType;

    // The final type must "fit" between the narrow and wide type bound.
    // If there are literal subtypes in the narrowBound, these are stripped,
    // and the resulting widened type is placed in narrowBoundNoLiterals as
    // long as they fit within the wideBound.
    narrowBound?: Type | undefined;
    narrowBoundNoLiterals?: Type | undefined;
    wideBound?: Type | undefined;
}

export interface TupleTypeVarMapEntry {
    typeVar: TypeVarType;
    types: TupleTypeArgument[];
}

export class TypeVarContext {
    private _solveForScopes: TypeVarScopeId[] | undefined;
    private _typeVarMap: Map<string, TypeVarMapEntry>;
    private _tupleTypeVarMap: Map<string, TupleTypeVarMapEntry> | undefined;
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
    }

    clone() {
        const newTypeVarMap = new TypeVarContext();
        if (this._solveForScopes) {
            newTypeVarMap._solveForScopes = [...this._solveForScopes];
        }

        this._typeVarMap.forEach((value) => {
            newTypeVarMap.setTypeVarType(
                value.typeVar,
                value.narrowBound,
                value.narrowBoundNoLiterals,
                value.wideBound
            );
        });

        if (this._tupleTypeVarMap) {
            this._tupleTypeVarMap.forEach((value) => {
                newTypeVarMap.setTupleTypeVar(value.typeVar, value.types);
            });
        }

        newTypeVarMap._isLocked = this._isLocked;

        return newTypeVarMap;
    }

    // Copies a cloned type var map back into this object.
    copyFromClone(clone: TypeVarContext) {
        this._typeVarMap = clone._typeVarMap;
        this._tupleTypeVarMap = clone._tupleTypeVarMap;
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
            score += 1.0 - this._getComplexityScoreForType(typeVarType);
        });

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

        if (useNarrowBoundOnly) {
            return entry.narrowBound;
        }

        // Prefer the narrow version with no literals. It will be undefined
        // if the literal type couldn't be widened due to constraints imposed
        // by the wide bound.
        return entry.narrowBoundNoLiterals ?? entry.narrowBound ?? entry.wideBound;
    }

    getParamSpecType(reference: TypeVarType): FunctionType | undefined {
        const entry = this._typeVarMap.get(this._getKey(reference));
        if (!entry?.narrowBound) {
            return undefined;
        }

        if (isFunction(entry.narrowBound)) {
            return entry.narrowBound;
        }

        return undefined;
    }

    setTypeVarType(
        reference: TypeVarType,
        narrowBound: Type | undefined,
        narrowBoundNoLiterals?: Type,
        wideBound?: Type
    ) {
        assert(!this._isLocked, 'TypeVarContext is locked');
        const key = this._getKey(reference);
        this._typeVarMap.set(key, { typeVar: reference, narrowBound, narrowBoundNoLiterals, wideBound });
    }

    getTupleTypeVar(reference: TypeVarType): TupleTypeArgument[] | undefined {
        return this._tupleTypeVarMap?.get(this._getKey(reference))?.types;
    }

    setTupleTypeVar(reference: TypeVarType, types: TupleTypeArgument[]) {
        assert(!this._isLocked);
        const key = this._getKey(reference);

        // Allocate tuple TypeVar map on demand since most classes don't use it.
        if (!this._tupleTypeVarMap) {
            this._tupleTypeVarMap = new Map<string, TupleTypeVarMapEntry>();
        }
        this._tupleTypeVarMap.set(key, { typeVar: reference, types });
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

    // Applies solved TypeVars from one context to this context.
    applySourceContextTypeVars(srcContext: TypeVarContext) {
        // If there are no solved TypeVars, don't bother.
        if (srcContext.getTypeVarCount() === 0) {
            return;
        }

        const wasLocked = this.isLocked();
        this.unlock();

        this._typeVarMap.forEach((entry) => {
            const newNarrowTypeBound = entry.narrowBound
                ? applySolvedTypeVars(entry.narrowBound, srcContext)
                : undefined;
            const newNarrowTypeBoundNoLiterals = entry.narrowBoundNoLiterals
                ? applySolvedTypeVars(entry.narrowBoundNoLiterals, srcContext)
                : undefined;
            const newWideTypeBound = entry.wideBound ? applySolvedTypeVars(entry.wideBound, srcContext) : undefined;

            this.setTypeVarType(entry.typeVar, newNarrowTypeBound, newNarrowTypeBoundNoLiterals, newWideTypeBound);
        });

        this._tupleTypeVarMap?.forEach((entry) => {
            const updatedTypes: TupleTypeArgument[] = entry.types.map((arg) => {
                return { isUnbounded: arg.isUnbounded, type: applySolvedTypeVars(arg.type, srcContext) };
            });

            this.setTupleTypeVar(entry.typeVar, updatedTypes);
        });

        if (wasLocked) {
            this.lock();
        }
    }

    getTypeVarCount() {
        return this._typeVarMap.size;
    }

    getWideTypeBound(reference: TypeVarType): Type | undefined {
        const entry = this._typeVarMap.get(this._getKey(reference));
        if (entry) {
            return entry.wideBound;
        }

        return undefined;
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
    // very simple and 1 means complex. This is a heuristic, so there's
    // often no objectively correct answer.
    private _getComplexityScoreForType(type: Type, recursionCount = 0): number {
        if (recursionCount > maxTypeRecursionCount) {
            return 1;
        }
        recursionCount++;

        switch (type.category) {
            case TypeCategory.Unknown:
            case TypeCategory.Any:
            case TypeCategory.None:
            case TypeCategory.Function:
            case TypeCategory.OverloadedFunction:
            case TypeCategory.TypeVar: {
                return 0.5;
            }

            case TypeCategory.Unbound:
            case TypeCategory.Never:
                return 1.0;

            case TypeCategory.Union: {
                let maxScore = 0;

                // If this union has a very large number of subtypes, don't bother
                // accurately computing the score. Assume a fixed value.
                if (type.subtypes.length < 16) {
                    doForEachSubtype(type, (subtype) => {
                        const subtypeScore = this._getComplexityScoreForType(subtype, recursionCount);
                        maxScore = Math.max(maxScore, subtypeScore);
                    });
                } else {
                    maxScore = 0.5;
                }

                return maxScore;
            }

            case TypeCategory.Class: {
                return this._getComplexityScoreForClass(type, recursionCount);
            }
        }

        // For all other types, return a score of 0.
        return 0;
    }

    private _getComplexityScoreForClass(classType: ClassType, recursionCount: number): number {
        let typeArgScoreSum = 0;
        let typeArgCount = 0;

        if (classType.tupleTypeArguments) {
            classType.tupleTypeArguments.forEach((typeArg) => {
                typeArgScoreSum += this._getComplexityScoreForType(typeArg.type, recursionCount);
                typeArgCount++;
            });
        } else if (classType.typeArguments) {
            classType.typeArguments.forEach((type) => {
                typeArgScoreSum += this._getComplexityScoreForType(type, recursionCount);
                typeArgCount++;
            });
        } else if (classType.details.typeParameters) {
            classType.details.typeParameters.forEach((type) => {
                typeArgScoreSum += this._getComplexityScoreForType(AnyType.create(), recursionCount);
                typeArgCount++;
            });
        }

        const averageTypeArgComplexity = typeArgCount > 0 ? typeArgScoreSum / typeArgCount : 0;
        return 0.5 + averageTypeArgComplexity * 0.25;
    }
}
