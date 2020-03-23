/*
 * typeCache.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Module used by the type evaluator that caches computed types
 * and stores them by node ID.
 */

import { assert } from '../common/debug';
import { Type } from './types';

// A type cache maps node IDs to types or pseudo-type objects.
export type TypeCache = Map<number, CachedType | undefined>;

// An entry within the cache is either a type or an "incomplete type"
// object that refers to a type.
export type CachedType = Type | IncompleteType;

export interface IncompleteType {
    isIncompleteType?: true;
    type: Type | undefined;
}

// Define a user type guard function for IncompleteType.
export function isIncompleteType(cachedType: CachedType): cachedType is IncompleteType {
    return !!(cachedType as IncompleteType).isIncompleteType;
}

// Define an interface to track speculative entries that need to
// be cleaned up when they go out of scope.
interface SpeculativeTypeCacheEntry {
    cache: TypeCache;
    id: number;
}

type SpeculativeTypeCacheList = SpeculativeTypeCacheEntry[];

// This class maintains a stack of "speculative type contexts". When
// a context is popped off the stack, all of the speculative type cache
// entries that were created within that context are removed from the
// corresponding type caches because they are no longer valid.
export class SpeculativeTypeTracker {
    private _speculativeContextStack: SpeculativeTypeCacheList[] = [];

    enterSpeculativeContext() {
        this._speculativeContextStack.push([]);
    }

    leaveSpeculativeContext() {
        assert(this._speculativeContextStack.length > 0);
        const trackedList = this._speculativeContextStack.pop();

        // Delete all of the speculative type cache entries
        // that were tracked in this context.
        trackedList!.forEach(entry => {
            entry.cache.delete(entry.id);
        });
    }

    isSpeculative() {
        return this._speculativeContextStack.length > 0;
    }

    trackEntry(cache: TypeCache, id: number) {
        const stackSize = this._speculativeContextStack.length;
        if (stackSize > 0) {
            this._speculativeContextStack[stackSize - 1].push({
                cache,
                id
            });
        }
    }

    // Temporarily disables speculative mode, clearing the stack
    // of speculative contexts. It returns the stack so the caller
    // can later restore it by calling enableSpeculativeMode.
    disableSpeculativeMode() {
        const stack = this._speculativeContextStack;
        this._speculativeContextStack = [];
        return stack;
    }

    enableSpeculativeMode(stack: SpeculativeTypeCacheList[]) {
        assert(this._speculativeContextStack.length === 0);
        this._speculativeContextStack = stack;
    }
}
