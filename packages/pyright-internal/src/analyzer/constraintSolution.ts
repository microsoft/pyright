/*
 * constraintSolution.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Data structure that holds one or more constraint solutions for a set
 * of type variables.
 */

import { assert } from '../common/debug';
import { RefinementExpr, RefinementVarId } from './refinementTypes';
import { FunctionType, ParamSpecType, Type, TypeVarType } from './types';

export type RefinementVarMap = Map<RefinementVarId, RefinementExpr | undefined>;

// Records the types associated with a set of type variables.
export class ConstraintSolutionSet {
    // Indexed by TypeVar ID.
    private _typeVarMap: Map<string, Type | undefined>;

    // Indexed by refinement var ID.
    private _refinementVarMap: RefinementVarMap | undefined;

    constructor() {
        this._typeVarMap = new Map();
    }

    isEmpty() {
        return this._typeVarMap.size === 0 && !this._refinementVarMap;
    }

    getType(typeVar: ParamSpecType): FunctionType | undefined;
    getType(typeVar: TypeVarType): Type | undefined;
    getType(typeVar: TypeVarType): Type | undefined {
        const key = TypeVarType.getNameWithScope(typeVar);
        return this._typeVarMap.get(key);
    }

    setType(typeVar: TypeVarType, type: Type | undefined) {
        const key = TypeVarType.getNameWithScope(typeVar);
        return this._typeVarMap.set(key, type);
    }

    hasType(typeVar: TypeVarType): boolean {
        const key = TypeVarType.getNameWithScope(typeVar);
        return this._typeVarMap.has(key);
    }

    doForEachTypeVar(callback: (type: Type, typeVarId: string) => void) {
        this._typeVarMap.forEach((type, key) => {
            if (type) {
                callback(type, key);
            }
        });
    }

    getRefinementVarType(refinementVarId: string): RefinementExpr | undefined {
        return this._refinementVarMap?.get(refinementVarId);
    }

    setRefinementVarType(refinementVarId: string, value: RefinementExpr | undefined) {
        if (!this._refinementVarMap) {
            this._refinementVarMap = new Map();
        }

        this._refinementVarMap.set(refinementVarId, value);
    }

    hasRefinementVarType(refinementVarId: string): boolean {
        return this._refinementVarMap?.has(refinementVarId) ?? false;
    }

    doForEachRefinementVar(callback: (value: RefinementExpr, refinementVarId: string) => void) {
        this._refinementVarMap?.forEach((type, key) => {
            if (type) {
                callback(type, key);
            }
        });
    }

    getRefinementVarMap(): RefinementVarMap {
        return this._refinementVarMap ?? new Map();
    }
}

export class ConstraintSolution {
    private _solutionSets: ConstraintSolutionSet[];

    constructor(solutionSets?: ConstraintSolutionSet[]) {
        this._solutionSets =
            solutionSets && solutionSets.length > 0 ? [...solutionSets] : [new ConstraintSolutionSet()];
    }

    isEmpty() {
        return this._solutionSets.every((set) => set.isEmpty());
    }

    setType(typeVar: TypeVarType, type: Type) {
        return this._solutionSets.forEach((set) => {
            set.setType(typeVar, type);
        });
    }

    setRefinementVarType(refinementVarId: string, value: RefinementExpr) {
        return this._solutionSets.forEach((set) => {
            set.setRefinementVarType(refinementVarId, value);
        });
    }

    getMainSolutionSet() {
        return this.getSolutionSet(0);
    }

    getSolutionSets() {
        return this._solutionSets;
    }

    doForEachSolutionSet(callback: (solutionSet: ConstraintSolutionSet, index: number) => void) {
        this.getSolutionSets().forEach((set, index) => {
            callback(set, index);
        });
    }

    getSolutionSet(index: number) {
        assert(index >= 0 && index < this._solutionSets.length);
        return this._solutionSets[index];
    }
}
