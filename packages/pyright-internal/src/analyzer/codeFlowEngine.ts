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

import { ConsoleInterface } from '../common/console';
import { assert, fail } from '../common/debug';
import { convertOffsetToPosition } from '../common/positionUtils';
import { ArgCategory, ExpressionNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { getFileInfo, getImportInfo } from './analyzerNodeInfo';
import {
    CodeFlowReferenceExpressionNode,
    createKeyForReference,
    createKeysForReferenceSubexpressions,
    FlowAssignment,
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
import { formatControlFlowGraph } from './codeFlowUtils';
import { getBoundCallMethod, getBoundNewMethod } from './constructors';
import { isMatchingExpression, isPartialMatchingExpression, printExpression } from './parseTreeUtils';
import { getPatternSubtypeNarrowingCallback } from './patternMatching';
import { SpeculativeTypeTracker } from './typeCacheUtils';
import { narrowForKeyAssignment } from './typedDicts';
import { EvalFlags, Reachability, TypeEvaluator, TypeResult } from './typeEvaluatorTypes';
import { getTypeNarrowingCallback } from './typeGuards';
import {
    ClassType,
    combineTypes,
    FunctionType,
    isClass,
    isClassInstance,
    isFunction,
    isFunctionOrOverloaded,
    isInstantiableClass,
    isNever,
    isOverloaded,
    isParamSpec,
    isTypeSame,
    isTypeVar,
    isTypeVarTuple,
    maxTypeRecursionCount,
    NeverType,
    OverloadedType,
    Type,
    TypeVarType,
    UnboundType,
    UnknownType,
} from './types';
import {
    cleanIncompleteUnknown,
    derivesFromStdlibClass,
    doForEachSubtype,
    isIncompleteUnknown,
    isTypeAliasPlaceholder,
    mapSubtypes,
} from './typeUtils';

export interface FlowNodeTypeResult {
    type: Type | undefined;
    isIncomplete: boolean;
    generationCount: number | undefined;
    incompleteSubtypes: IncompleteSubtypeInfo[] | undefined;
}

export namespace FlowNodeTypeResult {
    export function create(
        type: Type | undefined,
        isIncomplete: boolean,
        generationCount?: number,
        incompleteSubtypes?: IncompleteSubtypeInfo[]
    ): FlowNodeTypeResult {
        return {
            type,
            isIncomplete,
            generationCount,
            incompleteSubtypes,
        };
    }
}

export interface FlowNodeTypeOptions {
    targetSymbolId?: number;
    typeAtStart?: TypeResult;
    skipConditionalNarrowing?: boolean;
}

export interface CodeFlowAnalyzer {
    getTypeFromCodeFlow: (
        flowNode: FlowNode,
        reference: CodeFlowReferenceExpressionNode | undefined,
        options?: FlowNodeTypeOptions
    ) => FlowNodeTypeResult;
}

export interface CodeFlowEngine {
    createCodeFlowAnalyzer: () => CodeFlowAnalyzer;
    getFlowNodeReachability: (flowNode: FlowNode, sourceFlowNode?: FlowNode, ignoreNoReturn?: boolean) => Reachability;
    narrowConstrainedTypeVar: (flowNode: FlowNode, typeVar: TypeVarType) => Type | undefined;
    printControlFlowGraph: (
        flowNode: FlowNode,
        reference: CodeFlowReferenceExpressionNode | undefined,
        callName: string,
        logger: ConsoleInterface
    ) => void;
}

export interface IncompleteSubtypeInfo {
    type: Type;
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

interface ReachabilityCacheEntry {
    reachability: Reachability | undefined;
    reachabilityFrom: Map<number, Reachability>;
}

// Define a user type guard function for IncompleteType.
export function isIncompleteType(cachedType: CachedType): cachedType is IncompleteType {
    return !!(cachedType as IncompleteType).isIncompleteType;
}

export type CachedType = Type | IncompleteType;

interface CodeFlowTypeCache {
    cache: Map<number, CachedType | undefined>;
    pendingNodes: Set<number>;
    closedFinallyGateNodes: Set<number>;
}

// This debugging option prints the control flow graph when getTypeFromCodeFlow is called.
const enablePrintControlFlowGraph = false;

// This debugging option prints the results of calls to isCallNoReturn.
const enablePrintCallNoReturn = false;

// Should the code flow engine assume that an unannotated function does not have
// an inferred return type of `NoReturn`, or should it perform code flow analysis
// to determine whether it is `NoReturn`? Enabling this produces more consistent
// and complete results, but it can be very expensive.
const inferNoReturnForUnannotatedFunctions = false;

// In rare circumstances, it's possible for types in a loop not to converge. This
// can happen, for example, if there are many symbols that depend on each other
// and their types depend on complex overloads that can resolve to Any under
// certain circumstances. This defines the max number of times we'll attempt to
// evaluate an antecedent in a loop before we give up and "pin" the evaluated
// type for that antecedent. The number is somewhat arbitrary. Too low and
// it will cause incorrect types to be evaluated even when types could converge.
// Too high, and it will cause long hangs before giving up.
const maxConvergenceAttemptLimit = 256;

// Should a message be logged when the convergence limit is hit? This is useful
// for debugging but not something that is actionable for users, so disable by
// default.
const enablePrintConvergenceLimitHit = false;

export function getCodeFlowEngine(
    evaluator: TypeEvaluator,
    speculativeTypeTracker: SpeculativeTypeTracker
): CodeFlowEngine {
    const isReachableRecursionSet = new Set<number>();
    const reachabilityCache = new Map<number, ReachabilityCacheEntry>();
    const callIsNoReturnCache = new Map<number, boolean>();
    const isExceptionContextManagerCache = new Map<number, boolean>();
    let flowIncompleteGeneration = 1;
    let noReturnAnalysisDepth = 0;
    let contextManagerAnalysisDepth = 0;
    let maxConvergenceLimitHit = false;

    // Creates a new code flow analyzer that can be used to narrow the types
    // of the expressions within an execution context. Each code flow analyzer
    // instance maintains a cache of types it has already determined.
    function createCodeFlowAnalyzer(): CodeFlowAnalyzer {
        const flowNodeTypeCacheSet = new Map<string, CodeFlowTypeCache>();

        function getFlowNodeTypeCacheForReference(referenceKey: string) {
            let flowNodeTypeCache = flowNodeTypeCacheSet.get(referenceKey);
            if (!flowNodeTypeCache) {
                flowNodeTypeCache = {
                    cache: new Map<number, CachedType | undefined>(),
                    pendingNodes: new Set<number>(),
                    closedFinallyGateNodes: new Set<number>(),
                };
                flowNodeTypeCacheSet.set(referenceKey, flowNodeTypeCache);
            }

            return flowNodeTypeCache;
        }

        // Determines whether any calls to getTypeFromCodeFlow are pending
        // for an expression other than referenceKeyFilter. This is important in cases
        // where the type of one expression depends on the type of another
        // in a loop. If there are other pending evaluations, we will mark the
        // current evaluation as incomplete and return back to the pending
        // evaluation.
        function isGetTypeFromCodeFlowPending(referenceKeyFilter: string | undefined): boolean {
            if (!referenceKeyFilter) {
                return false;
            }

            for (const [key, value] of flowNodeTypeCacheSet.entries()) {
                if (key !== referenceKeyFilter && value.pendingNodes.size > 0) {
                    return true;
                }
            }

            return false;
        }

        // This function has two primary modes. The first is used to determine
        // the narrowed type of a reference expression based on code flow analysis.
        // The second (when reference is undefined) is used to determine whether
        // the specified flowNode is reachable when "never narrowing" is applied.
        function getTypeFromCodeFlow(
            flowNode: FlowNode,
            reference: CodeFlowReferenceExpressionNode | undefined,
            options?: FlowNodeTypeOptions
        ): FlowNodeTypeResult {
            if (enablePrintControlFlowGraph) {
                printControlFlowGraph(flowNode, reference, 'getTypeFromCodeFlow');
            }

            const referenceKey = reference !== undefined ? createKeyForReference(reference) : undefined;
            let subexpressionReferenceKeys: string[] | undefined;
            const referenceKeyWithSymbolId =
                referenceKey !== undefined && options?.targetSymbolId !== undefined
                    ? referenceKey + `.${options?.targetSymbolId.toString()}`
                    : '.';
            const flowNodeTypeCache = getFlowNodeTypeCacheForReference(referenceKeyWithSymbolId);

            // Caches the type of the flow node in our local cache, keyed by the flow node ID.
            function setCacheEntry(
                flowNode: FlowNode,
                type: Type | undefined,
                isIncomplete: boolean
            ): FlowNodeTypeResult {
                if (!isIncomplete) {
                    flowIncompleteGeneration++;
                } else if (type) {
                    const prevEntry = flowNodeTypeCache.cache.get(flowNode.id);
                    if (prevEntry) {
                        const prevIncompleteType = prevEntry as IncompleteType;

                        if (
                            prevIncompleteType.isIncompleteType &&
                            prevIncompleteType.type &&
                            !isTypeSame(prevIncompleteType.type, type)
                        ) {
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

                flowNodeTypeCache.cache.set(flowNode.id, entry);
                speculativeTypeTracker.trackEntry(flowNodeTypeCache.cache, flowNode.id);

                return FlowNodeTypeResult.create(
                    type,
                    isIncomplete,
                    flowIncompleteGeneration,
                    isIncomplete ? [] : undefined
                );
            }

            function setIncompleteSubtype(
                flowNode: FlowNode,
                index: number,
                type: Type,
                isIncomplete: boolean,
                isPending: boolean,
                evaluationCount: number
            ) {
                const cachedEntry = flowNodeTypeCache.cache.get(flowNode.id);
                if (cachedEntry === undefined || !isIncompleteType(cachedEntry)) {
                    fail(
                        'setIncompleteSubtype can be called only on a valid incomplete cache entry: ' +
                            `prev cache entry?: ${!cachedEntry} ` +
                            `index=${index} ` +
                            `isPending=${isPending} ` +
                            `evaluationCount=${evaluationCount}`
                    );
                }

                const incompleteEntries = cachedEntry.incompleteSubtypes;
                if (index < incompleteEntries.length) {
                    const oldEntry = incompleteEntries[index];
                    if (oldEntry.isIncomplete !== isIncomplete || !isTypeSame(oldEntry.type, type)) {
                        incompleteEntries[index] = { type, isIncomplete, isPending, evaluationCount };
                        flowIncompleteGeneration++;
                    } else if (oldEntry.isPending !== isPending) {
                        incompleteEntries[index] = { type, isIncomplete, isPending, evaluationCount };
                    }
                } else {
                    assert(incompleteEntries.length === index);
                    incompleteEntries.push({ type, isIncomplete, isPending, evaluationCount });
                    flowIncompleteGeneration++;
                }

                let combinedType: Type | undefined;
                if (cachedEntry.incompleteSubtypes.length > 0) {
                    // Recompute the effective type based on all of the incomplete
                    // types we've accumulated so far.
                    const typesToCombine: Type[] = [];

                    cachedEntry.incompleteSubtypes.forEach((t) => {
                        if (t.type) {
                            typesToCombine.push(t.type);
                        }
                    });

                    combinedType = typesToCombine.length > 0 ? combineTypes(typesToCombine) : undefined;
                }

                cachedEntry.type = combinedType;
                cachedEntry.generationCount = flowIncompleteGeneration;

                return getCacheEntry(flowNode);
            }

            // Cache either contains a type or an object that represents an incomplete type.
            // Incomplete types are types that haven't gone through all flow nodes yet.
            // Incomplete only happens for branch and loop nodes.
            function getCacheEntry(flowNode: FlowNode): FlowNodeTypeResult | undefined {
                if (!flowNodeTypeCache.cache.has(flowNode.id)) {
                    return undefined;
                }

                const cachedEntry = flowNodeTypeCache.cache.get(flowNode.id);
                if (cachedEntry === undefined) {
                    return FlowNodeTypeResult.create(/* type */ undefined, /* isIncomplete */ false);
                }

                if (!isIncompleteType(cachedEntry)) {
                    return FlowNodeTypeResult.create(cachedEntry, /* isIncomplete */ false);
                }

                return FlowNodeTypeResult.create(
                    cachedEntry.type,
                    /* isIncomplete */ true,
                    cachedEntry.generationCount,
                    cachedEntry.incompleteSubtypes
                );
            }

            function deleteCacheEntry(flowNode: FlowNode) {
                flowNodeTypeCache.cache.delete(flowNode.id);
            }

            // Cleans any "incomplete unknowns" from the specified set of entries
            // to compute the final type.
            function cleanIncompleteUnknownForCacheEntry(cacheEntry: FlowNodeTypeResult): Type | undefined {
                if (!cacheEntry.type) {
                    return undefined;
                }

                if (!cacheEntry.incompleteSubtypes || cacheEntry.incompleteSubtypes.length === 0) {
                    return cleanIncompleteUnknown(cacheEntry.type);
                }

                const typesToCombine: Type[] = [];

                cacheEntry.incompleteSubtypes?.forEach((entry) => {
                    if (entry.type && !isIncompleteUnknown(entry.type)) {
                        typesToCombine.push(cleanIncompleteUnknown(entry.type));
                    }
                });

                return combineTypes(typesToCombine);
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

            function preventRecursion<T>(flowNode: FlowNode, callback: () => T): T {
                flowNodeTypeCache.pendingNodes.add(flowNode.id);

                try {
                    const result = callback();
                    flowNodeTypeCache.pendingNodes.delete(flowNode.id);
                    return result;
                } catch (e) {
                    // Don't use a "finally" clause here because the TypeScript
                    // debugger doesn't handle "step out" well with finally clauses.
                    flowNodeTypeCache.pendingNodes.delete(flowNode.id);
                    throw e;
                }
            }

            // If this flow has no knowledge of the target expression, it returns undefined.
            // If the start flow node for this scope is reachable, the typeAtStart value is
            // returned.
            function getTypeFromFlowNode(flowNode: FlowNode): FlowNodeTypeResult {
                let curFlowNode = flowNode;

                // This is a frequently-called routine, so it's a good place to call
                // the cancellation check. If the operation is canceled, an exception
                // will be thrown at this point.
                evaluator.checkForCancellation();

                while (true) {
                    // Have we already been here? If so, use the cached value.
                    const cachedEntry = getCacheEntry(curFlowNode);
                    if (cachedEntry) {
                        if (!cachedEntry.isIncomplete) {
                            return cachedEntry;
                        }

                        // If the cached entry is incomplete, we can use it only if nothing
                        // has changed that may cause the previously-reported incomplete type to change.
                        if (cachedEntry.generationCount === flowIncompleteGeneration) {
                            return FlowNodeTypeResult.create(
                                cleanIncompleteUnknownForCacheEntry(cachedEntry),
                                /* isIncomplete */ true
                            );
                        }
                    }

                    // Check for recursion.
                    if (flowNodeTypeCache.pendingNodes.has(curFlowNode.id)) {
                        return FlowNodeTypeResult.create(
                            cachedEntry?.type ?? UnknownType.create(/* isIncomplete */ true),
                            /* isIncomplete */ true
                        );
                    }

                    if (curFlowNode.flags & FlowFlags.Unreachable) {
                        // We can get here if there are nodes in a compound logical expression
                        // (e.g. "False and x") that are never executed but are evaluated.
                        return setCacheEntry(curFlowNode, NeverType.createNever(), /* isIncomplete */ false);
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
                        if (isCallNoReturn(evaluator, callFlowNode)) {
                            return setCacheEntry(curFlowNode, /* type */ undefined, /* isIncomplete */ false);
                        }

                        curFlowNode = callFlowNode.antecedent;
                        continue;
                    }

                    if (curFlowNode.flags & FlowFlags.Assignment) {
                        const assignmentFlowNode = curFlowNode as FlowAssignment;
                        const targetNode = assignmentFlowNode.node;

                        // Are we targeting the same symbol? We need to do this extra check because the same
                        // symbol name might refer to different symbols in different scopes (e.g. a list
                        // comprehension introduces a new scope).
                        if (reference) {
                            if (
                                options?.targetSymbolId === assignmentFlowNode.targetSymbolId &&
                                isMatchingExpression(reference, targetNode)
                            ) {
                                // Is this a special "unbind" assignment? If so,
                                // we can handle it immediately without any further evaluation.
                                if (curFlowNode.flags & FlowFlags.Unbind) {
                                    // Don't treat unbound assignments to indexed expressions (i.e. "del x[0]")
                                    // as true deletions. The most common use case for "del x[0]" is in a list,
                                    // and the list class treats this as an element deletion, not an assignment.
                                    if (reference.nodeType === ParseNodeType.Index) {
                                        // No need to explore further.
                                        return setCacheEntry(curFlowNode, undefined, /* isIncomplete */ false);
                                    }

                                    // Don't treat unbound assignments to member access expressions (i.e. "del a.x")
                                    // as true deletions either. These may go through a descriptor object __delete__
                                    // method or a __delattr__ method on the class.
                                    if (reference.nodeType === ParseNodeType.MemberAccess) {
                                        // No need to explore further.
                                        return setCacheEntry(curFlowNode, undefined, /* isIncomplete */ false);
                                    }

                                    return setCacheEntry(curFlowNode, UnboundType.create(), /* isIncomplete */ false);
                                }

                                let flowTypeResult = preventRecursion(curFlowNode, () =>
                                    evaluateAssignmentFlowNode(assignmentFlowNode)
                                );

                                if (flowTypeResult) {
                                    if (isTypeAliasPlaceholder(flowTypeResult.type)) {
                                        // Don't cache a recursive type alias placeholder.
                                        return FlowNodeTypeResult.create(flowTypeResult.type, /* isIncomplete */ true);
                                    } else if (
                                        reference.nodeType === ParseNodeType.MemberAccess &&
                                        evaluator.isAsymmetricAccessorAssignment(targetNode)
                                    ) {
                                        flowTypeResult = undefined;
                                    }
                                }

                                return setCacheEntry(curFlowNode, flowTypeResult?.type, !!flowTypeResult?.isIncomplete);
                            }

                            // Is this a simple assignment to an index expression? If so, it could
                            // be assigning to a TypedDict, which requires narrowing of the expression's
                            // base type.
                            if (
                                targetNode.nodeType === ParseNodeType.Index &&
                                isMatchingExpression(reference, targetNode.d.leftExpr)
                            ) {
                                if (
                                    targetNode.parent?.nodeType === ParseNodeType.Assignment &&
                                    targetNode.d.items.length === 1 &&
                                    !targetNode.d.trailingComma &&
                                    !targetNode.d.items[0].d.name &&
                                    targetNode.d.items[0].d.argCategory === ArgCategory.Simple &&
                                    targetNode.d.items[0].d.valueExpr.nodeType === ParseNodeType.StringList &&
                                    targetNode.d.items[0].d.valueExpr.d.strings.length === 1 &&
                                    targetNode.d.items[0].d.valueExpr.d.strings[0].nodeType === ParseNodeType.String
                                ) {
                                    const keyValue = targetNode.d.items[0].d.valueExpr.d.strings[0].d.value;
                                    const narrowedResult = preventRecursion(assignmentFlowNode, () => {
                                        const flowTypeResult = getTypeFromFlowNode(assignmentFlowNode.antecedent);

                                        if (flowTypeResult.type) {
                                            flowTypeResult.type = mapSubtypes(flowTypeResult.type, (subtype) => {
                                                if (isClass(subtype) && ClassType.isTypedDictClass(subtype)) {
                                                    return narrowForKeyAssignment(subtype, keyValue);
                                                }
                                                return subtype;
                                            });
                                        }

                                        return flowTypeResult;
                                    });

                                    return setCacheEntry(
                                        curFlowNode,
                                        narrowedResult?.type,
                                        !!narrowedResult?.isIncomplete
                                    );
                                }
                            }

                            if (isPartialMatchingExpression(reference, targetNode)) {
                                // If the node partially matches the reference, we need to "kill" any narrowed
                                // types further above this point. For example, if we see the sequence
                                //    a.b = 3
                                //    a = Foo()
                                //    x = a.b
                                // The type of "a.b" can no longer be assumed to be Literal[3].
                                return FlowNodeTypeResult.create(
                                    options?.typeAtStart?.type,
                                    !!options?.typeAtStart?.isIncomplete
                                );
                            }
                        }

                        curFlowNode = assignmentFlowNode.antecedent;
                        continue;
                    }

                    if (curFlowNode.flags & FlowFlags.BranchLabel) {
                        const branchFlowNode = curFlowNode as FlowBranchLabel;

                        if (curFlowNode.flags & FlowFlags.PostContextManager) {
                            // Determine whether any of the context managers support exception
                            // suppression. If not, none of its antecedents are reachable.
                            const contextMgrNode = curFlowNode as FlowPostContextManagerLabel;
                            const contextManagerSwallowsExceptions = contextMgrNode.expressions.some((expr) =>
                                isExceptionContextManager(evaluator, expr, contextMgrNode.isAsync)
                            );

                            if (contextManagerSwallowsExceptions === contextMgrNode.blockIfSwallowsExceptions) {
                                // Do not explore any further along this code flow path.
                                return setCacheEntry(curFlowNode, /* type */ undefined, /* isIncomplete */ false);
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
                                getFlowNodeReachability(curFlowNode, branchFlowNode.preBranchAntecedent) ===
                                    Reachability.Reachable
                            ) {
                                curFlowNode = branchFlowNode.preBranchAntecedent;
                                continue;
                            }
                        }

                        return getTypeFromBranchFlowNode(curFlowNode as FlowLabel);
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

                        return getTypeFromLoopFlowNode(loopNode, cachedEntry);
                    }

                    if (curFlowNode.flags & (FlowFlags.TrueCondition | FlowFlags.FalseCondition)) {
                        const conditionalFlowNode = curFlowNode as FlowCondition;

                        if (!options?.skipConditionalNarrowing && reference) {
                            const narrowedResult = preventRecursion(curFlowNode, () => {
                                const typeNarrowingCallback = getTypeNarrowingCallback(
                                    evaluator,
                                    reference,
                                    conditionalFlowNode.expression,
                                    !!(
                                        conditionalFlowNode.flags &
                                        (FlowFlags.TrueCondition | FlowFlags.TrueNeverCondition)
                                    )
                                );

                                if (typeNarrowingCallback) {
                                    const flowTypeResult = getTypeFromFlowNode(conditionalFlowNode.antecedent);
                                    let flowType = flowTypeResult.type;
                                    let isIncomplete = flowTypeResult.isIncomplete;

                                    if (flowType) {
                                        const flowTypeResult = typeNarrowingCallback(flowType);

                                        if (flowTypeResult) {
                                            flowType = flowTypeResult.type;
                                            if (flowTypeResult.isIncomplete) {
                                                isIncomplete = true;
                                            }
                                        }
                                    }

                                    return setCacheEntry(curFlowNode, flowType, isIncomplete);
                                }

                                return undefined;
                            });

                            if (narrowedResult) {
                                return narrowedResult;
                            }
                        }

                        curFlowNode = conditionalFlowNode.antecedent;
                        continue;
                    }

                    if (curFlowNode.flags & (FlowFlags.TrueNeverCondition | FlowFlags.FalseNeverCondition)) {
                        const conditionalFlowNode = curFlowNode as FlowCondition;
                        if (!options?.skipConditionalNarrowing && conditionalFlowNode.reference) {
                            // Don't allow apply if the conditional expression references the expression
                            // we're already narrowing. This case will be handled by the TrueCondition
                            // or FalseCondition node.
                            if (createKeyForReference(conditionalFlowNode.reference) !== referenceKey) {
                                // Make sure the reference type has a declared type. If not,
                                // don't bother trying to infer its type because that would be
                                // too expensive.
                                const symbolWithScope = evaluator.lookUpSymbolRecursive(
                                    conditionalFlowNode.reference,
                                    conditionalFlowNode.reference.d.value,
                                    /* honorCodeFlow */ false
                                );

                                if (symbolWithScope && symbolWithScope.symbol.hasTypedDeclarations()) {
                                    const result = preventRecursion(curFlowNode, () => {
                                        const typeNarrowingCallback = getTypeNarrowingCallback(
                                            evaluator,
                                            conditionalFlowNode.reference!,
                                            conditionalFlowNode.expression,
                                            !!(
                                                conditionalFlowNode.flags &
                                                (FlowFlags.TrueCondition | FlowFlags.TrueNeverCondition)
                                            )
                                        );

                                        if (typeNarrowingCallback) {
                                            const refTypeInfo = evaluator.getTypeOfExpression(
                                                conditionalFlowNode.reference!
                                            );

                                            let narrowedType = refTypeInfo.type;
                                            let isIncomplete = !!refTypeInfo.isIncomplete;

                                            const narrowedTypeResult = typeNarrowingCallback(refTypeInfo.type);
                                            if (narrowedTypeResult) {
                                                narrowedType = narrowedTypeResult.type;
                                                if (narrowedTypeResult.isIncomplete) {
                                                    isIncomplete = true;
                                                }
                                            }

                                            // If the narrowed type is "never", don't allow further exploration.
                                            if (isNever(narrowedType)) {
                                                return setCacheEntry(curFlowNode, undefined, isIncomplete);
                                            }
                                        }

                                        return undefined;
                                    });

                                    if (result) {
                                        return result;
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
                            evaluator.evaluateTypesForMatchStatement(exhaustedMatchFlowNode.node);
                        });

                        // If the narrowed type is "never", don't allow further exploration.
                        if (narrowedTypeResult) {
                            if (isNever(narrowedTypeResult.type)) {
                                return setCacheEntry(
                                    curFlowNode,
                                    narrowedTypeResult.type,
                                    !!narrowedTypeResult.isIncomplete
                                );
                            }

                            if (reference) {
                                // See if the reference is a subexpression within the subject expression.
                                const typeNarrowingCallback = getPatternSubtypeNarrowingCallback(
                                    evaluator,
                                    reference,
                                    exhaustedMatchFlowNode.subjectExpression
                                );

                                if (typeNarrowingCallback) {
                                    const subexpressionTypeResult = typeNarrowingCallback(narrowedTypeResult.type);

                                    if (subexpressionTypeResult) {
                                        return setCacheEntry(
                                            curFlowNode,
                                            subexpressionTypeResult.type,
                                            !!narrowedTypeResult.isIncomplete || !!subexpressionTypeResult.isIncomplete
                                        );
                                    }
                                }
                            }
                        }

                        curFlowNode = exhaustedMatchFlowNode.antecedent;
                        continue;
                    }

                    if (curFlowNode.flags & FlowFlags.NarrowForPattern) {
                        const patternFlowNode = curFlowNode as FlowNarrowForPattern;
                        if (!reference || isMatchingExpression(reference, patternFlowNode.subjectExpression)) {
                            const typeResult = evaluator.evaluateTypeForSubnode(patternFlowNode.statement, () => {
                                if (patternFlowNode.statement.nodeType === ParseNodeType.Case) {
                                    evaluator.evaluateTypesForCaseStatement(patternFlowNode.statement);
                                } else {
                                    evaluator.evaluateTypesForMatchStatement(patternFlowNode.statement);
                                }
                            });

                            if (typeResult) {
                                if (!reference) {
                                    if (isNever(typeResult.type)) {
                                        return setCacheEntry(
                                            curFlowNode,
                                            /* type */ undefined,
                                            !!typeResult.isIncomplete
                                        );
                                    }
                                } else {
                                    return setCacheEntry(curFlowNode, typeResult.type, !!typeResult.isIncomplete);
                                }
                            }
                        } else if (patternFlowNode.statement.nodeType === ParseNodeType.Case) {
                            const caseStatement = patternFlowNode.statement;

                            // See if the reference is a subexpression within the subject expression.
                            const typeNarrowingCallback = getPatternSubtypeNarrowingCallback(
                                evaluator,
                                reference,
                                patternFlowNode.subjectExpression
                            );

                            if (typeNarrowingCallback) {
                                const typeResult = evaluator.evaluateTypeForSubnode(caseStatement, () => {
                                    evaluator.evaluateTypesForCaseStatement(caseStatement);
                                });

                                if (typeResult) {
                                    const narrowedTypeResult = typeNarrowingCallback(typeResult.type);

                                    if (narrowedTypeResult) {
                                        return setCacheEntry(
                                            curFlowNode,
                                            narrowedTypeResult.type,
                                            !!typeResult.isIncomplete || !!narrowedTypeResult.isIncomplete
                                        );
                                    }
                                }
                            }
                        }
                        curFlowNode = patternFlowNode.antecedent;
                        continue;
                    }

                    if (curFlowNode.flags & FlowFlags.PreFinallyGate) {
                        return getTypeFromPreFinallyGateFlowNode(curFlowNode as FlowPreFinallyGate);
                    }

                    if (curFlowNode.flags & FlowFlags.PostFinally) {
                        return getTypeFromPostFinallyFlowNode(curFlowNode as FlowPostFinally);
                    }

                    if (curFlowNode.flags & FlowFlags.Start) {
                        return setCacheEntry(
                            curFlowNode,
                            options?.typeAtStart?.type,
                            !!options?.typeAtStart?.isIncomplete
                        );
                    }

                    if (curFlowNode.flags & FlowFlags.WildcardImport) {
                        const wildcardImportFlowNode = curFlowNode as FlowWildcardImport;
                        if (reference && reference.nodeType === ParseNodeType.Name) {
                            const nameValue = reference.d.value;
                            if (wildcardImportFlowNode.names.some((name) => name === nameValue)) {
                                return preventRecursion(curFlowNode, () => {
                                    const type = getTypeFromWildcardImport(wildcardImportFlowNode, nameValue);
                                    return setCacheEntry(curFlowNode, type, /* isIncomplete */ false);
                                });
                            }
                        }

                        curFlowNode = wildcardImportFlowNode.antecedent;
                        continue;
                    }

                    // We shouldn't get here.
                    fail('Unexpected flow node flags');
                }
            }

            function getTypeFromBranchFlowNode(branchNode: FlowLabel): FlowNodeTypeResult {
                const typesToCombine: Type[] = [];

                let sawIncomplete = false;

                for (const antecedent of branchNode.antecedents) {
                    const flowTypeResult = getTypeFromFlowNode(antecedent);

                    if (reference === undefined && flowTypeResult.type && !isNever(flowTypeResult.type)) {
                        // If we're solving for "reachability", and we have now proven
                        // reachability, there's no reason to do more work. The type we
                        // return here doesn't matter as long as it's not undefined.
                        return setCacheEntry(branchNode, UnknownType.create(), /* isIncomplete */ false);
                    }

                    if (flowTypeResult.isIncomplete) {
                        sawIncomplete = true;
                    }

                    if (flowTypeResult.type) {
                        typesToCombine.push(flowTypeResult.type);
                    }
                }

                const effectiveType = typesToCombine.length > 0 ? combineTypes(typesToCombine) : undefined;

                return setCacheEntry(branchNode, effectiveType, sawIncomplete);
            }

            function getTypeFromLoopFlowNode(
                loopNode: FlowLabel,
                cacheEntry: FlowNodeTypeResult | undefined
            ): FlowNodeTypeResult {
                // The type result from one antecedent may depend on the type
                // result from another, so loop up to one time for each
                // antecedent in the loop.
                const maxAttemptCount = loopNode.antecedents.length;

                if (cacheEntry === undefined) {
                    // We haven't been here before, so create a new incomplete cache entry.
                    cacheEntry = setCacheEntry(
                        loopNode,
                        reference ? undefined : UnknownType.create(),
                        /* isIncomplete */ true
                    );
                } else if (
                    cacheEntry.incompleteSubtypes &&
                    cacheEntry.incompleteSubtypes.length === loopNode.antecedents.length &&
                    cacheEntry.incompleteSubtypes.some((subtype) => subtype.isPending)
                ) {
                    // If entries have been added for all antecedents and there are pending entries
                    // that have not been evaluated even once, treat it as incomplete. We clean
                    // any incomplete unknowns from the type here to assist with type convergence.
                    return FlowNodeTypeResult.create(
                        cleanIncompleteUnknownForCacheEntry(cacheEntry),
                        /* isIncomplete */ true
                    );
                }

                let attemptCount = 0;

                while (true) {
                    let sawIncomplete = false;
                    let sawPending = false;
                    let isProvenReachable =
                        reference === undefined &&
                        cacheEntry.incompleteSubtypes?.some((subtype) => subtype.type !== undefined);
                    let firstAntecedentTypeIsIncomplete = false;
                    let firstAntecedentTypeIsPending = false;

                    loopNode.antecedents.forEach((antecedent, index) => {
                        // If we've trying to determine reachability and we've already proven
                        // reachability, then we're done.
                        if (reference === undefined && isProvenReachable) {
                            return;
                        }

                        if (firstAntecedentTypeIsPending && index > 0) {
                            return;
                        }

                        cacheEntry = getCacheEntry(loopNode)!;

                        // Is this entry marked "pending"? If so, we have recursed and there
                        // is another call on the stack that is actively evaluating this
                        // antecedent. Skip it here to avoid infinite recursion but note that
                        // we skipped a "pending" antecedent.
                        if (
                            cacheEntry.incompleteSubtypes &&
                            index < cacheEntry.incompleteSubtypes.length &&
                            cacheEntry.incompleteSubtypes[index].isPending
                        ) {
                            // In rare circumstances, it's possible for a code flow graph with
                            // nested loops to hit the case where the first antecedent is marked
                            // as pending. In this case, we'll evaluate only the first antecedent
                            // again even though it's pending. We're guaranteed to make forward
                            // progress with the first antecedent, and that will allow us to establish
                            // an initial type for this expression, but we don't want to evaluate
                            // any other antecedents in this case because this could result in
                            // infinite recursion.
                            if (index === 0) {
                                firstAntecedentTypeIsPending = true;
                            } else {
                                sawIncomplete = true;
                                sawPending = true;
                                return;
                            }
                        }

                        // Have we already been here (i.e. does the entry exist and is
                        // not marked "pending")? If so, we can use the type that was already
                        // computed if it is complete.
                        const subtypeEntry =
                            cacheEntry.incompleteSubtypes !== undefined && index < cacheEntry.incompleteSubtypes.length
                                ? cacheEntry.incompleteSubtypes[index]
                                : undefined;
                        if (subtypeEntry === undefined || (!subtypeEntry?.isPending && subtypeEntry?.isIncomplete)) {
                            const entryEvaluationCount = subtypeEntry === undefined ? 0 : subtypeEntry.evaluationCount;

                            // Does it look like this will never converge? If so, stick with the
                            // previously-computed type for this entry.
                            if (entryEvaluationCount >= maxConvergenceAttemptLimit) {
                                // Log this only once.
                                if (!maxConvergenceLimitHit && enablePrintConvergenceLimitHit) {
                                    console.log('Types failed to converge during code flow analysis');
                                }
                                maxConvergenceLimitHit = true;
                                return;
                            }

                            // Set this entry to "pending" to prevent infinite recursion.
                            // We'll mark it "not pending" below.
                            cacheEntry = setIncompleteSubtype(
                                loopNode,
                                index,
                                subtypeEntry?.type ?? UnknownType.create(/* isIncomplete */ true),
                                /* isIncomplete */ true,
                                /* isPending */ true,
                                entryEvaluationCount
                            );

                            try {
                                const flowTypeResult = getTypeFromFlowNode(antecedent);

                                if (flowTypeResult.isIncomplete) {
                                    sawIncomplete = true;

                                    if (index === 0) {
                                        firstAntecedentTypeIsIncomplete = true;
                                    }
                                }

                                cacheEntry = setIncompleteSubtype(
                                    loopNode,
                                    index,
                                    flowTypeResult.type ??
                                        (flowTypeResult.isIncomplete
                                            ? UnknownType.create(/* isIncomplete */ true)
                                            : NeverType.createNever()),
                                    flowTypeResult.isIncomplete,
                                    /* isPending */ firstAntecedentTypeIsPending,
                                    entryEvaluationCount + 1
                                );
                            } catch (e) {
                                cacheEntry = setIncompleteSubtype(
                                    loopNode,
                                    index,
                                    UnknownType.create(/* isIncomplete */ true),
                                    /* isIncomplete */ true,
                                    /* isPending */ firstAntecedentTypeIsPending,
                                    entryEvaluationCount + 1
                                );
                                throw e;
                            }
                        }

                        if (reference === undefined && cacheEntry?.type !== undefined) {
                            isProvenReachable = true;
                        }
                    });

                    if (isProvenReachable) {
                        // If we saw a pending entry, do not save over the top of the cache
                        // entry because we'll overwrite a pending evaluation. The type that
                        // we return here doesn't matter as long as it's not undefined.
                        return sawPending
                            ? FlowNodeTypeResult.create(UnknownType.create(), /* isIncomplete */ false)
                            : setCacheEntry(loopNode, UnknownType.create(), /* isIncomplete */ false);
                    }

                    let effectiveType = cacheEntry.type;
                    if (sawIncomplete) {
                        // If there is an incomplete "Unknown" type within a union type, remove
                        // it. Otherwise we might end up resolving the cycle with a type
                        // that includes an undesirable unknown.
                        if (effectiveType) {
                            const cleanedType = cleanIncompleteUnknown(effectiveType);
                            if (cleanedType !== effectiveType) {
                                effectiveType = cleanedType;
                            }
                        }
                    }

                    if (!sawIncomplete || attemptCount >= maxAttemptCount) {
                        // If we were able to evaluate a type along at least one antecedent
                        // path, mark it as complete. If we couldn't evaluate a type along
                        // any antecedent path, assume that some recursive call further
                        // up the stack will be able to produce a valid type.
                        let reportIncomplete = sawIncomplete;
                        if (
                            sawIncomplete &&
                            !sawPending &&
                            !isGetTypeFromCodeFlowPending(referenceKeyWithSymbolId) &&
                            effectiveType &&
                            !isIncompleteUnknown(effectiveType) &&
                            !firstAntecedentTypeIsIncomplete
                        ) {
                            reportIncomplete = false;
                        }

                        // If we saw a pending or incomplete entry, do not save over the top
                        // of the cache entry because we'll overwrite the partial result.
                        if (sawPending || sawIncomplete) {
                            if (!reportIncomplete) {
                                // Bump the generation count because we need to recalculate
                                // other incomplete types based on this now-complete type.
                                flowIncompleteGeneration++;
                            }

                            return FlowNodeTypeResult.create(effectiveType, reportIncomplete);
                        }

                        // If the first antecedent was pending, we skipped all of the other
                        // antecedents, so the type is incomplete.
                        if (firstAntecedentTypeIsPending) {
                            return FlowNodeTypeResult.create(effectiveType, /* isIncomplete */ true);
                        }

                        return setCacheEntry(loopNode, effectiveType, /* isIncomplete */ false);
                    }

                    attemptCount++;
                }
            }

            function getTypeFromPreFinallyGateFlowNode(preFinallyFlowNode: FlowPreFinallyGate): FlowNodeTypeResult {
                // Is the finally gate closed?
                if (flowNodeTypeCache.closedFinallyGateNodes.has(preFinallyFlowNode.id)) {
                    return FlowNodeTypeResult.create(/* type */ undefined, /* isIncomplete */ false);
                }

                const flowTypeResult = getTypeFromFlowNode(preFinallyFlowNode.antecedent);

                // We want to cache the type only if we're evaluating the "gate closed" path.
                deleteCacheEntry(preFinallyFlowNode);

                return FlowNodeTypeResult.create(flowTypeResult.type, flowTypeResult.isIncomplete);
            }

            function getTypeFromPostFinallyFlowNode(postFinallyFlowNode: FlowPostFinally): FlowNodeTypeResult {
                const wasGateClosed = flowNodeTypeCache.closedFinallyGateNodes.has(
                    postFinallyFlowNode.preFinallyGate.id
                );
                try {
                    flowNodeTypeCache.closedFinallyGateNodes.add(postFinallyFlowNode.preFinallyGate.id);
                    let flowTypeResult: FlowNodeTypeResult | undefined;

                    // Use speculative mode for the remainder of the finally suite
                    // because the final types within this parse node block should be
                    // evaluated when the gate is open.
                    evaluator.useSpeculativeMode(postFinallyFlowNode.finallyNode, () => {
                        flowTypeResult = getTypeFromFlowNode(postFinallyFlowNode.antecedent);
                    });

                    // If the type is incomplete, don't write back to the cache.
                    return flowTypeResult!.isIncomplete
                        ? flowTypeResult!
                        : setCacheEntry(postFinallyFlowNode, flowTypeResult!.type, /* isIncomplete */ false);
                } finally {
                    if (!wasGateClosed) {
                        flowNodeTypeCache.closedFinallyGateNodes.delete(postFinallyFlowNode.preFinallyGate.id);
                    }
                }
            }

            if (!flowNode) {
                // This should happen only in cases where we're evaluating
                // parse nodes that are created after the initial parse
                // (namely, string literals that are used for forward
                // referenced types).
                return FlowNodeTypeResult.create(options?.typeAtStart?.type, !!options?.typeAtStart?.isIncomplete);
            }

            return getTypeFromFlowNode(flowNode);
        }

        return {
            getTypeFromCodeFlow,
        };
    }

    // Determines whether the specified flowNode can be reached by any
    // control flow path within the execution context. If sourceFlowNode
    // is specified, it returns true only if at least one control flow
    // path passes through sourceFlowNode.
    function getFlowNodeReachability(
        flowNode: FlowNode,
        sourceFlowNode?: FlowNode,
        ignoreNoReturn = false
    ): Reachability {
        const visitedFlowNodeSet = new Set<number>();
        const closedFinallyGateSet = new Set<number>();

        if (enablePrintControlFlowGraph) {
            printControlFlowGraph(flowNode, /* reference */ undefined, 'getFlowNodeReachability');
        }

        function cacheReachabilityResult(reachability: Reachability): Reachability {
            // If there is a finally gate set, we will not cache the results
            // because this can affect the reachability.
            if (closedFinallyGateSet.size > 0) {
                return reachability;
            }

            let cacheEntry = reachabilityCache.get(flowNode.id);
            if (!cacheEntry) {
                cacheEntry = { reachability: undefined, reachabilityFrom: new Map<number, Reachability>() };
                reachabilityCache.set(flowNode.id, cacheEntry);
            }

            if (!sourceFlowNode) {
                cacheEntry.reachability = reachability;
            } else {
                cacheEntry.reachabilityFrom.set(sourceFlowNode.id, reachability);
            }

            return reachability;
        }

        function getFlowNodeReachabilityRecursive(flowNode: FlowNode, recursionCount = 0): Reachability {
            // Cut off the recursion at some point to prevent a stack overflow.
            const maxFlowNodeReachableRecursionCount = 64;
            if (recursionCount > maxFlowNodeReachableRecursionCount) {
                return Reachability.Reachable;
            }
            recursionCount++;

            let curFlowNode = flowNode;

            while (true) {
                // See if we've already cached this result.
                const cacheEntry = reachabilityCache.get(flowNode.id);
                if (cacheEntry !== undefined && closedFinallyGateSet.size === 0) {
                    if (!sourceFlowNode) {
                        if (cacheEntry.reachability !== undefined) {
                            return cacheEntry.reachability;
                        }
                    } else {
                        const reachabilityFrom = cacheEntry.reachabilityFrom.get(sourceFlowNode.id);
                        if (reachabilityFrom !== undefined) {
                            return reachabilityFrom;
                        }
                    }
                }

                // If we've already visited this node, we can assume
                // it wasn't reachable.
                if (visitedFlowNodeSet.has(curFlowNode.id)) {
                    return cacheReachabilityResult(Reachability.UnreachableAlways);
                }

                // Note that we've been here before.
                visitedFlowNodeSet.add(curFlowNode.id);

                if (curFlowNode.flags & FlowFlags.Unreachable) {
                    return cacheReachabilityResult(Reachability.UnreachableAlways);
                }

                if (curFlowNode === sourceFlowNode) {
                    return cacheReachabilityResult(Reachability.Reachable);
                }

                if (
                    curFlowNode.flags &
                    (FlowFlags.VariableAnnotation |
                        FlowFlags.Assignment |
                        FlowFlags.WildcardImport |
                        FlowFlags.ExhaustedMatch)
                ) {
                    const typedFlowNode = curFlowNode as
                        | FlowVariableAnnotation
                        | FlowAssignment
                        | FlowWildcardImport
                        | FlowExhaustedMatch;
                    curFlowNode = typedFlowNode.antecedent;
                    continue;
                }

                if (curFlowNode.flags & FlowFlags.NarrowForPattern) {
                    const patternFlowNode = curFlowNode as FlowNarrowForPattern;

                    const typeResult = evaluator.evaluateTypeForSubnode(patternFlowNode.statement, () => {
                        if (patternFlowNode.statement.nodeType === ParseNodeType.Case) {
                            evaluator.evaluateTypesForCaseStatement(patternFlowNode.statement);
                        } else {
                            evaluator.evaluateTypesForMatchStatement(patternFlowNode.statement);
                        }
                    });

                    if (typeResult && isNever(typeResult.type)) {
                        return cacheReachabilityResult(Reachability.UnreachableByAnalysis);
                    }

                    curFlowNode = patternFlowNode.antecedent;
                    continue;
                }

                if (
                    curFlowNode.flags &
                    (FlowFlags.TrueCondition |
                        FlowFlags.FalseCondition |
                        FlowFlags.TrueNeverCondition |
                        FlowFlags.FalseNeverCondition)
                ) {
                    const conditionalFlowNode = curFlowNode as FlowCondition;
                    if (conditionalFlowNode.reference) {
                        // Make sure the reference type has a declared type. If not,
                        // don't bother trying to infer its type because that would be
                        // too expensive.
                        const symbolWithScope = evaluator.lookUpSymbolRecursive(
                            conditionalFlowNode.reference,
                            conditionalFlowNode.reference.d.value,
                            /* honorCodeFlow */ false
                        );

                        if (symbolWithScope && symbolWithScope.symbol.hasTypedDeclarations()) {
                            let isUnreachable = false;

                            const typeNarrowingCallback = getTypeNarrowingCallback(
                                evaluator,
                                conditionalFlowNode.reference!,
                                conditionalFlowNode.expression,
                                !!(conditionalFlowNode.flags & (FlowFlags.TrueCondition | FlowFlags.TrueNeverCondition))
                            );

                            if (typeNarrowingCallback) {
                                const refTypeInfo = evaluator.getTypeOfExpression(conditionalFlowNode.reference!);

                                const narrowedTypeResult = typeNarrowingCallback(refTypeInfo.type);
                                const narrowedType = narrowedTypeResult?.type ?? refTypeInfo.type;

                                if (isNever(narrowedType) && !refTypeInfo.isIncomplete) {
                                    isUnreachable = true;
                                }
                            }

                            if (isUnreachable) {
                                return cacheReachabilityResult(Reachability.UnreachableByAnalysis);
                            }
                        }
                    }

                    curFlowNode = conditionalFlowNode.antecedent;
                    continue;
                }

                if (curFlowNode.flags & FlowFlags.Call) {
                    const callFlowNode = curFlowNode as FlowCall;

                    // If this function returns a "NoReturn" type, that means
                    // it always raises an exception or otherwise doesn't return,
                    // so we can assume that the code before this is unreachable.
                    if (!ignoreNoReturn && isCallNoReturn(evaluator, callFlowNode)) {
                        return cacheReachabilityResult(Reachability.UnreachableByAnalysis);
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
                                isExceptionContextManager(evaluator, expr, contextMgrNode.isAsync)
                            )
                        ) {
                            return cacheReachabilityResult(Reachability.UnreachableByAnalysis);
                        }
                    }

                    const labelNode = curFlowNode as FlowLabel;
                    let unreachableByType = false;
                    for (const antecedent of labelNode.antecedents) {
                        const reachability = getFlowNodeReachabilityRecursive(antecedent, recursionCount);
                        if (reachability === Reachability.Reachable) {
                            return cacheReachabilityResult(reachability);
                        } else if (reachability === Reachability.UnreachableByAnalysis) {
                            unreachableByType = true;
                        }
                    }
                    return cacheReachabilityResult(
                        unreachableByType ? Reachability.UnreachableByAnalysis : Reachability.UnreachableAlways
                    );
                }

                if (curFlowNode.flags & FlowFlags.Start) {
                    // If we hit the start but were looking for a particular source flow
                    // node, return false. Otherwise, the start is what we're looking for.
                    return cacheReachabilityResult(
                        sourceFlowNode ? Reachability.UnreachableByAnalysis : Reachability.Reachable
                    );
                }

                if (curFlowNode.flags & FlowFlags.PreFinallyGate) {
                    const preFinallyFlowNode = curFlowNode as FlowPreFinallyGate;
                    if (closedFinallyGateSet.has(preFinallyFlowNode.id)) {
                        return cacheReachabilityResult(Reachability.UnreachableByAnalysis);
                    }

                    curFlowNode = preFinallyFlowNode.antecedent;
                    continue;
                }

                if (curFlowNode.flags & FlowFlags.PostFinally) {
                    const postFinallyFlowNode = curFlowNode as FlowPostFinally;
                    const wasGateClosed = closedFinallyGateSet.has(postFinallyFlowNode.preFinallyGate.id);

                    try {
                        closedFinallyGateSet.add(postFinallyFlowNode.preFinallyGate.id);
                        return cacheReachabilityResult(
                            getFlowNodeReachabilityRecursive(postFinallyFlowNode.antecedent, recursionCount)
                        );
                    } finally {
                        if (!wasGateClosed) {
                            closedFinallyGateSet.delete(postFinallyFlowNode.preFinallyGate.id);
                        }
                    }
                }

                // We shouldn't get here.
                fail('Unexpected flow node flags');
                return cacheReachabilityResult(Reachability.Reachable);
            }
        }

        // Protect against infinite recursion.
        if (isReachableRecursionSet.has(flowNode.id)) {
            return Reachability.UnreachableByAnalysis;
        }
        isReachableRecursionSet.add(flowNode.id);

        try {
            return getFlowNodeReachabilityRecursive(flowNode);
        } finally {
            isReachableRecursionSet.delete(flowNode.id);
        }
    }

    // Determines whether the specified typeVar, which is assumed to be constrained,
    // can be narrowed to one of its constrained types based on isinstance type
    // guard checks.
    function narrowConstrainedTypeVar(flowNode: FlowNode, typeVar: TypeVarType): ClassType | undefined {
        assert(!isParamSpec(typeVar));
        assert(!isTypeVarTuple(typeVar));
        assert(!TypeVarType.hasBound(typeVar));
        assert(TypeVarType.hasConstraints(typeVar));

        const visitedFlowNodeMap = new Set<number>();
        const startingConstraints: ClassType[] = [];

        for (const constraint of typeVar.shared.constraints) {
            if (isClassInstance(constraint)) {
                startingConstraints.push(constraint);
            } else {
                // If one or more constraints are Unknown, Any, union types, etc.,
                // we can't narrow them.
                return undefined;
            }
        }

        function narrowConstrainedTypeVarRecursive(flowNode: FlowNode, typeVar: TypeVarType): ClassType[] {
            let curFlowNode = flowNode;

            while (true) {
                if (visitedFlowNodeMap.has(curFlowNode.id)) {
                    return startingConstraints;
                }

                if (curFlowNode.flags & (FlowFlags.Unreachable | FlowFlags.Start)) {
                    return startingConstraints;
                }

                if (
                    curFlowNode.flags &
                    (FlowFlags.VariableAnnotation |
                        FlowFlags.Assignment |
                        FlowFlags.WildcardImport |
                        FlowFlags.TrueNeverCondition |
                        FlowFlags.FalseNeverCondition |
                        FlowFlags.ExhaustedMatch |
                        FlowFlags.PostFinally |
                        FlowFlags.PreFinallyGate |
                        FlowFlags.Call)
                ) {
                    const typedFlowNode = curFlowNode as
                        | FlowVariableAnnotation
                        | FlowAssignment
                        | FlowWildcardImport
                        | FlowExhaustedMatch
                        | FlowPostFinally
                        | FlowPreFinallyGate
                        | FlowCall;
                    curFlowNode = typedFlowNode.antecedent;
                    continue;
                }

                // Handle a case statement with a class pattern.
                if (curFlowNode.flags & FlowFlags.NarrowForPattern) {
                    const narrowForPatternFlowNode = curFlowNode as FlowNarrowForPattern;
                    if (narrowForPatternFlowNode.statement.nodeType === ParseNodeType.Case) {
                        const subjectType = evaluator.getTypeOfExpression(
                            narrowForPatternFlowNode.subjectExpression
                        ).type;

                        if (isCompatibleWithConstrainedTypeVar(subjectType, typeVar)) {
                            const patternNode = narrowForPatternFlowNode.statement.d.pattern;

                            if (
                                patternNode.nodeType === ParseNodeType.PatternAs &&
                                patternNode.d.orPatterns.length === 1 &&
                                patternNode.d.orPatterns[0].nodeType === ParseNodeType.PatternClass
                            ) {
                                const classPatternNode = patternNode.d.orPatterns[0];

                                const classType = evaluator.getTypeOfExpression(
                                    classPatternNode.d.className,
                                    EvalFlags.CallBaseDefaults
                                ).type;

                                if (isInstantiableClass(classType)) {
                                    const priorRemainingConstraints = narrowConstrainedTypeVarRecursive(
                                        narrowForPatternFlowNode.antecedent,
                                        typeVar
                                    );

                                    return priorRemainingConstraints.filter((subtype) =>
                                        ClassType.isSameGenericClass(subtype, ClassType.cloneAsInstance(classType))
                                    );
                                }
                            }
                        }
                    }

                    curFlowNode = narrowForPatternFlowNode.antecedent;
                    continue;
                }

                // Handle an isinstance type guard.
                if (curFlowNode.flags & (FlowFlags.TrueCondition | FlowFlags.FalseCondition)) {
                    const conditionFlowNode = curFlowNode as FlowCondition;
                    const testExpression = conditionFlowNode.expression;
                    const isPositiveTest = (curFlowNode.flags & FlowFlags.TrueCondition) !== 0;

                    if (
                        testExpression.nodeType === ParseNodeType.Call &&
                        testExpression.d.leftExpr.nodeType === ParseNodeType.Name &&
                        testExpression.d.leftExpr.d.value === 'isinstance' &&
                        testExpression.d.args.length === 2
                    ) {
                        const arg0Expr = testExpression.d.args[0].d.valueExpr;

                        const arg0Type = evaluator.getTypeOfExpression(arg0Expr).type;

                        if (isCompatibleWithConstrainedTypeVar(arg0Type, typeVar)) {
                            // Prevent infinite recursion by noting that we've been here before.
                            visitedFlowNodeMap.add(curFlowNode.id);
                            const priorRemainingConstraints = narrowConstrainedTypeVarRecursive(
                                conditionFlowNode.antecedent,
                                typeVar
                            );
                            visitedFlowNodeMap.delete(curFlowNode.id);

                            const arg1Expr = testExpression.d.args[1].d.valueExpr;
                            const arg1Type = evaluator.getTypeOfExpression(
                                arg1Expr,
                                EvalFlags.AllowMissingTypeArgs |
                                    EvalFlags.StrLiteralAsType |
                                    EvalFlags.NoParamSpec |
                                    EvalFlags.NoTypeVarTuple |
                                    EvalFlags.NoFinal |
                                    EvalFlags.NoSpecialize
                            ).type;

                            if (isInstantiableClass(arg1Type)) {
                                return priorRemainingConstraints.filter((subtype) => {
                                    if (ClassType.isSameGenericClass(subtype, ClassType.cloneAsInstance(arg1Type))) {
                                        return isPositiveTest;
                                    } else {
                                        return !isPositiveTest;
                                    }
                                });
                            }
                        }
                    }

                    curFlowNode = conditionFlowNode.antecedent;
                    continue;
                }

                if (curFlowNode.flags & (FlowFlags.BranchLabel | FlowFlags.LoopLabel)) {
                    const labelNode = curFlowNode as FlowLabel;
                    const newConstraints: ClassType[] = [];

                    // Prevent infinite recursion by noting that we've been here before.
                    visitedFlowNodeMap.add(curFlowNode.id);
                    for (const antecedent of labelNode.antecedents) {
                        const constraintsToAdd = narrowConstrainedTypeVarRecursive(antecedent, typeVar);

                        for (const constraint of constraintsToAdd) {
                            if (!newConstraints.some((t) => isTypeSame(t, constraint))) {
                                newConstraints.push(constraint);
                            }
                        }
                    }
                    visitedFlowNodeMap.delete(curFlowNode.id);

                    return newConstraints;
                }

                // We shouldn't get here.
                fail('Unexpected flow node flags');
                return startingConstraints;
            }
        }

        const narrowedConstrainedType = narrowConstrainedTypeVarRecursive(flowNode, typeVar);

        // Have we narrowed the typeVar to a single constraint?
        return narrowedConstrainedType.length === 1 ? narrowedConstrainedType[0] : undefined;
    }

    // Determines whether a specified type is the same as a constrained
    // TypeVar or is conditioned on that same TypeVar or is some union of
    // the above.
    function isCompatibleWithConstrainedTypeVar(type: Type, typeVar: TypeVarType) {
        let isCompatible = true;
        doForEachSubtype(type, (subtype) => {
            if (isTypeVar(subtype)) {
                if (!isTypeSame(subtype, typeVar)) {
                    isCompatible = false;
                }
            } else if (subtype.props?.condition) {
                if (
                    !subtype.props.condition.some(
                        (condition) =>
                            TypeVarType.hasConstraints(condition.typeVar) &&
                            condition.typeVar.priv.nameWithScope === typeVar.priv.nameWithScope
                    )
                ) {
                    isCompatible = false;
                }
            } else {
                isCompatible = false;
            }
        });

        return isCompatible;
    }

    // Determines whether a call associated with this flow node returns a NoReturn
    // type, thus preventing further traversal of the code flow graph.
    function isCallNoReturn(evaluator: TypeEvaluator, flowNode: FlowCall) {
        const node = flowNode.node;
        const fileInfo = getFileInfo(node);

        // Assume that calls within a pyi file are not "NoReturn" calls.
        if (fileInfo.isStubFile) {
            return false;
        }

        if (enablePrintCallNoReturn) {
            console.log(`isCallNoReturn@${flowNode.id} Pre depth ${noReturnAnalysisDepth}`);
        }

        // See if this information is cached already.
        if (callIsNoReturnCache.has(node.id)) {
            const result = callIsNoReturnCache.get(node.id);

            if (enablePrintCallNoReturn) {
                console.log(`isCallNoReturn@${flowNode.id} Post: ${result ? 'true' : 'false'} (cached)`);
            }

            return result;
        }

        // See if we've exceeded the max recursion depth.
        if (noReturnAnalysisDepth > maxTypeRecursionCount) {
            return false;
        }

        // Don't attempt to evaluate a lambda call. We need to evaluate these in the
        // context of its arguments.
        if (node.d.leftExpr.nodeType === ParseNodeType.Lambda) {
            return false;
        }

        // Initially set to false to avoid recursion.
        callIsNoReturnCache.set(node.id, false);

        noReturnAnalysisDepth++;

        try {
            let noReturnTypeCount = 0;
            let subtypeCount = 0;

            // Evaluate the call base type.
            const callTypeResult = evaluator.getTypeOfExpression(node.d.leftExpr, EvalFlags.CallBaseDefaults);
            const callType = callTypeResult.type;

            doForEachSubtype(callType, (callSubtype) => {
                // Track the number of subtypes we've examined.
                subtypeCount++;

                if (isInstantiableClass(callSubtype)) {
                    // Does the class have a custom metaclass that implements a `__call__` method?
                    // If so, it will be called instead of `__init__` or `__new__`. We'll assume
                    // in this case that the __call__ method is not a NoReturn type.
                    const metaclassCallResult = getBoundCallMethod(evaluator, node, callSubtype);
                    if (metaclassCallResult) {
                        return;
                    }

                    const newMethodResult = getBoundNewMethod(evaluator, node, callSubtype);
                    if (newMethodResult) {
                        if (isFunctionOrOverloaded(newMethodResult.type)) {
                            callSubtype = newMethodResult.type;
                        }
                    }
                } else if (isClassInstance(callSubtype)) {
                    const callMethodType = evaluator.getBoundMagicMethod(callSubtype, '__call__');

                    if (callMethodType) {
                        callSubtype = callMethodType;
                    }
                }

                const isCallAwaited = node.parent?.nodeType === ParseNodeType.Await;
                if (isFunction(callSubtype)) {
                    if (isFunctionNoReturn(callSubtype, isCallAwaited)) {
                        noReturnTypeCount++;
                    }
                } else if (isOverloaded(callSubtype)) {
                    let overloadCount = 0;
                    let noReturnOverloadCount = 0;

                    OverloadedType.getOverloads(callSubtype).forEach((overload) => {
                        overloadCount++;

                        if (isFunctionNoReturn(overload, isCallAwaited)) {
                            noReturnOverloadCount++;
                        }
                    });

                    // Was at least one of the overloaded return types NoReturn?
                    if (noReturnOverloadCount > 0) {
                        // Do all of the overloads return NoReturn?
                        if (noReturnOverloadCount === overloadCount) {
                            noReturnTypeCount++;
                        } else {
                            // Perform a more complete evaluation to determine whether
                            // the applicable overload returns a NoReturn.
                            const callResult = evaluator.validateOverloadedArgTypes(
                                node,
                                node.d.args.map((arg) => evaluator.convertNodeToArg(arg)),
                                { type: callSubtype, isIncomplete: callTypeResult.isIncomplete },
                                /* constraints */ undefined,
                                /* skipUnknownArgCheck */ false,
                                /* inferenceContext */ undefined
                            );

                            if (callResult.returnType && isNever(callResult.returnType)) {
                                noReturnTypeCount++;
                            }
                        }
                    }
                }
            });

            // The call is considered NoReturn if all subtypes evaluate to NoReturn.
            const callIsNoReturn = subtypeCount > 0 && noReturnTypeCount === subtypeCount;

            // Cache the value for next time.
            callIsNoReturnCache.set(node.id, callIsNoReturn);

            if (enablePrintCallNoReturn) {
                console.log(`isCallNoReturn@${flowNode.id} Post: ${callIsNoReturn ? 'true' : 'false'}`);
            }

            return callIsNoReturn;
        } finally {
            noReturnAnalysisDepth--;
        }
    }

    function isFunctionNoReturn(functionType: FunctionType, isCallAwaited: boolean) {
        const returnType = FunctionType.getEffectiveReturnType(functionType, /* includeInferred */ false);
        if (returnType) {
            if (
                isClassInstance(returnType) &&
                ClassType.isBuiltIn(returnType, ['Coroutine', 'CoroutineType']) &&
                returnType.priv.typeArgs &&
                returnType.priv.typeArgs.length >= 3
            ) {
                if (isNever(returnType.priv.typeArgs[2]) && isCallAwaited) {
                    return true;
                }
            }

            return isNever(returnType);
        } else if (!inferNoReturnForUnannotatedFunctions) {
            return false;
        } else if (functionType.shared.declaration) {
            // If the function is a generator (i.e. it has yield statements)
            // then it is not a "no return" call. Also, don't infer a "no
            // return" type for abstract methods.
            if (
                !functionType.shared.declaration.isGenerator &&
                !FunctionType.isAbstractMethod(functionType) &&
                !FunctionType.isStubDefinition(functionType) &&
                !FunctionType.isPyTypedDefinition(functionType)
            ) {
                // Check specifically for a common idiom where the only statement
                // (other than a possible docstring) is a "raise NotImplementedError".
                const functionStatements = functionType.shared.declaration.node.d.suite.d.statements;

                let foundRaiseNotImplemented = false;
                for (const statement of functionStatements) {
                    if (statement.nodeType !== ParseNodeType.StatementList || statement.d.statements.length !== 1) {
                        break;
                    }

                    const simpleStatement = statement.d.statements[0];
                    if (simpleStatement.nodeType === ParseNodeType.StringList) {
                        continue;
                    }

                    if (simpleStatement.nodeType === ParseNodeType.Raise && simpleStatement.d.expr) {
                        // Check for a raising about 'NotImplementedError' or a subtype thereof.
                        const exceptionType = evaluator.getType(simpleStatement.d.expr);

                        if (
                            exceptionType &&
                            isClass(exceptionType) &&
                            derivesFromStdlibClass(exceptionType, 'NotImplementedError')
                        ) {
                            foundRaiseNotImplemented = true;
                        }
                    }

                    break;
                }

                if (!foundRaiseNotImplemented && !isAfterNodeReachable(evaluator, functionType)) {
                    return true;
                }
            }
        }

        return false;
    }

    function isAfterNodeReachable(evaluator: TypeEvaluator, functionType: FunctionType) {
        if (!functionType.shared.declaration) {
            return true;
        }

        return evaluator.isAfterNodeReachable(functionType.shared.declaration.node);
    }

    // Performs a cursory analysis to determine whether the expression
    // corresponds to a context manager object that supports the swallowing
    // of exceptions. By convention, these objects have an "__exit__" method
    // that returns a bool response (as opposed to a None). This function is
    // called during code flow, so it can't rely on full type evaluation. It
    // makes some simplifying assumptions that work in most cases.
    function isExceptionContextManager(evaluator: TypeEvaluator, node: ExpressionNode, isAsync: boolean) {
        // See if this information is cached already.
        if (isExceptionContextManagerCache.has(node.id)) {
            return isExceptionContextManagerCache.get(node.id);
        }

        // Initially set to false to avoid infinite recursion.
        isExceptionContextManagerCache.set(node.id, false);

        // See if we've exceeded the max recursion depth.
        if (contextManagerAnalysisDepth > maxTypeRecursionCount) {
            return false;
        }

        contextManagerAnalysisDepth++;
        let cmSwallowsExceptions = false;

        try {
            const cmType = evaluator.getTypeOfExpression(node).type;

            if (cmType && isClassInstance(cmType)) {
                const exitMethodName = isAsync ? '__aexit__' : '__exit__';
                const exitType = evaluator.getBoundMagicMethod(cmType, exitMethodName);

                if (exitType && isFunction(exitType) && exitType.shared.declaredReturnType) {
                    let returnType = exitType.shared.declaredReturnType;

                    // If it's an __aexit__ method, its return type will typically be wrapped
                    // in a Coroutine, so we need to extract the return type from the third
                    // type argument.
                    if (isAsync) {
                        if (
                            isClassInstance(returnType) &&
                            ClassType.isBuiltIn(returnType, ['Coroutine', 'CoroutineType']) &&
                            returnType.priv.typeArgs &&
                            returnType.priv.typeArgs.length >= 3
                        ) {
                            returnType = returnType.priv.typeArgs[2];
                        }
                    }

                    cmSwallowsExceptions = false;
                    if (isClassInstance(returnType) && ClassType.isBuiltIn(returnType, 'bool')) {
                        if (returnType.priv.literalValue === undefined || returnType.priv.literalValue === true) {
                            cmSwallowsExceptions = true;
                        }
                    }
                }
            }
        } finally {
            contextManagerAnalysisDepth--;
        }

        // Cache the value for next time.
        isExceptionContextManagerCache.set(node.id, cmSwallowsExceptions);

        return cmSwallowsExceptions;
    }

    function getTypeFromWildcardImport(flowNode: FlowWildcardImport, name: string): Type {
        const importInfo = getImportInfo(flowNode.node.d.module);
        assert(importInfo !== undefined && importInfo.isImportFound);
        assert(flowNode.node.d.isWildcardImport);

        const symbolWithScope = evaluator.lookUpSymbolRecursive(flowNode.node, name, /* honorCodeFlow */ false);
        assert(symbolWithScope !== undefined);
        const decls = symbolWithScope!.symbol.getDeclarations();
        const wildcardDecl = decls.find((decl) => decl.node === flowNode.node);

        if (!wildcardDecl) {
            return UnknownType.create();
        }

        return evaluator.getInferredTypeOfDeclaration(symbolWithScope!.symbol, wildcardDecl) || UnknownType.create();
    }

    function printControlFlowGraph(
        flowNode: FlowNode,
        reference: CodeFlowReferenceExpressionNode | undefined,
        callName: string,
        logger: ConsoleInterface = console
    ) {
        let referenceText = '';
        if (reference) {
            const fileInfo = getFileInfo(reference);
            const pos = convertOffsetToPosition(reference.start, fileInfo.lines);
            referenceText = `${printExpression(reference)}[${pos.line + 1}:${pos.character + 1}]`;
        }

        logger.log(`${callName}@${flowNode.id}: ${referenceText || '(none)'}`);
        logger.log(formatControlFlowGraph(flowNode));
    }

    return {
        createCodeFlowAnalyzer,
        getFlowNodeReachability,
        narrowConstrainedTypeVar,
        printControlFlowGraph,
    };
}
