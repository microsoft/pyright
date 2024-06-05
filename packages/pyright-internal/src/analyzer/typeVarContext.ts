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
import { getUnknownTypeForParamSpec } from './typeUtils';
import {
    AnyType,
    ClassType,
    FunctionType,
    InScopePlaceholderScopeId,
    TupleTypeArgument,
    Type,
    TypeCategory,
    TypeVarScopeId,
    TypeVarType,
    isAnyOrUnknown,
    isFunction,
    isTypeSame,
    maxTypeRecursionCount,
} from './types';

// The maximum number of signature contexts that can be associated
// with a TypeVarContext. This equates to the number of overloads
// that can be captured by a ParamSpec (or multiple ParamSpecs).
// We should never hit this limit in practice, but there are certain
// pathological cases where we could, and we need to protect against
// this so it doesn't completely exhaust memory. This was previously
// set to 64, but we have seen cases where a library uses in excess
// of 300 overloads on a single function.
const maxSignatureContextCount = 1024;

export interface TypeVarMapEntry {
    typeVar: TypeVarType;

    // The final type must "fit" between the narrow and wide type bound.
    // If there are literal subtypes in the narrowBound, these are stripped,
    // and the resulting widened type is placed in narrowBoundNoLiterals as
    // long as they fit within the wideBound.
    narrowBound?: Type | undefined;
    narrowBoundNoLiterals?: Type | undefined;
    wideBound?: Type | undefined;

    // For tuples, the variadic types can be individually specified
    tupleTypes?: TupleTypeArgument[];
}

export class TypeVarSignatureContext {
    private _typeVarMap: Map<string, TypeVarMapEntry>;
    private _sourceTypeVarScopeId: Set<string> | undefined;

    constructor() {
        this._typeVarMap = new Map<string, TypeVarMapEntry>();
    }

    clone() {
        const newContext = new TypeVarSignatureContext();

        this._typeVarMap.forEach((value) => {
            newContext.setTypeVarType(value.typeVar, value.narrowBound, value.narrowBoundNoLiterals, value.wideBound);

            if (value.tupleTypes) {
                newContext.setTupleTypeVar(value.typeVar, value.tupleTypes);
            }
        });

        if (this._sourceTypeVarScopeId) {
            this._sourceTypeVarScopeId.forEach((scopeId) => newContext.addSourceTypeVarScopeId(scopeId));
        }

        return newContext;
    }

    isSame(other: TypeVarSignatureContext) {
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
                !typesMatch(value.narrowBound, otherValue.narrowBound) ||
                !typesMatch(value.wideBound, otherValue.wideBound)
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
            score += 1.0 - this._getComplexityScoreForType(typeVarType);
        });

        return score;
    }

    getTypeVarType(reference: TypeVarType, useNarrowBoundOnly = false): Type | undefined {
        const entry = this.getTypeVar(reference);
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
        const entry = this.getTypeVar(reference);
        if (!entry?.narrowBound) {
            return undefined;
        }

        if (isFunction(entry.narrowBound)) {
            return entry.narrowBound;
        }

        if (isAnyOrUnknown(entry.narrowBound)) {
            return getUnknownTypeForParamSpec();
        }

        return undefined;
    }

    setTypeVarType(
        reference: TypeVarType,
        narrowBound: Type | undefined,
        narrowBoundNoLiterals?: Type,
        wideBound?: Type,
        tupleTypes?: TupleTypeArgument[]
    ) {
        const key = TypeVarType.getNameWithScope(reference);
        this._typeVarMap.set(key, {
            typeVar: reference,
            narrowBound,
            narrowBoundNoLiterals,
            wideBound,
            tupleTypes,
        });
    }

    getTupleTypeVar(reference: TypeVarType): TupleTypeArgument[] | undefined {
        return this.getTypeVar(reference)?.tupleTypes;
    }

    setTupleTypeVar(reference: TypeVarType, types: TupleTypeArgument[]) {
        // Caller should have already assigned a value to this type variable.
        const entry = this.getTypeVar(reference);
        assert(entry);

        entry.tupleTypes = types;
    }

    getTypeVar(reference: TypeVarType): TypeVarMapEntry | undefined {
        const key = TypeVarType.getNameWithScope(reference);
        return this._typeVarMap.get(key);
    }

    getTypeVars(): TypeVarMapEntry[] {
        const entries: TypeVarMapEntry[] = [];

        this._typeVarMap.forEach((entry) => {
            entries.push(entry);
        });

        return entries;
    }

    getTypeVarCount() {
        return this._typeVarMap.size;
    }

    getWideTypeBound(reference: TypeVarType): Type | undefined {
        const entry = this.getTypeVar(reference);
        if (entry) {
            return entry.wideBound;
        }

        return undefined;
    }

    addSourceTypeVarScopeId(scopeId: TypeVarScopeId) {
        if (!this._sourceTypeVarScopeId) {
            this._sourceTypeVarScopeId = new Set<string>();
        }

        this._sourceTypeVarScopeId.add(scopeId);
    }

    hasSourceTypeVarScopeId(scopeId: TypeVarScopeId) {
        if (!this._sourceTypeVarScopeId) {
            return false;
        }

        return this._sourceTypeVarScopeId.has(scopeId);
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
            case TypeCategory.TypeVar: {
                return 0.5;
            }

            case TypeCategory.Function:
            case TypeCategory.OverloadedFunction: {
                // Classes and unions should be preferred over functions,
                // so make this relatively high (more than 0.75).
                return 0.8;
            }

            case TypeCategory.Unbound:
            case TypeCategory.Never:
                return 1.0;

            case TypeCategory.Union: {
                let maxScore = 0;

                // If this union has a very large number of subtypes, don't bother
                // accurately computing the score. Assume a fixed value.
                if (type.subtypes.length < 16) {
                    type.subtypes.forEach((subtype) => {
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

export class TypeVarContext {
    static nextTypeVarContextId = 1;
    private _id;
    private _solveForScopes: TypeVarScopeId[] | undefined;
    private _isLocked = false;
    private _signatureContexts: TypeVarSignatureContext[];

    constructor(solveForScopes?: TypeVarScopeId[] | TypeVarScopeId) {
        this._id = TypeVarContext.nextTypeVarContextId++;

        if (Array.isArray(solveForScopes)) {
            this._solveForScopes = solveForScopes;
        } else if (solveForScopes !== undefined) {
            this._solveForScopes = [solveForScopes];
        } else {
            this._solveForScopes = undefined;
        }

        this._signatureContexts = [new TypeVarSignatureContext()];
    }

    clone() {
        const newTypeVarMap = new TypeVarContext();
        if (this._solveForScopes) {
            newTypeVarMap._solveForScopes = Array.from(this._solveForScopes);
        }

        newTypeVarMap._signatureContexts = this._signatureContexts.map((context) => context.clone());
        newTypeVarMap._isLocked = this._isLocked;

        return newTypeVarMap;
    }

    cloneWithSignatureSource(typeVarScopeId: TypeVarScopeId): TypeVarContext {
        const clonedContext = this.clone();

        if (typeVarScopeId) {
            const filteredSignatures = this._signatureContexts.filter((context) =>
                context.hasSourceTypeVarScopeId(typeVarScopeId)
            );

            if (filteredSignatures.length > 0) {
                clonedContext._signatureContexts = filteredSignatures;
            } else {
                clonedContext._signatureContexts.forEach((context) => {
                    context.addSourceTypeVarScopeId(typeVarScopeId);
                });
            }
        }

        return clonedContext;
    }

    // Copies a cloned type var context back into this object.
    copyFromClone(clone: TypeVarContext) {
        this._signatureContexts = clone._signatureContexts.map((context) => context.clone());
        this._isLocked = clone._isLocked;
    }

    // Copy the specified signature contexts into this type var context.
    copySignatureContexts(contexts: TypeVarSignatureContext[]) {
        assert(contexts.length > 0);

        // Limit the number of signature contexts. There are rare circumstances
        // where this can grow to unbounded numbers and exhaust memory.
        if (contexts.length < maxSignatureContextCount) {
            this._signatureContexts = Array.from(contexts);
        }
    }

    isSame(other: TypeVarContext) {
        if (other._signatureContexts.length !== this._signatureContexts.length) {
            return false;
        }

        return this._signatureContexts.every((context, index) => context.isSame(other._signatureContexts[index]));
    }

    getId() {
        return this._id;
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
        return this._signatureContexts.every((context) => context.isEmpty());
    }

    setTypeVarType(
        reference: TypeVarType,
        narrowBound: Type | undefined,
        narrowBoundNoLiterals?: Type,
        wideBound?: Type,
        tupleTypes?: TupleTypeArgument[]
    ) {
        assert(!this._isLocked);

        return this._signatureContexts.forEach((context) => {
            context.setTypeVarType(reference, narrowBound, narrowBoundNoLiterals, wideBound, tupleTypes);
        });
    }

    setTupleTypeVar(reference: TypeVarType, tupleTypes: TupleTypeArgument[]) {
        assert(!this._isLocked);

        return this._signatureContexts.forEach((context) => {
            context.setTupleTypeVar(reference, tupleTypes);
        });
    }

    getScore() {
        let total = 0;

        this._signatureContexts.forEach((context) => {
            total += context.getScore();
        });

        // Return the average score among all signature contexts.
        return total / this._signatureContexts.length;
    }

    getPrimarySignature() {
        return this._signatureContexts[0];
    }

    getSignatureContexts() {
        return this._signatureContexts;
    }

    doForEachSignatureContext(callback: (signature: TypeVarSignatureContext, signatureIndex: number) => void) {
        const wasLocked = this.isLocked();
        this.unlock();

        this.getSignatureContexts().forEach((signature, signatureIndex) => {
            callback(signature, signatureIndex);
        });

        if (wasLocked) {
            this.lock();
        }
    }

    getSignatureContext(index: number) {
        assert(index >= 0 && index < this._signatureContexts.length);
        return this._signatureContexts[index];
    }

    doForEachSignature(callback: (context: TypeVarSignatureContext) => void) {
        this._signatureContexts.forEach((context) => {
            callback(context);
        });
    }
}
