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
import * as ParseTreeUtils from './parseTreeUtils';
import { isTypeSame, Type } from './types';

// A type cache maps node IDs to types or pseudo-type objects.
export type TypeCache = Map<number, CachedType | undefined>;

// An entry within the cache is either a type or an "incomplete type"
// object that refers to a type.
export type CachedType = Type | IncompleteType;

export interface IncompleteSubtypeInfo {
    type: Type | undefined;
    isIncomplete: boolean;
    isPending: boolean;
}

export interface IncompleteType {
    isIncompleteType?: true;

    // Type computed so far
    type: Type | undefined;

    // Array of incomplete subtypes that have been computed so far
    // (used for loops)
    incompleteSubtypes: IncompleteSubtypeInfo[];

    // Number of times this type has been encountered when recursively
    // attempting to compute a type.
    recursiveVisitCount?: number;

    // Number of times this type has been evaluated as the same.
    recursiveConvergenceCount?: number;

    // Tracks whether something has changed since this cache entry
    // was written that might change the incomplete type; if this
    // doesn't match the global "incomplete generation count", this
    // cached value is stale
    generationCount: number;
}

// Define a user type guard function for IncompleteType.
export function isIncompleteType(cachedType: CachedType): cachedType is IncompleteType {
    return !!(cachedType as IncompleteType).isIncompleteType;
}

// Define an interface to track speculative entries that need to
// be cleaned up when they go out of scope.
interface TypeCacheEntry {
    cache: TypeCache;
    id: number;
}

interface SpeculativeContext {
    speculativeRootNode: ParseNode;
    entriesToUndo: TypeCacheEntry[];
    allowCacheRetention: boolean;
}

interface SpeculativeTypeEntry {
    type: Type;
    expectedType: Type | undefined;
}

// This class maintains a stack of "speculative type contexts". When
// a context is popped off the stack, all of the speculative type cache
// entries that were created within that context are removed from the
// corresponding type caches because they are no longer valid.
// Each type context also contains a map of "speculative types" that are
// contextually evaluated based on an "expected type".
export class SpeculativeTypeTracker {
    private _speculativeContextStack: SpeculativeContext[] = [];
    private _speculativeTypeCache = new Map<number, SpeculativeTypeEntry[]>();

    enterSpeculativeContext(speculativeRootNode: ParseNode, allowCacheRetention: boolean) {
        this._speculativeContextStack.push({
            speculativeRootNode,
            entriesToUndo: [],
            allowCacheRetention,
        });
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

    isSpeculative(node: ParseNode | undefined) {
        if (this._speculativeContextStack.length === 0) {
            return false;
        }

        if (!node) {
            return true;
        }

        for (let i = this._speculativeContextStack.length - 1; i >= 0; i--) {
            if (ParseTreeUtils.isNodeContainedWithin(node, this._speculativeContextStack[i].speculativeRootNode)) {
                return true;
            }
        }

        return false;
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

    addSpeculativeType(node: ParseNode, type: Type, expectedType: Type | undefined) {
        assert(this._speculativeContextStack.length > 0);
        if (this._speculativeContextStack.some((context) => !context.allowCacheRetention)) {
            return;
        }

        let cacheEntries = this._speculativeTypeCache.get(node.id);
        if (!cacheEntries) {
            cacheEntries = [];
            this._speculativeTypeCache.set(node.id, cacheEntries);
        }
        cacheEntries.push({ type, expectedType });
    }

    getSpeculativeType(node: ParseNode, expectedType: Type | undefined) {
        if (
            this._speculativeContextStack.some((context) =>
                ParseTreeUtils.isNodeContainedWithin(node, context.speculativeRootNode)
            )
        ) {
            const entries = this._speculativeTypeCache.get(node.id);
            if (entries) {
                for (const entry of entries) {
                    if (!expectedType) {
                        if (!entry.expectedType) {
                            return entry.type;
                        }
                    } else if (entry.expectedType && isTypeSame(expectedType, entry.expectedType)) {
                        return entry.type;
                    }
                }
            }
        }

        return undefined;
    }
}

// This class tracks a list of cache entries that need to be
// undone because they were based on an "incomplete type" -
// a type that is calculated during code flow analysis and
// is incomplete because not all paths have been exhaustively
// explored.
export class IncompleteTypeTracker {
    private _trackerStack: TypeCacheEntry[][] = [];
    private _isUndoTrackingEnabled = false;

    trackEntry(cache: TypeCache, id: number) {
        if (this._isUndoTrackingEnabled) {
            const topOfStack = this._trackerStack[this._trackerStack.length - 1];
            topOfStack.push({
                cache,
                id,
            });
        }
    }

    // Push a new tracker onto the stack.
    enterTrackingScope() {
        this._trackerStack.push([]);
    }

    // Pop the latest tracker from the stack and deletes
    // all entries from the type cache that it refers to.
    exitTrackingScope() {
        const topOfStack = this._trackerStack.pop()!;
        topOfStack.forEach((entry) => {
            entry.cache.delete(entry.id);
        });

        // If we have consumed all trackers, no more undo
        // is required.
        if (this._trackerStack.length === 0) {
            this._isUndoTrackingEnabled = false;
        }
    }

    enableUndoTracking() {
        // Note that subsequent types are based on incomplete
        // type information and should be tracked and ultimately
        // removed from the cache.
        if (this._trackerStack.length > 0) {
            this._isUndoTrackingEnabled = true;
        }
    }

    isUndoTrackingEnabled() {
        return this._isUndoTrackingEnabled;
    }
}
