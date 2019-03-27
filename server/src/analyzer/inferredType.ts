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

import { Type, UnknownType } from './types';
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
export const DefaultTypeSourceId: TypeSourceId = 0;

export class InferredType {
    private _sources: InferredTypeSource[] = [];
    private _combinedType: Type = UnknownType.create();

    getType() {
        return this._combinedType;
    }

    getPrimarySourceId() {
        if (this._sources.length > 0) {
            return this._sources[0].sourceId;
        }

        return DefaultTypeSourceId;
    }

    getSourceCount() {
        return this._sources.length;
    }

    // Adds a new source (or replaces an existing source) for the
    // inferred type. Returns true if the combined type changed.
    addSource(type: Type, sourceId: TypeSourceId): boolean {
        let inferredTypeChanged = false;

        // Is this source already known?
        const sourceIndex = this._sources.findIndex(src => src.sourceId === sourceId);
        if (sourceIndex >= 0) {
            if (this._sources[sourceIndex].type.isSame(type)) {
                return false;
            }

            this._sources[sourceIndex] = { sourceId, type };
        } else {
            this._sources.push({ sourceId, type });
            inferredTypeChanged = true;
        }

        // Recompute the combined type.
        let newCombinedType: Type | undefined;
        for (let source of this._sources) {
            if (!newCombinedType) {
                newCombinedType = source.type;
            } else {
                newCombinedType = TypeUtils.combineTypes(newCombinedType, source.type);
            }
        }

        if (!newCombinedType!.isSame(this._combinedType)) {
            this._combinedType = newCombinedType!;
            inferredTypeChanged = true;
        }

        return inferredTypeChanged;
    }

    addSources(inferredType: InferredType): boolean {
        let madeChange = false;

        for (let source of inferredType._sources) {
            if (this.addSource(source.type, source.sourceId)) {
                madeChange = true;
            }
        }

        return madeChange;
    }
}
