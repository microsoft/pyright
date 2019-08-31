/*
* inferredType.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Object that stores multiple types that combine to create
* a single inferred type. Each of the types come from
* different parse nodes, and they can be updated as type
* analysis proceeds.
*/

import { ClassType, ObjectType, Type, UnknownType } from './types';
import { TypeUtils } from './typeUtils';

// A type can be inferred from multiple sources. Each sources
// has a type and a unique ID, which remains constant through
// multiple passes of type analysis. As new type information
// becomes known, sources can be updated (e.g. from "unknown"
// to a known type).
export interface InferredTypeSource {
    type: Type;
    sourceId: TypeSourceId;
}

export type TypeSourceId = number;
export const defaultTypeSourceId: TypeSourceId = 0;

export class InferredType {
    private _sources: InferredTypeSource[] = [];
    private _combinedType: Type;

    // Some inferred types need to be wrapped in another
    // class. For example, the inferred yield type needs to
    // be wrapped in an Iterable[].
    private _genericClassWrapper: ClassType | undefined;

    constructor() {
        this._combinedType = UnknownType.create();
    }

    setGenericClassWrapper(classType: ClassType) {
        this._genericClassWrapper = classType;
    }

    getType() {
        if (!this._genericClassWrapper) {
            return this._combinedType;
        }

        const specializedClass = this._genericClassWrapper.cloneForSpecialization(
            [this._combinedType]);
        return new ObjectType(specializedClass);
    }

    getSources() {
        return this._sources;
    }

    getSourceCount() {
        return this._sources.length;
    }

    // Adds a new source (or replaces an existing source) for the
    // inferred type. Returns true if the combined type changed.
    addSource(type: Type, sourceId: TypeSourceId): boolean {
        // Is this source already known?
        const sourceIndex = this._sources.findIndex(src => src.sourceId === sourceId);
        if (sourceIndex >= 0) {
            if (this._sources[sourceIndex].type.isSame(type)) {
                return false;
            }

            this._sources[sourceIndex] = { sourceId, type };
        } else {
            this._sources.push({ sourceId, type });
        }

        return this._recomputeCombinedType();
    }

    removeSource(sourceId: TypeSourceId): boolean {
        const sourceIndex = this._sources.findIndex(src => src.sourceId === sourceId);
        if (sourceIndex < 0) {
            return false;
        }

        this._sources.splice(sourceIndex, 1);
        return this._recomputeCombinedType();
    }

    addSources(inferredType: InferredType): boolean {
        let madeChange = false;

        for (const source of inferredType._sources) {
            if (this.addSource(source.type, source.sourceId)) {
                madeChange = true;
            }
        }

        return madeChange;
    }

    private _recomputeCombinedType(): boolean {
        const sourceTypes = this._sources.map(source => source.type);
        let newCombinedType: Type | undefined;

        if (sourceTypes.length === 0) {
            newCombinedType = UnknownType.create();
        } else {
            newCombinedType = TypeUtils.combineTypes(sourceTypes);
        }

        if (!newCombinedType.isSame(this._combinedType)) {
            this._combinedType = newCombinedType;
            return true;
        }

        return false;
    }
}
