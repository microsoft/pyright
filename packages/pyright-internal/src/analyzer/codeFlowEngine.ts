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
import { ArgumentCategory, ExpressionNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
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
import { isMatchingExpression, isPartialMatchingExpression, printExpression } from './parseTreeUtils';
import { SpeculativeTypeTracker } from './typeCacheUtils';
import { narrowForKeyAssignment } from './typedDicts';
import { EvaluatorFlags, TypeEvaluator, TypeResult } from './typeEvaluatorTypes';
import { getTypeNarrowingCallback } from './typeGuards';
import {
    ClassType,
    cleanIncompleteUnknown,
    combineTypes,
    FunctionType,
    isClass,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    isNever,
    isOverloadedFunction,
    isTypeSame,
    isTypeVar,
    maxTypeRecursionCount,
    NeverType,
    OverloadedFunctionType,
    Type,
    TypeVarType,
    UnboundType,
    UnknownType,
} from './types';
import {
    ClassMemberLookupFlags,
    doForEachSubtype,
    isIncompleteUnknown,
    isTypeAliasPlaceholder,
    lookUpClassMember,
    mapSubtypes,
} from './typeUtils';

export interface FlowNodeTypeResult {
    type: Type | undefined;
    isIncomplete: boolean;
    generationCount?: number | undefined;
    incompleteType?: Type | undefined;
    incompleteSubtypes?: IncompleteSubtypeInfo[] | undefined;
}

export interface FlowNodeTypeOptions {
    isTypeAtStartIncomplete?: boolean;
    skipNoReturnCallAnalysis?: boolean;
    skipConditionalNarrowing?: boolean;
}

export interface CodeFlowAnalyzer {
    getTypeFromCodeFlow: (
        flowNode: FlowNode,
        reference: CodeFlowReferenceExpressionNode | undefined,
        targetSymbolId: number | undefined,
        typeAtStart: Type,
        options?: FlowNodeTypeOptions
    ) => FlowNodeTypeResult;
}

export interface CodeFlowEngine {
    createCodeFlowAnalyzer: () => CodeFlowAnalyzer;
    isFlowNodeReachable: (flowNode: FlowNode, sourceFlowNode?: FlowNode, ignoreNoReturn?: boolean) => boolean;
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

// Define a user type guard function for IncompleteType.
export function isIncompleteType(cachedType: CachedType): cachedType is IncompleteType {
    return !!(cachedType as IncompleteType).isIncompleteType;
}

export type CachedType = Type | IncompleteType;

interface CodeFlowTypeCache {
    cache: Map<number, CachedType | undefined>;
    pendingNodes: Set<number>;
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

export function getCodeFlowEngine(
    evaluator: TypeEvaluator,
    speculativeTypeTracker: SpeculativeTypeTracker
): CodeFlowEngine {
    const isReachableRecursionMap = new Map<number, true>();
    const callIsNoReturnCache = new Map<number, boolean>();
    const isExceptionContextManagerCache = new Map<number, boolean>();
    let flowIncompleteGeneration = 1;
    let noReturnAnalysisDepth = 0;
    let contextManagerAnalysisDepth = 0;

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
                };
                flowNodeTypeCacheSet.set(referenceKey, flowNodeTypeCache);
            }

            return flowNodeTypeCache;
        }

        // This function has two primary modes. The first is used to determine
        // the narrowed type of a reference expression based on code flow analysis.
        // The second (when reference is undefined) is used to determine whether
        // the specified flowNode is reachable when "never narrowing" is applied.
        function getTypeFromCodeFlow(
            flowNode: FlowNode,
            reference: CodeFlowReferenceExpressionNode | undefined,
            targetSymbolId: number | undefined,
            typeAtStart: Type,
            options?: FlowNodeTypeOptions
        ): FlowNodeTypeResult {
            if (enablePrintControlFlowGraph) {
                printControlFlowGraph(flowNode, reference, 'getTypeFromCodeFlow');
            }

            const referenceKey = reference !== undefined ? createKeyForReference(reference) : undefined;
            let subexpressionReferenceKeys: string[] | undefined;
            const referenceKeyWithSymbolId =
                referenceKey !== undefined && targetSymbolId !== undefined
                    ? referenceKey + `.${targetSymbolId.toString()}`
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

                return {
                    type,
                    isIncomplete,
                    generationCount: flowIncompleteGeneration,
                    incompleteSubtypes: isIncomplete ? [] : undefined,
                };
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
                    fail('setIncompleteSubtype can be called only on a valid incomplete cache entry');
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
                    return { type: undefined, isIncomplete: false };
                }

                if (!isIncompleteType(cachedEntry)) {
                    return { type: cachedEntry, isIncomplete: false };
                }

                return {
                    type: cachedEntry.type,
                    isIncomplete: true,
                    incompleteSubtypes: cachedEntry.incompleteSubtypes,
                    generationCount: cachedEntry.generationCount,
                };
            }

            function deleteCacheEntry(flowNode: FlowNode) {
                flowNodeTypeCache.cache.delete(flowNode.id);
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
                            return {
                                type: cachedEntry.type ? cleanIncompleteUnknown(cachedEntry.type) : undefined,
                                isIncomplete: true,
                            };
                        }
                    }

                    // Check for recursion.
                    if (flowNodeTypeCache.pendingNodes.has(curFlowNode.id)) {
                        return {
                            type: cachedEntry?.type ?? UnknownType.create(/* isIncomplete */ true),
                            isIncomplete: true,
                        };
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
                        if (!options?.skipNoReturnCallAnalysis && isCallNoReturn(evaluator, callFlowNode)) {
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
                                targetSymbolId === assignmentFlowNode.targetSymbolId &&
                                isMatchingExpression(reference, targetNode)
                            ) {
                                // Is this a special "unbind" assignment? If so,
                                // we can handle it immediately without any further evaluation.
                                if (curFlowNode.flags & FlowFlags.Unbind) {
                                    return setCacheEntry(curFlowNode, UnboundType.create(), /* isIncomplete */ false);
                                }

                                let flowTypeResult = preventRecursion(curFlowNode, () =>
                                    evaluateAssignmentFlowNode(assignmentFlowNode)
                                );

                                if (flowTypeResult) {
                                    if (isTypeAliasPlaceholder(flowTypeResult.type)) {
                                        flowTypeResult = undefined;
                                    } else if (
                                        reference.nodeType === ParseNodeType.MemberAccess &&
                                        evaluator.isAsymmetricDescriptorAssignment(targetNode)
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
                                isMatchingExpression(reference, targetNode.baseExpression)
                            ) {
                                if (
                                    targetNode.parent?.nodeType === ParseNodeType.Assignment &&
                                    targetNode.items.length === 1 &&
                                    !targetNode.trailingComma &&
                                    !targetNode.items[0].name &&
                                    targetNode.items[0].argumentCategory === ArgumentCategory.Simple &&
                                    targetNode.items[0].valueExpression.nodeType === ParseNodeType.StringList &&
                                    targetNode.items[0].valueExpression.strings.length === 1 &&
                                    targetNode.items[0].valueExpression.strings[0].nodeType === ParseNodeType.String
                                ) {
                                    const keyValue = targetNode.items[0].valueExpression.strings[0].value;
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
                                return {
                                    type: typeAtStart,
                                    isIncomplete: !!options?.isTypeAtStartIncomplete,
                                };
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
                                isFlowNodeReachable(curFlowNode, branchFlowNode.preBranchAntecedent)
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
                                    conditionalFlowNode.reference.value,
                                    /* honorCodeFlow */ false
                                );

                                if (symbolWithScope && symbolWithScope.symbol.getTypedDeclarations().length > 0) {
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
                        if (narrowedTypeResult && isNever(narrowedTypeResult.type)) {
                            return setCacheEntry(
                                curFlowNode,
                                narrowedTypeResult.type,
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
                        return setCacheEntry(curFlowNode, typeAtStart, !!options?.isTypeAtStartIncomplete);
                    }

                    if (curFlowNode.flags & FlowFlags.WildcardImport) {
                        const wildcardImportFlowNode = curFlowNode as FlowWildcardImport;
                        if (reference && reference.nodeType === ParseNodeType.Name) {
                            const nameValue = reference.value;
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

                return preventRecursion(branchNode, () => {
                    for (const antecedent of branchNode.antecedents) {
                        const flowTypeResult = getTypeFromFlowNode(antecedent);

                        if (reference === undefined && flowTypeResult.type && !isNever(flowTypeResult.type)) {
                            // If we're solving for "reachability", and we have now proven
                            // reachability, there's no reason to do more work.
                            return setCacheEntry(branchNode, typeAtStart, /* isIncomplete */ false);
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
                });
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
                    cacheEntry = setCacheEntry(loopNode, reference ? undefined : typeAtStart, /* isIncomplete */ true);
                } else if (
                    cacheEntry.incompleteSubtypes &&
                    cacheEntry.incompleteSubtypes.length === loopNode.antecedents.length &&
                    cacheEntry.incompleteSubtypes.some((subtype) => subtype.isPending)
                ) {
                    // If entries have been added for all antecedents and there are pending entries
                    // that have not been evaluated even once, treat it as incomplete.
                    return { type: cacheEntry.type, isIncomplete: true };
                }

                let attemptCount = 0;

                while (true) {
                    let sawIncomplete = false;
                    let sawPending = false;
                    let isProvenReachable =
                        reference === undefined &&
                        cacheEntry.incompleteSubtypes?.some((subtype) => subtype.type !== undefined);
                    let firstAntecedentTypeIsIncomplete = false;

                    loopNode.antecedents.forEach((antecedent, index) => {
                        // If we've trying to determine reachability and we've already proven
                        // reachability, then we're done.
                        if (reference === undefined && isProvenReachable) {
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
                            sawIncomplete = true;
                            sawPending = true;
                            return;
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
                                    /* isPending */ false,
                                    entryEvaluationCount + 1
                                );
                            } catch (e) {
                                setIncompleteSubtype(
                                    loopNode,
                                    index,
                                    UnknownType.create(/* isIncomplete */ true),
                                    /* isIncomplete */ true,
                                    /* isPending */ false,
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
                        // entry because we'll overwrite a pending evaluation.
                        return sawPending
                            ? { type: typeAtStart, isIncomplete: false }
                            : setCacheEntry(loopNode, typeAtStart, /* isIncomplete */ false);
                    }

                    let effectiveType = cacheEntry.type;
                    if (sawIncomplete) {
                        // If there is an incomplete "Unknown" type within a union type, remove
                        // it. Otherwise we might end up resolving the cycle with a type
                        // that includes an undesirable unknown.
                        if (effectiveType) {
                            effectiveType = cleanIncompleteUnknown(effectiveType);
                        }
                    }

                    if (!sawIncomplete || attemptCount >= maxAttemptCount) {
                        // If we were able to evaluate a type along at least one antecedent
                        // path, mark it as complete. If we couldn't evaluate a type along
                        // any antecedent path, assume that some recursive call further
                        // up the stack will be able to produce a valid type.
                        let reportIncomplete = sawIncomplete;
                        if (
                            !sawPending &&
                            effectiveType &&
                            !isIncompleteUnknown(effectiveType) &&
                            !firstAntecedentTypeIsIncomplete
                        ) {
                            // Bump the generation count because we need to recalculate
                            // other incomplete types based on this now-complete type.
                            flowIncompleteGeneration++;
                            reportIncomplete = false;
                        }

                        // If we saw a pending or incomplete entry, do not save over the top
                        // of the cache entry because we'll overwrite the partial result.
                        if (sawPending || sawIncomplete) {
                            return { type: effectiveType, isIncomplete: reportIncomplete };
                        }

                        return setCacheEntry(loopNode, effectiveType, /* isIncomplete */ false);
                    }

                    attemptCount++;
                }
            }

            function getTypeFromPreFinallyGateFlowNode(preFinallyFlowNode: FlowPreFinallyGate): FlowNodeTypeResult {
                if (preFinallyFlowNode.isGateClosed) {
                    return { type: undefined, isIncomplete: false };
                }

                return preventRecursion(preFinallyFlowNode, () => {
                    const flowTypeResult = getTypeFromFlowNode(preFinallyFlowNode.antecedent);

                    // We want to cache the type only if we're evaluating the "gate closed" path.
                    deleteCacheEntry(preFinallyFlowNode);

                    return {
                        type: flowTypeResult.type,
                        isIncomplete: flowTypeResult.isIncomplete,
                    };
                });
            }

            function getTypeFromPostFinallyFlowNode(postFinallyFlowNode: FlowPostFinally): FlowNodeTypeResult {
                const wasGateClosed = postFinallyFlowNode.preFinallyGate.isGateClosed;
                try {
                    postFinallyFlowNode.preFinallyGate.isGateClosed = true;
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
                    postFinallyFlowNode.preFinallyGate.isGateClosed = wasGateClosed;
                }
            }

            if (!flowNode) {
                // This should happen only in cases where we're evaluating
                // parse nodes that are created after the initial parse
                // (namely, string literals that are used for forward
                // referenced types).
                return {
                    type: typeAtStart,
                    isIncomplete: !!options?.isTypeAtStartIncomplete,
                };
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
    function isFlowNodeReachable(flowNode: FlowNode, sourceFlowNode?: FlowNode, ignoreNoReturn = false): boolean {
        const visitedFlowNodeMap = new Set<number>();

        if (enablePrintControlFlowGraph) {
            printControlFlowGraph(flowNode, /* reference */ undefined, 'isFlowNodeReachable');
        }

        function isFlowNodeReachableRecursive(
            flowNode: FlowNode,
            sourceFlowNode: FlowNode | undefined,
            recursionCount = 0
        ): boolean {
            // Cut off the recursion at some point to prevent a stack overflow.
            const maxFlowNodeReachableRecursionCount = 64;
            if (recursionCount > maxFlowNodeReachableRecursionCount) {
                return true;
            }
            recursionCount++;

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
                    if (!ignoreNoReturn && isCallNoReturn(evaluator, callFlowNode)) {
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
                                isExceptionContextManager(evaluator, expr, contextMgrNode.isAsync)
                            )
                        ) {
                            return false;
                        }
                    }

                    const labelNode = curFlowNode as FlowLabel;
                    for (const antecedent of labelNode.antecedents) {
                        if (isFlowNodeReachableRecursive(antecedent, sourceFlowNode, recursionCount)) {
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
                    if (preFinallyFlowNode.isGateClosed) {
                        return false;
                    }

                    curFlowNode = preFinallyFlowNode.antecedent;
                    continue;
                }

                if (curFlowNode.flags & FlowFlags.PostFinally) {
                    const postFinallyFlowNode = curFlowNode as FlowPostFinally;
                    const wasGateClosed = postFinallyFlowNode.preFinallyGate.isGateClosed;

                    try {
                        postFinallyFlowNode.preFinallyGate.isGateClosed = true;
                        return isFlowNodeReachableRecursive(
                            postFinallyFlowNode.antecedent,
                            sourceFlowNode,
                            recursionCount
                        );
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

    // Determines whether the specified typeVar, which is assumed to be constrained,
    // can be narrowed to one of its constrained types based on isinstance type
    // guard checks.
    function narrowConstrainedTypeVar(flowNode: FlowNode, typeVar: TypeVarType): ClassType | undefined {
        assert(!typeVar.details.isParamSpec);
        assert(!typeVar.details.isVariadic);
        assert(!typeVar.details.boundType);
        assert(typeVar.details.constraints.length > 0);

        const visitedFlowNodeMap = new Set<number>();
        const startingConstraints: ClassType[] = [];

        for (const constraint of typeVar.details.constraints) {
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
                        FlowFlags.NarrowForPattern |
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
                        | FlowNarrowForPattern
                        | FlowPostFinally
                        | FlowPreFinallyGate
                        | FlowCall;
                    curFlowNode = typedFlowNode.antecedent;
                    continue;
                }

                if (curFlowNode.flags & (FlowFlags.TrueCondition | FlowFlags.FalseCondition)) {
                    const conditionFlowNode = curFlowNode as FlowCondition;
                    const testExpression = conditionFlowNode.expression;
                    const isPositiveTest = (curFlowNode.flags & FlowFlags.TrueCondition) !== 0;

                    if (
                        testExpression.nodeType === ParseNodeType.Call &&
                        testExpression.leftExpression.nodeType === ParseNodeType.Name &&
                        testExpression.leftExpression.value === 'isinstance' &&
                        testExpression.arguments.length === 2
                    ) {
                        const arg0Expr = testExpression.arguments[0].valueExpression;

                        const arg0Type = evaluator.getTypeOfExpression(arg0Expr).type;

                        if (isCompatibleWithConstrainedTypeVar(arg0Type, typeVar)) {
                            // Prevent infinite recursion by noting that we've been here before.
                            visitedFlowNodeMap.add(curFlowNode.id);
                            const priorRemainingConstraints = narrowConstrainedTypeVarRecursive(
                                conditionFlowNode.antecedent,
                                typeVar
                            );
                            visitedFlowNodeMap.delete(curFlowNode.id);

                            const arg1Expr = testExpression.arguments[1].valueExpression;
                            const arg1Type = evaluator.getTypeOfExpression(
                                arg1Expr,
                                EvaluatorFlags.EvaluateStringLiteralAsType |
                                    EvaluatorFlags.DisallowParamSpec |
                                    EvaluatorFlags.DisallowTypeVarTuple
                            ).type;

                            if (isInstantiableClass(arg1Type)) {
                                return priorRemainingConstraints.filter((subtype) => {
                                    if (ClassType.isSameGenericClass(subtype, arg1Type)) {
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
            } else if (subtype.condition) {
                if (
                    !subtype.condition.some(
                        (condition) => condition.isConstrainedTypeVar && condition.typeVarName === typeVar.nameWithScope
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

        // Initially set to false to avoid recursion.
        callIsNoReturnCache.set(node.id, false);

        noReturnAnalysisDepth++;

        try {
            let noReturnTypeCount = 0;
            let subtypeCount = 0;

            // Evaluate the call base type.
            const callTypeResult = evaluator.getTypeOfExpression(node.leftExpression, EvaluatorFlags.DoNotSpecialize);
            const callType = callTypeResult.type;

            doForEachSubtype(callType, (callSubtype) => {
                // Track the number of subtypes we've examined.
                subtypeCount++;

                if (isInstantiableClass(callSubtype)) {
                    // Does the class have a custom metaclass that implements a `__call__` method?
                    // If so, it will be called instead of `__init__` or `__new__`. We'll assume
                    // in this case that the __call__ method is not a NoReturn type.
                    if (
                        callSubtype.details.effectiveMetaclass &&
                        isClass(callSubtype.details.effectiveMetaclass) &&
                        !ClassType.isBuiltIn(callSubtype.details.effectiveMetaclass, 'type')
                    ) {
                        const metaclassCallMember = lookUpClassMember(
                            callSubtype.details.effectiveMetaclass,
                            '__call__',
                            ClassMemberLookupFlags.SkipInstanceVariables | ClassMemberLookupFlags.SkipObjectBaseClass
                        );
                        if (metaclassCallMember) {
                            return;
                        }
                    }

                    let constructorMember = lookUpClassMember(
                        callSubtype,
                        '__init__',
                        ClassMemberLookupFlags.SkipInstanceVariables | ClassMemberLookupFlags.SkipObjectBaseClass
                    );

                    if (constructorMember === undefined) {
                        constructorMember = lookUpClassMember(
                            callSubtype,
                            '__new__',
                            ClassMemberLookupFlags.SkipInstanceVariables | ClassMemberLookupFlags.SkipObjectBaseClass
                        );
                    }

                    if (constructorMember) {
                        const constructorType = evaluator.getTypeOfMember(constructorMember);
                        if (constructorType) {
                            if (isFunction(constructorType) || isOverloadedFunction(constructorType)) {
                                const boundConstructorType = evaluator.bindFunctionToClassOrObject(
                                    undefined,
                                    constructorType
                                );
                                if (boundConstructorType) {
                                    callSubtype = boundConstructorType;
                                }
                            }
                        }
                    }
                } else if (isClassInstance(callSubtype)) {
                    const callMember = lookUpClassMember(
                        callSubtype,
                        '__call__',
                        ClassMemberLookupFlags.SkipInstanceVariables
                    );
                    if (callMember) {
                        const callMemberType = evaluator.getTypeOfMember(callMember);
                        if (callMemberType) {
                            if (isFunction(callMemberType) || isOverloadedFunction(callMemberType)) {
                                const boundCallType = evaluator.bindFunctionToClassOrObject(undefined, callMemberType);
                                if (boundCallType) {
                                    callSubtype = boundCallType;
                                }
                            }
                        }
                    }
                }

                const isCallAwaited = node.parent?.nodeType === ParseNodeType.Await;
                if (isFunction(callSubtype)) {
                    if (isFunctionNoReturn(callSubtype, isCallAwaited)) {
                        noReturnTypeCount++;
                    }
                } else if (isOverloadedFunction(callSubtype)) {
                    let overloadCount = 0;
                    let noReturnOverloadCount = 0;

                    OverloadedFunctionType.getOverloads(callSubtype).forEach((overload) => {
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
                            const callResult = evaluator.validateOverloadedFunctionArguments(
                                node,
                                node.arguments,
                                { type: callSubtype, isIncomplete: callTypeResult.isIncomplete },
                                undefined /* typeVarContext */,
                                false /* skipUnknownArgCheck */,
                                undefined /* expectedType */
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
        const returnType = functionType.details.declaredReturnType;
        if (returnType) {
            if (
                FunctionType.isAsync(functionType) &&
                isClassInstance(returnType) &&
                ClassType.isBuiltIn(returnType, 'Coroutine') &&
                returnType.typeArguments &&
                returnType.typeArguments.length >= 3
            ) {
                if (isNever(returnType.typeArguments[2]) && isCallAwaited) {
                    return true;
                }
            }

            return isNever(returnType);
        } else if (!inferNoReturnForUnannotatedFunctions) {
            return false;
        } else if (functionType.details.declaration) {
            // If the function is a generator (i.e. it has yield statements)
            // then it is not a "no return" call. Also, don't infer a "no
            // return" type for abstract methods.
            if (
                !functionType.details.declaration.isGenerator &&
                !FunctionType.isAbstractMethod(functionType) &&
                !FunctionType.isStubDefinition(functionType) &&
                !FunctionType.isPyTypedDefinition(functionType)
            ) {
                // Check specifically for a common idiom where the only statement
                // (other than a possible docstring) is a "raise NotImplementedError".
                const functionStatements = functionType.details.declaration.node.suite.statements;

                let foundRaiseNotImplemented = false;
                for (const statement of functionStatements) {
                    if (statement.nodeType !== ParseNodeType.StatementList || statement.statements.length !== 1) {
                        break;
                    }

                    const simpleStatement = statement.statements[0];
                    if (simpleStatement.nodeType === ParseNodeType.StringList) {
                        continue;
                    }

                    if (simpleStatement.nodeType === ParseNodeType.Raise && simpleStatement.typeExpression) {
                        // Check for "raise NotImplementedError" or "raise NotImplementedError()"
                        const isNotImplementedName = (node: ParseNode) => {
                            return node?.nodeType === ParseNodeType.Name && node.value === 'NotImplementedError';
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

                if (!foundRaiseNotImplemented && !isAfterNodeReachable(evaluator, functionType)) {
                    return true;
                }
            }
        }

        return false;
    }

    function isAfterNodeReachable(evaluator: TypeEvaluator, functionType: FunctionType) {
        if (!functionType.details.declaration) {
            return true;
        }

        return evaluator.isAfterNodeReachable(functionType.details.declaration.node);
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
                const exitType = evaluator.getTypeOfObjectMember(node, cmType, exitMethodName)?.type;

                if (exitType && isFunction(exitType) && exitType.details.declaredReturnType) {
                    const returnType = exitType.details.declaredReturnType;
                    cmSwallowsExceptions = false;
                    if (isClassInstance(returnType) && ClassType.isBuiltIn(returnType, 'bool')) {
                        if (returnType.literalValue === undefined || returnType.literalValue === true) {
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
        isFlowNodeReachable,
        narrowConstrainedTypeVar,
        printControlFlowGraph,
    };
}
