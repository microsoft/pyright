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
    evaluationCount: number;
}

export interface IncompleteType {
    isIncompleteType?: true;

    // Type computed so far
    type: Type | undefined;

    // Array of incomplete subtypes that have been computed so far
    // (used for loops)
    incompleteSubtypes: IncompleteSubtypeInfo[];

    // Tracks whether something has changed since this cache entry
    // was written that might change the incomplete type; if this
    // doesn't match the global "incomplete generation count", this
    // cached value is stale
    generationCount: number;

    // Indicates that the cache entry represents a sentinel
    // value used to detect and prevent recursion.
    isRecursionSentinel?: boolean;
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
