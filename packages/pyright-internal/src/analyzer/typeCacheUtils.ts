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
    dependentType: Type | undefined;
    allowDiagnostics?: boolean;
}

interface DependentType {
    speculativeRootNode: ParseNode;
    dependentType: Type;
}

export interface TypeResult {
    type: Type;
    isIncomplete?: boolean;
}

export interface SpeculativeTypeEntry {
    typeResult: TypeResult;
    expectedType: Type | undefined;
    incompleteGenerationCount: number;
    dependentTypes?: DependentType[];
}

export interface SpeculativeModeOptions {
    // If specified, the type cached speculative result depends on
    // this dependent type.
    dependentType?: Type;

    // Normally, diagnostics are suppressed for nodes under
    // a speculative root, but this can be overridden by specifying
    // this option.
    allowDiagnostics?: boolean;
}

// This class maintains a stack of "speculative type contexts". When
// a context is popped off the stack, all of the speculative type cache
// entries that were created within that context are removed from the
// corresponding type caches because they are no longer valid.
// The tracker also also contains a map of "speculative types" that are
// contextually evaluated based on an "expected type" and potentially
// one or more "dependent types". The "expected type" applies in cases
// where the speculative root node is being evaluated with bidirectional
// type inference. Dependent types apply in cases where the type of
// many subnodes depends on the expected type of a parent node, as in the
// case of lambda type inference.
export class SpeculativeTypeTracker {
    private _speculativeContextStack: SpeculativeContext[] = [];
    private _speculativeTypeCache = new Map<number, SpeculativeTypeEntry[]>();
    private _activeDependentTypes: DependentType[] = [];

    enterSpeculativeContext(speculativeRootNode: ParseNode, options?: SpeculativeModeOptions) {
        this._speculativeContextStack.push({
            speculativeRootNode,
            entriesToUndo: [],
            dependentType: options?.dependentType,
            allowDiagnostics: options?.allowDiagnostics,
        });

        // Retain a list of active dependent types. This information is already
        // contained within the speculative context stack, but we retain a copy
        // in this alternate form for performance reasons.
        if (options?.dependentType) {
            this._activeDependentTypes.push({
                speculativeRootNode,
                dependentType: options.dependentType,
            });
        }
    }

    leaveSpeculativeContext() {
        assert(this._speculativeContextStack.length > 0);
        const context = this._speculativeContextStack.pop();

        if (context?.dependentType) {
            assert(this._activeDependentTypes.length > 0);
            this._activeDependentTypes.pop();
        }

        // Delete all of the speculative type cache entries
        // that were tracked in this context.
        context!.entriesToUndo.forEach((entry) => {
            entry.cache.delete(entry.id);
        });
    }

    isSpeculative(node: ParseNode | undefined, ignoreIfDiagnosticsAllowed = false) {
        if (this._speculativeContextStack.length === 0) {
            return false;
        }

        if (!node) {
            return true;
        }

        for (let i = this._speculativeContextStack.length - 1; i >= 0; i--) {
            const stackEntry = this._speculativeContextStack[i];
            if (ParseTreeUtils.isNodeContainedWithin(node, stackEntry.speculativeRootNode)) {
                if (!ignoreIfDiagnosticsAllowed || !stackEntry.allowDiagnostics) {
                    return true;
                }
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

    addSpeculativeType(
        node: ParseNode,
        typeResult: TypeResult,
        incompleteGenerationCount: number,
        expectedType: Type | undefined
    ) {
        assert(this._speculativeContextStack.length > 0);

        const maxCacheEntriesPerNode = 8;
        let cacheEntries = this._speculativeTypeCache.get(node.id);

        if (!cacheEntries) {
            cacheEntries = [];
        } else {
            cacheEntries = cacheEntries.filter((entry) => {
                // Filter out any incomplete entries that no longer match the generation count.
                // These are obsolete and cannot be used.
                if (entry.typeResult.isIncomplete && entry.incompleteGenerationCount !== incompleteGenerationCount) {
                    return false;
                }

                // Filter out any entries that match the expected type of the
                // new entry. The new entry replaces the old in this case.
                if (expectedType) {
                    if (!entry.expectedType) {
                        return true;
                    }
                    return !isTypeSame(entry.expectedType, expectedType);
                }

                return !!entry.expectedType;
            });

            // Don't allow the cache to grow too large.
            if (cacheEntries.length >= maxCacheEntriesPerNode) {
                cacheEntries.slice(1);
            }
        }

        // Add the new entry.
        const newEntry: SpeculativeTypeEntry = {
            typeResult,
            expectedType,
            incompleteGenerationCount,
        };

        if (this._activeDependentTypes.length > 0) {
            newEntry.dependentTypes = Array.from(this._activeDependentTypes);
        }

        cacheEntries.push(newEntry);

        this._speculativeTypeCache.set(node.id, cacheEntries);
    }

    getSpeculativeType(node: ParseNode, expectedType: Type | undefined): SpeculativeTypeEntry | undefined {
        if (
            this._speculativeContextStack.some((context) =>
                ParseTreeUtils.isNodeContainedWithin(node, context.speculativeRootNode)
            )
        ) {
            const entries = this._speculativeTypeCache.get(node.id);
            if (entries) {
                for (const entry of entries) {
                    if (!expectedType) {
                        if (!entry.expectedType && this._dependentTypesMatch(entry)) {
                            return entry;
                        }
                    } else if (
                        entry.expectedType &&
                        isTypeSame(expectedType, entry.expectedType) &&
                        this._dependentTypesMatch(entry)
                    ) {
                        return entry;
                    }
                }
            }
        }

        return undefined;
    }

    // Determines whether a cache entry matches the current set of
    // active dependent types. If not, the cache entry can't be used
    // in the current context.
    private _dependentTypesMatch(entry: SpeculativeTypeEntry): boolean {
        const cachedDependentTypes = entry.dependentTypes ?? [];
        if (cachedDependentTypes.length !== this._activeDependentTypes.length) {
            return false;
        }

        return cachedDependentTypes.every((cachedDepType, index) => {
            const activeDepType = this._activeDependentTypes[index];
            if (cachedDepType.speculativeRootNode !== activeDepType.speculativeRootNode) {
                return false;
            }

            return isTypeSame(cachedDepType.dependentType, activeDepType.dependentType);
        });
    }
}
