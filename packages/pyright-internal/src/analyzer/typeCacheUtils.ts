/*
 * typeCacheUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Utilities for managing type caches.
 */

import { assert } from '../common/debug';
import { ParseNode } from '../parser/parseNodes';
import * as ParseTreeUtils from './parseTreeUtils';
import { isTypeSame, Type } from './types';

// Define an interface to track speculative entries that need to
// be cleaned up when they go out of scope.
interface SpeculativeEntry {
    cache: Map<number, any>;
    id: number;
}

interface SpeculativeContext {
    speculativeRootNode: ParseNode;
    entriesToUndo: SpeculativeEntry[];
    allowCacheRetention: boolean;
}

export interface TypeResult {
    type: Type;
    isIncomplete: boolean;
}

interface SpeculativeTypeEntry extends TypeResult {
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

    trackEntry(cache: Map<number, any>, id: number) {
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

    addSpeculativeType(node: ParseNode, typeResult: TypeResult, expectedType: Type | undefined) {
        assert(this._speculativeContextStack.length > 0);
        if (this._speculativeContextStack.some((context) => !context.allowCacheRetention)) {
            return;
        }

        let cacheEntries = this._speculativeTypeCache.get(node.id);
        if (!cacheEntries) {
            cacheEntries = [];
            this._speculativeTypeCache.set(node.id, cacheEntries);
        }
        cacheEntries.push({ type: typeResult.type, isIncomplete: typeResult.isIncomplete, expectedType });
    }

    getSpeculativeType(node: ParseNode, expectedType: Type | undefined): TypeResult | undefined {
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
                            return entry;
                        }
                    } else if (entry.expectedType && isTypeSame(expectedType, entry.expectedType)) {
                        return entry;
                    }
                }
            }
        }

        return undefined;
    }
}
