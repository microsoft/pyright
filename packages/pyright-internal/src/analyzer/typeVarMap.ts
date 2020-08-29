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
import { ClassType, maxTypeRecursionCount, ParamSpecEntry, Type, TypeCategory } from './types';

export class TypeVarMap {
    private _typeVarMap: Map<string, Type>;
    private _paramSpecMap: Map<string, ParamSpecEntry[]>;
    private _isNarrowableMap: Map<string, boolean>;
    private _isLocked = false;

    constructor() {
        this._typeVarMap = new Map<string, Type>();
        this._paramSpecMap = new Map<string, ParamSpecEntry[]>();
        this._isNarrowableMap = new Map<string, boolean>();
    }

    clone() {
        const newTypeVarMap = new TypeVarMap();

        this._typeVarMap.forEach((value, name) => {
            newTypeVarMap.setTypeVar(name, value, this.isNarrowable(name));
        });

        this._paramSpecMap.forEach((value, name) => {
            newTypeVarMap.setParamSpec(name, value);
        });

        newTypeVarMap._isLocked = this._isLocked;

        return newTypeVarMap;
    }

    // Copies a cloned type var map back into this object.
    copyFromClone(clone: TypeVarMap) {
        this._typeVarMap = clone._typeVarMap;
        this._paramSpecMap = clone._paramSpecMap;
        this._isNarrowableMap = clone._isNarrowableMap;
        this._isLocked = clone._isLocked;
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
            score += this._getComplexityScoreForType(value);
        });

        score += this._paramSpecMap.size;

        return score;
    }

    hasTypeVar(name: string): boolean {
        return this._typeVarMap.has(name);
    }

    getTypeVar(name: string): Type | undefined {
        return this._typeVarMap.get(name);
    }

    setTypeVar(name: string, type: Type, isNarrowable: boolean) {
        assert(!this._isLocked);
        this._typeVarMap.set(name, type);
        this._isNarrowableMap.set(name, isNarrowable);
    }

    hasParamSpec(name: string): boolean {
        return this._paramSpecMap.has(name);
    }

    getParamSpec(name: string): ParamSpecEntry[] | undefined {
        return this._paramSpecMap.get(name);
    }

    setParamSpec(name: string, type: ParamSpecEntry[]) {
        assert(!this._isLocked);
        this._paramSpecMap.set(name, type);
    }

    typeVarCount() {
        return this._typeVarMap.size;
    }

    isNarrowable(name: string): boolean {
        const isNarrowable = this._isNarrowableMap.get(name);

        // Unless told otherwise, assume type is narrowable.
        return isNarrowable !== undefined ? isNarrowable : true;
    }

    lock() {
        // Locks the type var map, preventing any further changes.
        assert(!this._isLocked);
        this._isLocked = true;
    }

    isLocked(): boolean {
        return this._isLocked;
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
                type.subtypes.forEach((subtype) => {
                    const subtypeScore = this._getComplexityScoreForType(subtype, recursionCount + 1);
                    if (subtypeScore < minScore) {
                        minScore = subtypeScore;
                    }
                });

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

        if (classType.typeArguments) {
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
