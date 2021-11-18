/*
 * codeFlowEngine.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Code that traverses the code flow graph to determine the (narrowed)
 * type of a variable or expression or the reachability of a statement.
 *
 * This is largely based on the code flow engine in the
 * TypeScript compiler.
 */

import { assert, fail } from '../common/debug';
import { CallNode, ExpressionNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { getImportInfo } from './analyzerNodeInfo';
import {
    CodeFlowReferenceExpressionNode,
    createKeyForReference,
    createKeysForReferenceSubexpressions,
    FlowAssignment,
    FlowAssignmentAlias,
    FlowBranchLabel,
    FlowCall,
    FlowCondition,
    FlowExhaustedMatch,
    FlowFlags,
    FlowLabel,
    FlowNarrowForPattern,
    FlowNode,
    FlowPostContextManagerLabel,
    FlowPostFinally,
    FlowPreFinallyGate,
    FlowVariableAnnotation,
    FlowWildcardImport,
} from './codeFlowTypes';
import { DeclarationType } from './declaration';
import { isMatchingExpression, isPartialMatchingExpression } from './parseTreeUtils';
import { Symbol } from './symbol';
import {
    CachedType,
    IncompleteSubtypeInfo,
    IncompleteType,
    isIncompleteType,
    SpeculativeTypeTracker,
    TypeCache,
} from './typeCache';
import { TypeEvaluator, TypeResult } from './typeEvaluatorTypes';
import { getTypeNarrowingCallback } from './typeGuards';
import {
    ClassType,
    combineTypes,
    FunctionType,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    isModule,
    isNever,
    isOverloadedFunction,
    isTypeSame,
    ModuleType,
    removeUnknownFromUnion,
    Type,
    UnboundType,
    UnknownType,
} from './types';
import {
    convertToInstance,
    doForEachSubtype,
    isNoReturnType,
    isTypeAliasPlaceholder,
    lookUpClassMember,
    mapSubtypes,
} from './typeUtils';

export interface FlowNodeTypeResult {
    type: Type | undefined;
    usedOuterScopeAlias: boolean;
    isIncomplete: boolean;
    generationCount?: number | undefined;
    incompleteType?: Type | undefined;
    incompleteSubtypes?: IncompleteSubtypeInfo[] | undefined;
    recursiveVisitCount?: number;
}

export interface CodeFlowAnalyzer {
    getTypeFromCodeFlow: (
        flowNode: FlowNode,
        reference: CodeFlowReferenceExpressionNode | undefined,
        targetSymbolId: number | undefined,
        initialType: Type | undefined,
        isInitialTypeIncomplete: boolean
    ) => FlowNodeTypeResult;
}

export interface CodeFlowEngine {
    createCodeFlowAnalyzer: () => CodeFlowAnalyzer;
    isFlowNodeReachable: (flowNode: FlowNode, sourceFlowNode?: FlowNode) => boolean;
}

// Maximum number of times a loop flow node will be evaluated
// with incomplete results before we give up.
const maxFlowNodeLoopVisitCount = 64;

// Maximum number of times getTypeFromFlowNode can be called
// recursively within loop or branch processing before we give up.
const maxCodeFlowInvocationsPerLoop = 16 * 1024;

export function getCodeFlowEngine(
    evaluator: TypeEvaluator,
    speculativeTypeTracker: SpeculativeTypeTracker
): CodeFlowEngine {
    const isReachableRecursionMap = new Map<number, true>();
    const callIsNoReturnCache = new Map<number, boolean>();
    const isExceptionContextManagerCache = new Map<number, boolean>();
    let codeFlowInvocations = 0;
    let flowIncompleteGeneration = 1;

    // Creates a new code flow analyzer that can be used to narrow the types
    // of the expressions within an execution context. Each code flow analyzer
    // instance maintains a cache of types it has already determined.
    function createCodeFlowAnalyzer(): CodeFlowAnalyzer {
        const flowNodeTypeCacheSet = new Map<string, TypeCache>();

        function getTypeFromCodeFlow(
            flowNode: FlowNode,
            reference: CodeFlowReferenceExpressionNode | undefined,
            targetSymbolId: number | undefined,
            initialType: Type | undefined,
            isInitialTypeIncomplete: boolean
        ): FlowNodeTypeResult {
            const referenceKey = reference !== undefined ? createKeyForReference(reference) : undefined;
            let subexpressionReferenceKeys: string[] | undefined;
            const referenceKeyWithSymbolId =
                referenceKey !== undefined && targetSymbolId !== undefined
                    ? referenceKey + `.${targetSymbolId.toString()}`
                    : '.';
            let flowNodeTypeCache = flowNodeTypeCacheSet.get(referenceKeyWithSymbolId);
            if (!flowNodeTypeCache) {
                flowNodeTypeCache = new Map<number, CachedType | undefined>();
                flowNodeTypeCacheSet.set(referenceKeyWithSymbolId, flowNodeTypeCache);
            }

            // Caches the type of the flow node in our local cache, keyed by the flow node ID.
            function setCacheEntry(
                flowNode: FlowNode,
                type: Type | undefined,
                usedOuterScopeAlias: boolean,
                isIncomplete: boolean
            ): FlowNodeTypeResult {
                if (!isIncomplete) {
                    flowIncompleteGeneration++;
                } else {
                    const prevEntry = flowNodeTypeCache!.get(flowNode.id);
                    if (prevEntry === undefined) {
                        flowIncompleteGeneration++;
                    } else if (type && (prevEntry as IncompleteType).isIncompleteType) {
                        const prevIncompleteType = prevEntry as IncompleteType;
                        if (prevIncompleteType.type && !isTypeSame(prevIncompleteType.type, type)) {
                            flowIncompleteGeneration++;
                        }
                    }
                }

                // For speculative or incomplete types, we'll create a separate
                // object. For non-speculative and complete types, we'll store
                // the type directly.
                const entry: CachedType | undefined = isIncomplete
                    ? {
                          isIncompleteType: true,
                          type,
                          incompleteSubtypes: [],
                          generationCount: flowIncompleteGeneration,
                      }
                    : type;

                flowNodeTypeCache!.set(flowNode.id, entry);
                speculativeTypeTracker.trackEntry(flowNodeTypeCache!, flowNode.id);

                return {
                    type,
                    usedOuterScopeAlias,
                    isIncomplete,
                    generationCount: flowIncompleteGeneration,
                    incompleteSubtypes: isIncomplete ? [] : undefined,
                };
            }

            function setIncompleteSubtype(
                flowNode: FlowNode,
                index: number,
                type: Type | undefined,
                isIncomplete: boolean,
                isPending: boolean,
                usedOuterScopeAlias: boolean
            ) {
                const cachedEntry = flowNodeTypeCache!.get(flowNode.id);
                if (cachedEntry === undefined || !isIncompleteType(cachedEntry)) {
                    fail('setIncompleteSubtype can be called only on a valid incomplete cache entry');
                }

                const incompleteEntries = cachedEntry.incompleteSubtypes;
                if (index < incompleteEntries.length) {
                    const oldEntry = incompleteEntries[index];
                    if (
                        oldEntry.isIncomplete !== isIncomplete ||
                        oldEntry.type === undefined ||
                        type === undefined ||
                        !isTypeSame(oldEntry.type, type)
                    ) {
                        incompleteEntries[index] = { type, isIncomplete, isPending };
                        flowIncompleteGeneration++;
                    } else if (oldEntry.isPending !== isPending) {
                        incompleteEntries[index] = { type, isIncomplete, isPending };
                    }
                } else {
                    assert(incompleteEntries.length === index);
                    incompleteEntries.push({ type, isIncomplete, isPending });
                    flowIncompleteGeneration++;
                }

                return getCacheEntry(flowNode, usedOuterScopeAlias);
            }

            function incrementFlowNodeVisitCount(flowNode: FlowNode) {
                const cachedEntry = flowNodeTypeCache!.get(flowNode.id);
                if (cachedEntry === undefined || !isIncompleteType(cachedEntry)) {
                    fail('incrementFlowNodeVisitCount can be called only on a valid incomplete cache entry');
                }

                cachedEntry.recursiveVisitCount = (cachedEntry.recursiveVisitCount ?? 0) + 1;

                return cachedEntry.recursiveVisitCount;
            }

            function getCacheEntry(flowNode: FlowNode, usedOuterScopeAlias: boolean): FlowNodeTypeResult | undefined {
                if (!flowNodeTypeCache!.has(flowNode.id)) {
                    return undefined;
                }

                const cachedEntry = flowNodeTypeCache!.get(flowNode.id);
                if (cachedEntry === undefined) {
                    return {
                        type: cachedEntry,
                        usedOuterScopeAlias,
                        isIncomplete: false,
                    };
                }

                if (!isIncompleteType(cachedEntry)) {
                    return {
                        type: cachedEntry,
                        usedOuterScopeAlias,
                        isIncomplete: false,
                    };
                }

                let type = cachedEntry.type;

                if (cachedEntry.incompleteSubtypes.length > 0) {
                    // Recompute the effective type based on all of the incomplete
                    // types we've accumulated so far.
                    const typesToCombine: Type[] = [];
                    cachedEntry.incompleteSubtypes.forEach((t) => {
                        if (t.type) {
                            typesToCombine.push(t.type);
                        }
                    });
                    type = typesToCombine.length > 0 ? combineTypes(typesToCombine) : undefined;
                }

                return {
                    type,
                    usedOuterScopeAlias,
                    isIncomplete: true,
                    incompleteSubtypes: cachedEntry.incompleteSubtypes,
                    generationCount: cachedEntry.generationCount,
                };
            }

            function evaluateAssignmentFlowNode(flowNode: FlowAssignment): TypeResult | undefined {
                // For function and class nodes, the reference node is the name
                // node, but we need to use the parent node (the FunctionNode or ClassNode)
                // to access the decorated type in the type cache.
                let nodeForCacheLookup: ParseNode = flowNode.node;
                const parentNode = flowNode.node.parent;
                if (parentNode) {
                    if (parentNode.nodeType === ParseNodeType.Function || parentNode.nodeType === ParseNodeType.Class) {
                        nodeForCacheLookup = parentNode;
                    }
                }

                return evaluator.evaluateTypeForSubnode(nodeForCacheLookup, () => {
                    evaluator.evaluateTypesForStatement(flowNode.node);
                });
            }

            // If this flow has no knowledge of the target expression, it returns undefined.
            // If the start flow node for this scope is reachable, the typeAtStart value is
            // returned.
            function getTypeFromFlowNode(
                flowNode: FlowNode,
                reference: CodeFlowReferenceExpressionNode | undefined,
                targetSymbolId: number | undefined,
                initialType: Type | undefined,
                isInitialTypeIncomplete: boolean
            ): FlowNodeTypeResult {
                let curFlowNode = flowNode;
                let usedOuterScopeAlias = false;

                // Record how many times this function has been called.
                const codeFlowInvocationsAtStart = codeFlowInvocations;
                codeFlowInvocations++;

                // This is a frequently-called routine, so it's a good place to call
                // the cancellation check. If the operation is canceled, an exception
                // will be thrown at this point.
                evaluator.checkForCancellation();

                while (true) {
                    // Have we already been here? If so, use the cached value.
                    const cachedEntry = getCacheEntry(curFlowNode, usedOuterScopeAlias);
                    if (cachedEntry) {
                        if (!cachedEntry.isIncomplete) {
                            return cachedEntry;
                        }

                        // If the cached entry is incomplete, we can use it only if nothing
                        // has changed that may cause the previously-reported incomplete type to change.
                        if (cachedEntry.generationCount === flowIncompleteGeneration) {
                            return {
                                type: cachedEntry?.type ? removeUnknownFromUnion(cachedEntry.type) : undefined,
                                usedOuterScopeAlias,
                                isIncomplete: true,
                            };
                        }
                    }

                    if (curFlowNode.flags & FlowFlags.Unreachable) {
                        // We can get here if there are nodes in a compound logical expression
                        // (e.g. "False and x") that are never executed but are evaluated.
                        // The type doesn't matter in this case.
                        return setCacheEntry(curFlowNode, undefined, usedOuterScopeAlias, /* isIncomplete */ false);
                    }

                    if (curFlowNode.flags & FlowFlags.VariableAnnotation) {
                        const varAnnotationNode = curFlowNode as FlowVariableAnnotation;
                        curFlowNode = varAnnotationNode.antecedent;
                        continue;
                    }

                    if (curFlowNode.flags & FlowFlags.Call) {
                        const callFlowNode = curFlowNode as FlowCall;

                        // If this function returns a "NoReturn" type, that means
                        // it always raises an exception or otherwise doesn't return,
                        // so we can assume that the code before this is unreachable.
                        if (isCallNoReturn(callFlowNode.node)) {
                            return setCacheEntry(curFlowNode, undefined, usedOuterScopeAlias, /* isIncomplete */ false);
                        }

                        curFlowNode = callFlowNode.antecedent;
                        continue;
                    }

                    if (curFlowNode.flags & FlowFlags.Assignment) {
                        const assignmentFlowNode = curFlowNode as FlowAssignment;
                        // Are we targeting the same symbol? We need to do this extra check because the same
                        // symbol name might refer to different symbols in different scopes (e.g. a list
                        // comprehension introduces a new scope).
                        if (reference) {
                            if (
                                targetSymbolId === assignmentFlowNode.targetSymbolId &&
                                isMatchingExpression(reference, assignmentFlowNode.node)
                            ) {
                                // Is this a special "unbind" assignment? If so,
                                // we can handle it immediately without any further evaluation.
                                if (curFlowNode.flags & FlowFlags.Unbind) {
                                    return setCacheEntry(
                                        curFlowNode,
                                        UnboundType.create(),
                                        usedOuterScopeAlias,
                                        /* isIncomplete */ false
                                    );
                                }

                                // If there was a cache entry already, that means we hit a recursive
                                // case (something like "int: int = 4"). Avoid infinite recursion
                                // by returning an undefined type.
                                if (cachedEntry && cachedEntry.type === undefined) {
                                    return { type: undefined, usedOuterScopeAlias, isIncomplete: true };
                                }

                                // Set the cache entry to undefined before evaluating the
                                // expression in case it depends on itself.
                                setCacheEntry(curFlowNode, undefined, usedOuterScopeAlias, /* isIncomplete */ true);
                                let flowTypeResult = evaluateAssignmentFlowNode(assignmentFlowNode);
                                if (flowTypeResult && isTypeAliasPlaceholder(flowTypeResult.type)) {
                                    flowTypeResult = undefined;
                                }
                                return setCacheEntry(
                                    curFlowNode,
                                    flowTypeResult?.type,
                                    usedOuterScopeAlias,
                                    !!flowTypeResult?.isIncomplete
                                );
                            } else if (isPartialMatchingExpression(reference, assignmentFlowNode.node)) {
                                // If the node partially matches the reference, we need to "kill" any narrowed
                                // types further above this point. For example, if we see the sequence
                                //    a.b = 3
                                //    a = Foo()
                                //    x = a.b
                                // The type of "a.b" can no longer be assumed to be Literal[3].
                                return {
                                    type: initialType,
                                    usedOuterScopeAlias,
                                    isIncomplete: isInitialTypeIncomplete,
                                };
                            }
                        }

                        curFlowNode = assignmentFlowNode.antecedent;
                        continue;
                    }

                    if (curFlowNode.flags & FlowFlags.AssignmentAlias) {
                        const aliasFlowNode = curFlowNode as FlowAssignmentAlias;

                        // If the target symbol ID matches, replace with its alias
                        // and continue to traverse the code flow graph.
                        if (targetSymbolId === aliasFlowNode.targetSymbolId) {
                            targetSymbolId = aliasFlowNode.aliasSymbolId;
                            usedOuterScopeAlias = true;
                        }
                        curFlowNode = aliasFlowNode.antecedent;
                        continue;
                    }

                    if (curFlowNode.flags & FlowFlags.BranchLabel) {
                        const branchFlowNode = curFlowNode as FlowBranchLabel;
                        if (curFlowNode.flags & FlowFlags.PostContextManager) {
                            // Determine whether any of the context managers support exception
                            // suppression. If not, none of its antecedents are reachable.
                            const contextMgrNode = curFlowNode as FlowPostContextManagerLabel;
                            if (
                                !contextMgrNode.expressions.some((expr) =>
                                    isExceptionContextManager(expr, contextMgrNode.isAsync)
                                )
                            ) {
                                return setCacheEntry(
                                    curFlowNode,
                                    undefined,
                                    usedOuterScopeAlias,
                                    /* isIncomplete */ false
                                );
                            }
                        }

                        // Is the current symbol modified in any way within the scope of the branch?
                        // If not, we can skip all processing within the branch scope.
                        if (reference && branchFlowNode.preBranchAntecedent && branchFlowNode.affectedExpressions) {
                            if (!subexpressionReferenceKeys) {
                                subexpressionReferenceKeys = createKeysForReferenceSubexpressions(reference);
                            }

                            if (
                                !subexpressionReferenceKeys.some((key) =>
                                    branchFlowNode.affectedExpressions!.has(key)
                                ) &&
                                isFlowNodeReachable(curFlowNode, branchFlowNode.preBranchAntecedent)
                            ) {
                                curFlowNode = branchFlowNode.preBranchAntecedent;
                                continue;
                            }
                        }

                        const labelNode = curFlowNode as FlowLabel;
                        const typesToCombine: Type[] = [];
                        let branchUsedOuterScopeAlias = usedOuterScopeAlias;

                        let sawIncomplete = false;

                        // Set the cache entry to undefined before evaluating the
                        // expression in case it depends on itself.
                        setCacheEntry(curFlowNode, undefined, usedOuterScopeAlias, /* isIncomplete */ true);

                        labelNode.antecedents.forEach((antecedent) => {
                            const flowTypeResult = getTypeFromFlowNode(
                                antecedent,
                                reference,
                                targetSymbolId,
                                initialType,
                                isInitialTypeIncomplete
                            );

                            if (flowTypeResult.isIncomplete) {
                                sawIncomplete = true;
                            }

                            if (flowTypeResult.usedOuterScopeAlias) {
                                branchUsedOuterScopeAlias = true;
                            }

                            if (flowTypeResult.type) {
                                typesToCombine.push(flowTypeResult.type);
                            }
                        });

                        const effectiveType =
                            !!reference || typesToCombine.length > 0 ? combineTypes(typesToCombine) : undefined;

                        // Limit the number of recursive calls before we give up and call the type
                        // complete. This can theoretically result in incorrect type information in
                        // very complex code flows, but it's preferable to extremely long analysis times.
                        if (codeFlowInvocations - codeFlowInvocationsAtStart > maxCodeFlowInvocationsPerLoop) {
                            sawIncomplete = false;
                        }

                        return setCacheEntry(curFlowNode, effectiveType, branchUsedOuterScopeAlias, sawIncomplete);
                    }

                    if (curFlowNode.flags & FlowFlags.LoopLabel) {
                        const loopNode = curFlowNode as FlowLabel;

                        // Is the current symbol modified in any way within the loop? If not, we can skip all
                        // processing within the loop and assume that the type comes from the first antecedent,
                        // which feeds the loop.
                        if (reference) {
                            if (!subexpressionReferenceKeys) {
                                subexpressionReferenceKeys = createKeysForReferenceSubexpressions(reference);
                            }

                            if (!subexpressionReferenceKeys.some((key) => loopNode.affectedExpressions!.has(key))) {
                                curFlowNode = loopNode.antecedents[0];
                                continue;
                            }
                        }

                        let sawIncomplete = false;
                        let loopUsedOuterScopeAlias = usedOuterScopeAlias;

                        // See if we've been here before. If so, there will be an incomplete cache entry.
                        let cacheEntry = getCacheEntry(curFlowNode, usedOuterScopeAlias);
                        let typeAtStart: Type | undefined;

                        if (cacheEntry === undefined) {
                            // We haven't been here before, so create a new incomplete cache entry.
                            cacheEntry = setCacheEntry(
                                curFlowNode,
                                undefined,
                                usedOuterScopeAlias,
                                /* isIncomplete */ true
                            );
                        } else {
                            typeAtStart = cacheEntry.type;
                        }

                        const isRecursive =
                            cacheEntry.incompleteSubtypes !== undefined &&
                            cacheEntry.incompleteSubtypes.some((subtype) => subtype.isPending);
                        const visitCount = incrementFlowNodeVisitCount(curFlowNode);

                        loopNode.antecedents.forEach((antecedent, index) => {
                            cacheEntry = getCacheEntry(curFlowNode, usedOuterScopeAlias)!;

                            // Have we already been here (i.e. does the entry exist and is
                            // not marked "pending")? If so, we can use the type that was already
                            // computed if it is complete.
                            const subtypeEntry =
                                cacheEntry.incompleteSubtypes !== undefined &&
                                index < cacheEntry.incompleteSubtypes.length
                                    ? cacheEntry.incompleteSubtypes[index]
                                    : undefined;
                            if (
                                subtypeEntry === undefined ||
                                (!subtypeEntry?.isPending && subtypeEntry?.isIncomplete)
                            ) {
                                // Set this entry to "pending" to prevent infinite recursion.
                                // We'll mark it "not pending" below.
                                cacheEntry = setIncompleteSubtype(
                                    curFlowNode,
                                    index,
                                    subtypeEntry?.type,
                                    /* isIncomplete */ true,
                                    /* isPending */ true,
                                    usedOuterScopeAlias
                                );

                                try {
                                    const flowTypeResult = getTypeFromFlowNode(
                                        antecedent,
                                        reference,
                                        targetSymbolId,
                                        initialType,
                                        isInitialTypeIncomplete
                                    );

                                    if (flowTypeResult.isIncomplete) {
                                        sawIncomplete = true;
                                    }

                                    if (flowTypeResult.usedOuterScopeAlias) {
                                        loopUsedOuterScopeAlias = true;
                                    }

                                    cacheEntry = setIncompleteSubtype(
                                        curFlowNode,
                                        index,
                                        flowTypeResult.type,
                                        flowTypeResult.isIncomplete,
                                        /* isPending */ false,
                                        loopUsedOuterScopeAlias
                                    );
                                } catch (e) {
                                    setIncompleteSubtype(
                                        curFlowNode,
                                        index,
                                        undefined,
                                        /* isIncomplete */ true,
                                        /* isPending */ false,
                                        usedOuterScopeAlias
                                    );
                                    throw e;
                                }
                            }
                        });

                        if (isRecursive) {
                            // This was not the first time through the loop, so we are recursively trying
                            // to resolve other parts of the incomplete type. It will be marked complete
                            // once the stack pops back up to the first caller.

                            // If we have visited the loop node maxFlowNodeLoopVisitCount times already
                            // and some of the subtypes are still incomplete, bail and base the
                            // isIncomplete flag on the first subtype, which is the one that feeds
                            // the top of the loop.
                            let isIncomplete =
                                visitCount >= maxFlowNodeLoopVisitCount
                                    ? cacheEntry.incompleteSubtypes![0].isIncomplete
                                    : reference !== undefined;

                            // Limit the number of recursive calls before we give up and call the type
                            // complete. This can theoretically result in incorrect type information in
                            // very complex code flows, but it's preferable to extremely long analysis times.
                            if (codeFlowInvocations - codeFlowInvocationsAtStart > maxCodeFlowInvocationsPerLoop) {
                                isIncomplete = false;
                            }

                            return {
                                type: cacheEntry.type,
                                usedOuterScopeAlias,
                                isIncomplete,
                            };
                        }

                        // If we've been here more than once and the type has converged (didn't change
                        // since last time), assume that the type is complete.
                        if (
                            sawIncomplete &&
                            visitCount > 1 &&
                            typeAtStart &&
                            cacheEntry.type &&
                            isTypeSame(typeAtStart, cacheEntry.type)
                        ) {
                            sawIncomplete = false;
                        }

                        // The result is incomplete if one or more entries were incomplete.
                        if (sawIncomplete) {
                            // If there is an "Unknown" type within a union type, remove
                            // it. Otherwise we might end up resolving the cycle with a type
                            // that includes an undesirable unknown.
                            return {
                                type: cacheEntry?.type ? removeUnknownFromUnion(cacheEntry.type) : undefined,
                                usedOuterScopeAlias: loopUsedOuterScopeAlias,
                                isIncomplete: true,
                            };
                        }

                        // We have made it all the way through all the antecedents, and we can
                        // mark the type as complete.
                        return setCacheEntry(
                            curFlowNode,
                            cacheEntry!.type,
                            loopUsedOuterScopeAlias,
                            /* isIncomplete */ false
                        );
                    }

                    if (curFlowNode.flags & (FlowFlags.TrueCondition | FlowFlags.FalseCondition)) {
                        const conditionalFlowNode = curFlowNode as FlowCondition;

                        if (reference) {
                            const typeNarrowingCallback = getTypeNarrowingCallback(
                                evaluator,
                                reference,
                                conditionalFlowNode
                            );
                            if (typeNarrowingCallback) {
                                // Set the cache entry to undefined before evaluating the
                                // expression in case it depends on itself.
                                setCacheEntry(curFlowNode, undefined, usedOuterScopeAlias, /* isIncomplete */ true);

                                const flowTypeResult = getTypeFromFlowNode(
                                    conditionalFlowNode.antecedent,
                                    reference,
                                    targetSymbolId,
                                    initialType,
                                    isInitialTypeIncomplete
                                );
                                let flowType = flowTypeResult.type;
                                if (flowType) {
                                    flowType = typeNarrowingCallback(flowType);
                                }

                                return setCacheEntry(
                                    curFlowNode,
                                    flowType,
                                    flowTypeResult.usedOuterScopeAlias,
                                    flowTypeResult.isIncomplete
                                );
                            }
                        }

                        curFlowNode = conditionalFlowNode.antecedent;
                        continue;
                    }

                    if (curFlowNode.flags & (FlowFlags.TrueNeverCondition | FlowFlags.FalseNeverCondition)) {
                        const conditionalFlowNode = curFlowNode as FlowCondition;
                        if (conditionalFlowNode.reference) {
                            // Make sure the reference type has a declared type. If not,
                            // don't bother trying to infer its type because that would be
                            // too expensive.
                            const symbolWithScope = evaluator.lookUpSymbolRecursive(
                                conditionalFlowNode.reference,
                                conditionalFlowNode.reference.value,
                                /* honorCodeFlow */ false
                            );
                            if (symbolWithScope && symbolWithScope.symbol.getTypedDeclarations().length > 0) {
                                const typeNarrowingCallback = getTypeNarrowingCallback(
                                    evaluator,
                                    conditionalFlowNode.reference,
                                    conditionalFlowNode
                                );
                                if (typeNarrowingCallback) {
                                    const refTypeInfo = evaluator.getTypeOfExpression(conditionalFlowNode.reference!);
                                    const narrowedType = typeNarrowingCallback(refTypeInfo.type) || refTypeInfo.type;

                                    // If the narrowed type is "never", don't allow further exploration.
                                    if (isNever(narrowedType)) {
                                        return setCacheEntry(
                                            curFlowNode,
                                            undefined,
                                            usedOuterScopeAlias,
                                            !!refTypeInfo.isIncomplete
                                        );
                                    }
                                }
                            }
                        }
                        curFlowNode = conditionalFlowNode.antecedent;
                        continue;
                    }

                    if (curFlowNode.flags & FlowFlags.ExhaustedMatch) {
                        const exhaustedMatchFlowNode = curFlowNode as FlowExhaustedMatch;
                        const narrowedTypeResult = evaluator.evaluateTypeForSubnode(exhaustedMatchFlowNode.node, () => {
                            evaluator.evaluateTypesForMatchNode(exhaustedMatchFlowNode.node);
                        });

                        // If the narrowed type is "never", don't allow further exploration.
                        if (narrowedTypeResult && isNever(narrowedTypeResult.type)) {
                            return setCacheEntry(
                                curFlowNode,
                                undefined,
                                usedOuterScopeAlias,
                                !!narrowedTypeResult.isIncomplete
                            );
                        }

                        curFlowNode = exhaustedMatchFlowNode.antecedent;
                        continue;
                    }

                    if (curFlowNode.flags & FlowFlags.NarrowForPattern) {
                        const patternFlowNode = curFlowNode as FlowNarrowForPattern;
                        if (!reference || isMatchingExpression(reference, patternFlowNode.subjectExpression)) {
                            const typeResult = evaluator.evaluateTypeForSubnode(patternFlowNode.statement, () => {
                                if (patternFlowNode.statement.nodeType === ParseNodeType.Case) {
                                    evaluator.evaluateTypesForCaseNode(patternFlowNode.statement);
                                } else {
                                    evaluator.evaluateTypesForMatchNode(patternFlowNode.statement);
                                }
                            });
                            if (typeResult) {
                                if (!reference) {
                                    if (isNever(typeResult.type)) {
                                        return setCacheEntry(
                                            curFlowNode,
                                            undefined,
                                            usedOuterScopeAlias,
                                            !!typeResult.isIncomplete
                                        );
                                    }
                                } else {
                                    return setCacheEntry(
                                        curFlowNode,
                                        typeResult.type,
                                        usedOuterScopeAlias,
                                        !!typeResult.isIncomplete
                                    );
                                }
                            }
                        }
                        curFlowNode = patternFlowNode.antecedent;
                        continue;
                    }

                    if (curFlowNode.flags & FlowFlags.PreFinallyGate) {
                        const preFinallyFlowNode = curFlowNode as FlowPreFinallyGate;
                        if (preFinallyFlowNode.isGateClosed) {
                            return { type: undefined, usedOuterScopeAlias, isIncomplete: false };
                        }
                        curFlowNode = preFinallyFlowNode.antecedent;
                        continue;
                    }

                    if (curFlowNode.flags & FlowFlags.PostFinally) {
                        const postFinallyFlowNode = curFlowNode as FlowPostFinally;
                        const wasGateClosed = postFinallyFlowNode.preFinallyGate.isGateClosed;
                        try {
                            postFinallyFlowNode.preFinallyGate.isGateClosed = true;
                            let flowTypeResult: FlowNodeTypeResult | undefined;

                            // Use speculative mode for the remainder of the finally suite
                            // because the final types within this parse node block should be
                            // evaluated when the gate is open.
                            evaluator.useSpeculativeMode(postFinallyFlowNode.finallyNode, () => {
                                flowTypeResult = getTypeFromFlowNode(
                                    postFinallyFlowNode.antecedent,
                                    reference,
                                    targetSymbolId,
                                    initialType,
                                    isInitialTypeIncomplete
                                );
                            });

                            // If the type is incomplete, don't write back to the cache.
                            return flowTypeResult!.isIncomplete
                                ? flowTypeResult!
                                : setCacheEntry(
                                      curFlowNode,
                                      flowTypeResult!.type,
                                      flowTypeResult!.usedOuterScopeAlias,
                                      /* isIncomplete */ false
                                  );
                        } finally {
                            postFinallyFlowNode.preFinallyGate.isGateClosed = wasGateClosed;
                        }
                    }

                    if (curFlowNode.flags & FlowFlags.Start) {
                        return setCacheEntry(curFlowNode, initialType, usedOuterScopeAlias, isInitialTypeIncomplete);
                    }

                    if (curFlowNode.flags & FlowFlags.WildcardImport) {
                        const wildcardImportFlowNode = curFlowNode as FlowWildcardImport;
                        if (reference && reference.nodeType === ParseNodeType.Name) {
                            const nameValue = reference.value;
                            if (wildcardImportFlowNode.names.some((name) => name === nameValue)) {
                                const type = getTypeFromWildcardImport(wildcardImportFlowNode, nameValue);
                                return setCacheEntry(curFlowNode, type, usedOuterScopeAlias, /* isIncomplete */ false);
                            }
                        }

                        curFlowNode = wildcardImportFlowNode.antecedent;
                        continue;
                    }

                    // We shouldn't get here.
                    fail('Unexpected flow node flags');
                    return setCacheEntry(curFlowNode, undefined, usedOuterScopeAlias, /* isIncomplete */ false);
                }
            }

            if (!flowNode) {
                // This should happen only in cases where we're evaluating
                // parse nodes that are created after the initial parse
                // (namely, string literals that are used for forward
                // referenced types).
                return {
                    type: initialType,
                    usedOuterScopeAlias: false,
                    isIncomplete: isInitialTypeIncomplete,
                };
            }

            return getTypeFromFlowNode(flowNode, reference, targetSymbolId, initialType, isInitialTypeIncomplete);
        }

        return {
            getTypeFromCodeFlow,
        };
    }

    // Determines whether the specified flowNode can be reached by any
    // control flow path within the execution context. If sourceFlowNode
    // is specified, it returns true only if at least one control flow
    // path passes through sourceFlowNode.
    function isFlowNodeReachable(flowNode: FlowNode, sourceFlowNode?: FlowNode): boolean {
        const visitedFlowNodeMap = new Set<number>();

        function isFlowNodeReachableRecursive(flowNode: FlowNode, sourceFlowNode: FlowNode | undefined): boolean {
            let curFlowNode = flowNode;

            while (true) {
                // If we've already visited this node, we can assume
                // it wasn't reachable.
                if (visitedFlowNodeMap.has(curFlowNode.id)) {
                    return false;
                }

                // Note that we've been here before.
                visitedFlowNodeMap.add(curFlowNode.id);

                if (curFlowNode.flags & FlowFlags.Unreachable) {
                    return false;
                }

                if (curFlowNode === sourceFlowNode) {
                    return true;
                }

                if (
                    curFlowNode.flags &
                    (FlowFlags.VariableAnnotation |
                        FlowFlags.Assignment |
                        FlowFlags.AssignmentAlias |
                        FlowFlags.TrueCondition |
                        FlowFlags.FalseCondition |
                        FlowFlags.WildcardImport |
                        FlowFlags.TrueNeverCondition |
                        FlowFlags.FalseNeverCondition |
                        FlowFlags.NarrowForPattern |
                        FlowFlags.ExhaustedMatch)
                ) {
                    const typedFlowNode = curFlowNode as
                        | FlowVariableAnnotation
                        | FlowAssignment
                        | FlowAssignmentAlias
                        | FlowCondition
                        | FlowWildcardImport
                        | FlowCondition
                        | FlowExhaustedMatch;
                    curFlowNode = typedFlowNode.antecedent;
                    continue;
                }

                if (curFlowNode.flags & FlowFlags.Call) {
                    const callFlowNode = curFlowNode as FlowCall;

                    // If this function returns a "NoReturn" type, that means
                    // it always raises an exception or otherwise doesn't return,
                    // so we can assume that the code before this is unreachable.
                    if (isCallNoReturn(callFlowNode.node)) {
                        return false;
                    }

                    curFlowNode = callFlowNode.antecedent;
                    continue;
                }

                if (curFlowNode.flags & (FlowFlags.BranchLabel | FlowFlags.LoopLabel)) {
                    if (curFlowNode.flags & FlowFlags.PostContextManager) {
                        // Determine whether any of the context managers support exception
                        // suppression. If not, none of its antecedents are reachable.
                        const contextMgrNode = curFlowNode as FlowPostContextManagerLabel;
                        if (
                            !contextMgrNode.expressions.some((expr) =>
                                isExceptionContextManager(expr, contextMgrNode.isAsync)
                            )
                        ) {
                            return false;
                        }
                    }

                    const labelNode = curFlowNode as FlowLabel;
                    for (const antecedent of labelNode.antecedents) {
                        if (isFlowNodeReachableRecursive(antecedent, sourceFlowNode)) {
                            return true;
                        }
                    }
                    return false;
                }

                if (curFlowNode.flags & FlowFlags.Start) {
                    // If we hit the start but were looking for a particular source flow
                    // node, return false. Otherwise, the start is what we're looking for.
                    return sourceFlowNode ? false : true;
                }

                if (curFlowNode.flags & FlowFlags.PreFinallyGate) {
                    const preFinallyFlowNode = curFlowNode as FlowPreFinallyGate;
                    return !preFinallyFlowNode.isGateClosed;
                }

                if (curFlowNode.flags & FlowFlags.PostFinally) {
                    const postFinallyFlowNode = curFlowNode as FlowPostFinally;
                    const wasGateClosed = postFinallyFlowNode.preFinallyGate.isGateClosed;

                    try {
                        postFinallyFlowNode.preFinallyGate.isGateClosed = true;
                        return isFlowNodeReachableRecursive(postFinallyFlowNode.antecedent, sourceFlowNode);
                    } finally {
                        postFinallyFlowNode.preFinallyGate.isGateClosed = wasGateClosed;
                    }
                }

                // We shouldn't get here.
                fail('Unexpected flow node flags');
                return false;
            }
        }

        // Protect against infinite recursion.
        if (isReachableRecursionMap.has(flowNode.id)) {
            return true;
        }
        isReachableRecursionMap.set(flowNode.id, true);

        try {
            return isFlowNodeReachableRecursive(flowNode, sourceFlowNode);
        } finally {
            isReachableRecursionMap.delete(flowNode.id);
        }
    }

    // Performs a cursory analysis to determine whether a call never returns
    // without fully evaluating its type. This is done during code flow,
    // so it can't rely on full type analysis. It makes some simplifying
    // assumptions that work fine in practice.
    function isCallNoReturn(node: CallNode) {
        // See if this information is cached already.
        if (callIsNoReturnCache.has(node.id)) {
            return callIsNoReturnCache.get(node.id);
        }

        // Initially set to false to avoid infinite recursion.
        callIsNoReturnCache.set(node.id, false);

        let noReturnTypeCount = 0;
        let subtypeCount = 0;

        // Evaluate the call base type.
        const callType = getDeclaredCallBaseType(node.leftExpression);
        if (callType) {
            doForEachSubtype(callType, (callSubtype) => {
                // Track the number of subtypes we've examined.
                subtypeCount++;

                // We assume here that no constructors or __call__ methods
                // will be inferred "no return" types, so we can restrict
                // our check to functions.
                let functionType: FunctionType | undefined;
                if (isFunction(callSubtype)) {
                    functionType = callSubtype;
                } else if (isOverloadedFunction(callSubtype)) {
                    // Use the last overload, which should be the most general.
                    const overloadedFunction = callSubtype;
                    functionType = overloadedFunction.overloads[overloadedFunction.overloads.length - 1];
                }

                if (functionType && !FunctionType.isAsync(functionType)) {
                    if (functionType.details.declaredReturnType) {
                        if (isNoReturnType(functionType.details.declaredReturnType)) {
                            noReturnTypeCount++;
                        }
                    } else if (functionType.details.declaration) {
                        // If the function has yield expressions, it's a generator, and
                        // we'll assume the yield statements are reachable. Also, don't
                        // infer a "no return" type for abstract methods.
                        if (
                            !functionType.details.declaration.yieldStatements &&
                            !FunctionType.isAbstractMethod(functionType) &&
                            !FunctionType.isStubDefinition(functionType) &&
                            !FunctionType.isPyTypedDefinition(functionType)
                        ) {
                            // Check specifically for a common idiom where the only statement
                            // (other than a possible docstring) is a "raise NotImplementedError".
                            const functionStatements = functionType.details.declaration.node.suite.statements;

                            let foundRaiseNotImplemented = false;
                            for (const statement of functionStatements) {
                                if (
                                    statement.nodeType !== ParseNodeType.StatementList ||
                                    statement.statements.length !== 1
                                ) {
                                    break;
                                }

                                const simpleStatement = statement.statements[0];
                                if (simpleStatement.nodeType === ParseNodeType.StringList) {
                                    continue;
                                }

                                if (
                                    simpleStatement.nodeType === ParseNodeType.Raise &&
                                    simpleStatement.typeExpression
                                ) {
                                    // Check for "raise NotImplementedError" or "raise NotImplementedError()"
                                    const isNotImplementedName = (node: ParseNode) => {
                                        return (
                                            node?.nodeType === ParseNodeType.Name &&
                                            node.value === 'NotImplementedError'
                                        );
                                    };

                                    if (isNotImplementedName(simpleStatement.typeExpression)) {
                                        foundRaiseNotImplemented = true;
                                    } else if (
                                        simpleStatement.typeExpression.nodeType === ParseNodeType.Call &&
                                        isNotImplementedName(simpleStatement.typeExpression.leftExpression)
                                    ) {
                                        foundRaiseNotImplemented = true;
                                    }
                                }

                                break;
                            }

                            if (
                                !foundRaiseNotImplemented &&
                                !evaluator.isAfterNodeReachable(functionType.details.declaration.node)
                            ) {
                                noReturnTypeCount++;
                            }
                        }
                    }
                }
            });
        }

        // The call is considered NoReturn if all subtypes evaluate to NoReturn.
        const callIsNoReturn = subtypeCount > 0 && noReturnTypeCount === subtypeCount;

        // Cache the value for next time.
        callIsNoReturnCache.set(node.id, callIsNoReturn);

        return callIsNoReturn;
    }

    // Performs a cursory analysis to determine whether the expression
    // corresponds to a context manager object that supports the swallowing
    // of exceptions. By convention, these objects have an "__exit__" method
    // that returns a bool response (as opposed to a None). This function is
    // called during code flow, so it can't rely on full type evaluation. It
    // makes some simplifying assumptions that work in most cases.
    function isExceptionContextManager(node: ExpressionNode, isAsync: boolean) {
        // See if this information is cached already.
        if (isExceptionContextManagerCache.has(node.id)) {
            return isExceptionContextManagerCache.get(node.id);
        }

        // Initially set to false to avoid infinite recursion.
        isExceptionContextManagerCache.set(node.id, false);

        let cmSwallowsExceptions = false;
        let cmType: Type | undefined;

        if (node.nodeType === ParseNodeType.Call) {
            const callType = getDeclaredCallBaseType(node.leftExpression);
            if (callType && isInstantiableClass(callType)) {
                cmType = convertToInstance(callType);
            } else if (callType && isFunction(callType)) {
                cmType = callType.details.declaredReturnType;
            }
        } else if (node.nodeType === ParseNodeType.Name) {
            cmType = evaluator.getDeclaredTypeForExpression(node);
        }

        if (cmType && isClassInstance(cmType)) {
            const exitMethodName = isAsync ? '__aexit__' : '__exit__';
            const exitType = evaluator.getTypeFromObjectMember(node, cmType, exitMethodName)?.type;

            if (exitType && isFunction(exitType) && exitType.details.declaredReturnType) {
                const returnType = exitType.details.declaredReturnType;
                cmSwallowsExceptions = isClassInstance(returnType) && ClassType.isBuiltIn(returnType, 'bool');
            }
        }

        // Cache the value for next time.
        isExceptionContextManagerCache.set(node.id, cmSwallowsExceptions);

        return cmSwallowsExceptions;
    }

    function getTypeFromWildcardImport(flowNode: FlowWildcardImport, name: string): Type {
        const importInfo = getImportInfo(flowNode.node.module);
        assert(importInfo !== undefined && importInfo.isImportFound);
        assert(flowNode.node.isWildcardImport);

        const symbolWithScope = evaluator.lookUpSymbolRecursive(flowNode.node, name, /* honorCodeFlow */ false);
        assert(symbolWithScope !== undefined);
        const decls = symbolWithScope!.symbol.getDeclarations();
        const wildcardDecl = decls.find((decl) => decl.node === flowNode.node);

        if (!wildcardDecl) {
            return UnknownType.create();
        }

        return evaluator.getInferredTypeOfDeclaration(wildcardDecl) || UnknownType.create();
    }

    // When we're evaluating a call to determine whether it returns NoReturn,
    // we don't want to do a full type evaluation, which would be expensive
    // and create circular dependencies in type evaluation. Instead, we do
    // a best-effort evaluation using only declared types (functions, parameters,
    // etc.).
    function getDeclaredCallBaseType(node: ExpressionNode): Type | undefined {
        if (node.nodeType === ParseNodeType.Name) {
            const symbolWithScope = evaluator.lookUpSymbolRecursive(node, node.value, /* honorCodeFlow */ false);

            if (!symbolWithScope) {
                return undefined;
            }

            const symbol = symbolWithScope.symbol;
            const type = evaluator.getDeclaredTypeOfSymbol(symbol);
            if (type) {
                return type;
            }

            // There was no declared type. Before we give up, see if the
            // symbol is a function parameter whose value can be inferred
            // or an imported symbol.
            const declarations = symbol.getDeclarations();
            if (declarations.length === 0) {
                return undefined;
            }

            const decl = declarations[declarations.length - 1];
            if (decl.type === DeclarationType.Parameter) {
                return evaluator.evaluateTypeForSubnode(decl.node.name!, () => {
                    evaluator.evaluateTypeOfParameter(decl.node);
                })?.type;
            }

            // If it is a symbol from an outer execution scope or an alias, it
            // is safe to infer its type.
            if (decl.type === DeclarationType.Alias || symbolWithScope.isBeyondExecutionScope) {
                return evaluator.getInferredTypeOfDeclaration(decl);
            }

            return undefined;
        }

        if (node.nodeType === ParseNodeType.MemberAccess) {
            const memberName = node.memberName.value;
            let baseType = getDeclaredCallBaseType(node.leftExpression);
            if (!baseType) {
                return undefined;
            }

            baseType = evaluator.makeTopLevelTypeVarsConcrete(baseType);

            const declaredTypeOfSymbol = mapSubtypes(baseType, (subtype) => {
                let symbol: Symbol | undefined;
                if (isModule(subtype)) {
                    symbol = ModuleType.getField(subtype, memberName);
                } else if (isInstantiableClass(subtype)) {
                    const classMemberInfo = lookUpClassMember(subtype, memberName);
                    symbol = classMemberInfo ? classMemberInfo.symbol : undefined;
                } else if (isClassInstance(subtype)) {
                    const classMemberInfo = lookUpClassMember(subtype, memberName);
                    symbol = classMemberInfo ? classMemberInfo.symbol : undefined;
                }

                return symbol ? evaluator.getDeclaredTypeOfSymbol(symbol) : undefined;
            });

            if (!isNever(declaredTypeOfSymbol)) {
                return declaredTypeOfSymbol;
            }
        }

        if (node.nodeType === ParseNodeType.Call) {
            const baseType = getDeclaredCallBaseType(node.leftExpression);
            if (!baseType) {
                return undefined;
            }

            if (baseType && isInstantiableClass(baseType)) {
                const inst = convertToInstance(baseType);
                return inst;
            }

            if (isFunction(baseType)) {
                return baseType.details.declaredReturnType;
            }
        }

        return undefined;
    }

    return {
        createCodeFlowAnalyzer,
        isFlowNodeReachable,
    };
}
