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
import { ParseNode } from '../parser/parseNodes';
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

interface SpeculativeContext {
    speculativeRootNode: ParseNode;
    entriesToUndo: SpeculativeTypeCacheEntry[];
}

// This class maintains a stack of "speculative type contexts". When
// a context is popped off the stack, all of the speculative type cache
// entries that were created within that context are removed from the
// corresponding type caches because they are no longer valid.
export class SpeculativeTypeTracker {
    private _speculativeContextStack: SpeculativeContext[] = [];

    enterSpeculativeContext(speculativeRootNode: ParseNode) {
        this._speculativeContextStack.push({ speculativeRootNode, entriesToUndo: [] });
    }

    leaveSpeculativeContext() {
        assert(this._speculativeContextStack.length > 0);
        const context = this._speculativeContextStack.pop();

        // Delete all of the speculative type cache entries
        // that were tracked in this context.
        context!.entriesToUndo.forEach((entry) => {
            entry.cache.delete(entry.id);
        });
    }

    isSpeculative() {
        return this._speculativeContextStack.length > 0;
    }

    getSpeculativeRootNode() {
        const stackDepth = this._speculativeContextStack.length;
        if (stackDepth > 0) {
            // Return the speculative node associated with the most
            // recent context pushed onto the stack.
            return this._speculativeContextStack[stackDepth - 1].speculativeRootNode;
        }

        return undefined;
    }

    trackEntry(cache: TypeCache, id: number) {
        const stackSize = this._speculativeContextStack.length;
        if (stackSize > 0) {
            this._speculativeContextStack[stackSize - 1].entriesToUndo.push({
                cache,
                id,
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

    enableSpeculativeMode(stack: SpeculativeContext[]) {
        assert(this._speculativeContextStack.length === 0);
        this._speculativeContextStack = stack;
    }
}
