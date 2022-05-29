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
import { convertOffsetToPosition } from '../common/positionUtils';
import { ExpressionNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
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
import {
    CachedType,
    IncompleteSubtypeInfo,
    IncompleteType,
    isIncompleteType,
    SpeculativeTypeTracker,
    TypeCache,
} from './typeCache';
import { EvaluatorFlags, TypeEvaluator, TypeResult } from './typeEvaluatorTypes';
import { getTypeNarrowingCallback } from './typeGuards';
import {
    ClassType,
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
    removeIncompleteUnknownFromUnion,
    Type,
    TypeVarType,
    UnboundType,
    UnknownType,
} from './types';
import { ClassMemberLookupFlags, doForEachSubtype, isTypeAliasPlaceholder, lookUpClassMember } from './typeUtils';

export interface FlowNodeTypeResult {
    type: Type | undefined;
    isIncomplete: boolean;
    isRecursionSentinel?: boolean;
    generationCount?: number | undefined;
    incompleteType?: Type | undefined;
    incompleteSubtypes?: IncompleteSubtypeInfo[] | undefined;
}

export interface CodeFlowAnalyzer {
    getTypeFromCodeFlow: (
        flowNode: FlowNode,
        reference: CodeFlowReferenceExpressionNode | undefined,
        targetSymbolId: number | undefined,
        initialType: Type | undefined,
        isInitialTypeIncomplete: boolean,
        ignoreNoReturn: boolean
    ) => FlowNodeTypeResult;
}

export interface CodeFlowEngine {
    createCodeFlowAnalyzer: () => CodeFlowAnalyzer;
    isFlowNodeReachable: (flowNode: FlowNode, sourceFlowNode?: FlowNode, ignoreNoReturn?: boolean) => boolean;
    narrowConstrainedTypeVar: (flowNode: FlowNode, typeVar: TypeVarType) => Type | undefined;
}

// This debugging option prints the control flow graph when getTypeFromCodeFlow is called.
const isPrintControlFlowGraphEnabled = false;

// This debugging option prints the results of calls to isCallNoReturn.
const isPrintCallNoReturnEnabled = false;

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
        const flowNodeTypeCacheSet = new Map<string, TypeCache>();

        function getTypeFromCodeFlow(
            flowNode: FlowNode,
            reference: CodeFlowReferenceExpressionNode | undefined,
            targetSymbolId: number | undefined,
            initialType: Type | undefined,
            isInitialTypeIncomplete: boolean,
            ignoreNoReturn: boolean
        ): FlowNodeTypeResult {
            if (isPrintControlFlowGraphEnabled) {
                printControlFlowGraph(flowNode, reference, 'getTypeFromCodeFlow');
            }

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
                isIncomplete: boolean,
                isRecursionSentinel?: boolean
            ): FlowNodeTypeResult {
                if (!isIncomplete) {
                    flowIncompleteGeneration++;
                } else if (type) {
                    const prevEntry = flowNodeTypeCache!.get(flowNode.id);
                    if (prevEntry === undefined) {
                        flowIncompleteGeneration++;
                    } else if ((prevEntry as IncompleteType).isIncompleteType) {
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
                          isRecursionSentinel,
                      }
                    : type;

                flowNodeTypeCache!.set(flowNode.id, entry);
                speculativeTypeTracker.trackEntry(flowNodeTypeCache!, flowNode.id);

                return {
                    type,
                    isIncomplete,
                    isRecursionSentinel,
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
                evaluationCount: number
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

                return getCacheEntry(flowNode);
            }

            function getCacheEntry(flowNode: FlowNode): FlowNodeTypeResult | undefined {
                if (!flowNodeTypeCache!.has(flowNode.id)) {
                    return undefined;
                }

                const cachedEntry = flowNodeTypeCache!.get(flowNode.id);
                if (cachedEntry === undefined) {
                    return {
                        type: cachedEntry,
                        isIncomplete: false,
                    };
                }

                if (!isIncompleteType(cachedEntry)) {
                    return {
                        type: cachedEntry,
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
                    isIncomplete: true,
                    incompleteSubtypes: cachedEntry.incompleteSubtypes,
                    generationCount: cachedEntry.generationCount,
                    isRecursionSentinel: cachedEntry.isRecursionSentinel,
                };
            }

            function deleteCacheEntry(flowNode: FlowNode) {
                flowNodeTypeCache!.delete(flowNode.id);
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
                            return { type: cachedEntry.type, isIncomplete: true };
                        }
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
                        if (!ignoreNoReturn && isCallNoReturn(evaluator, callFlowNode)) {
                            return setCacheEntry(curFlowNode, /* type */ undefined, /* isIncomplete */ false);
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
                                    return setCacheEntry(curFlowNode, UnboundType.create(), /* isIncomplete */ false);
                                }

                                // If there was a cache entry already, that means we hit a recursive
                                // case (something like "int: int = 4"). Avoid infinite recursion
                                // by returning an undefined type.
                                if (cachedEntry?.isRecursionSentinel) {
                                    return { type: undefined, isIncomplete: true };
                                }

                                // Set the cache entry to undefined before evaluating the
                                // expression in case it depends on itself.
                                setCacheEntry(
                                    curFlowNode,
                                    reference ? undefined : initialType,
                                    /* isIncomplete */ true,
                                    /* isRecursionSentinel */ true
                                );
                                let flowTypeResult = evaluateAssignmentFlowNode(assignmentFlowNode);
                                if (flowTypeResult) {
                                    if (isTypeAliasPlaceholder(flowTypeResult.type)) {
                                        flowTypeResult = undefined;
                                    } else if (
                                        reference.nodeType === ParseNodeType.MemberAccess &&
                                        evaluator.isAsymmetricDescriptorAssignment(assignmentFlowNode.node)
                                    ) {
                                        flowTypeResult = undefined;
                                    }
                                }
                                return setCacheEntry(curFlowNode, flowTypeResult?.type, !!flowTypeResult?.isIncomplete);
                            } else if (isPartialMatchingExpression(reference, assignmentFlowNode.node)) {
                                // If the node partially matches the reference, we need to "kill" any narrowed
                                // types further above this point. For example, if we see the sequence
                                //    a.b = 3
                                //    a = Foo()
                                //    x = a.b
                                // The type of "a.b" can no longer be assumed to be Literal[3].
                                return {
                                    type: initialType,
                                    isIncomplete: isInitialTypeIncomplete,
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

                        return getTypeFromLoopFlowNode(loopNode);
                    }

                    if (curFlowNode.flags & (FlowFlags.TrueCondition | FlowFlags.FalseCondition)) {
                        const conditionalFlowNode = curFlowNode as FlowCondition;

                        if (reference) {
                            // Was an incomplete entry added to prevent recursion?
                            if (cachedEntry?.isRecursionSentinel) {
                                return cachedEntry;
                            }

                            // Before calling getTypeNarrowingCallback, set the type
                            // of this flow node in the cache to prevent recursion.
                            setCacheEntry(
                                curFlowNode,
                                /* type */ undefined,
                                /* isIncomplete */ true,
                                /* isRecursionSentinel */ true
                            );

                            try {
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
                                    if (flowType) {
                                        flowType = typeNarrowingCallback(flowType);
                                    }

                                    return setCacheEntry(curFlowNode, flowType, flowTypeResult.isIncomplete);
                                }

                                deleteCacheEntry(curFlowNode);
                            } catch (e) {
                                // We don't use finally here because the debugger
                                // doesn't handle it well during single stepping.
                                deleteCacheEntry(curFlowNode);
                                throw e;
                            }
                        }

                        curFlowNode = conditionalFlowNode.antecedent;
                        continue;
                    }

                    if (curFlowNode.flags & (FlowFlags.TrueNeverCondition | FlowFlags.FalseNeverCondition)) {
                        const conditionalFlowNode = curFlowNode as FlowCondition;
                        if (conditionalFlowNode.reference) {
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
                                    // Before calling getTypeNarrowingCallback, set the type
                                    // of this flow node in the cache to prevent recursion.
                                    setCacheEntry(
                                        curFlowNode,
                                        reference ? undefined : initialType,
                                        /* isIncomplete */ true,
                                        /* isRecursionSentinel */ true
                                    );

                                    try {
                                        const typeNarrowingCallback = getTypeNarrowingCallback(
                                            evaluator,
                                            conditionalFlowNode.reference,
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
                                            const narrowedType =
                                                typeNarrowingCallback(refTypeInfo.type) || refTypeInfo.type;

                                            // If the narrowed type is "never", don't allow further exploration.
                                            if (isNever(narrowedType)) {
                                                return setCacheEntry(
                                                    curFlowNode,
                                                    undefined,
                                                    !!refTypeInfo.isIncomplete
                                                );
                                            }
                                        }

                                        deleteCacheEntry(curFlowNode);
                                    } catch (e) {
                                        // We don't use finally here because the debugger
                                        // doesn't handle it well during single stepping.
                                        deleteCacheEntry(curFlowNode);
                                        throw e;
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
                            return setCacheEntry(curFlowNode, /* type */ undefined, !!narrowedTypeResult.isIncomplete);
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
                        return setCacheEntry(curFlowNode, initialType, isInitialTypeIncomplete);
                    }

                    if (curFlowNode.flags & FlowFlags.WildcardImport) {
                        const wildcardImportFlowNode = curFlowNode as FlowWildcardImport;
                        if (reference && reference.nodeType === ParseNodeType.Name) {
                            const nameValue = reference.value;
                            if (wildcardImportFlowNode.names.some((name) => name === nameValue)) {
                                // Before calling getTypeFromWildcardImport, set the cache entry to prevent infinite recursion.
                                setCacheEntry(
                                    curFlowNode,
                                    /* type */ undefined,
                                    /* isIncomplete */ true,
                                    /* isRecursionSentinel */ true
                                );

                                try {
                                    const type = getTypeFromWildcardImport(wildcardImportFlowNode, nameValue);
                                    return setCacheEntry(curFlowNode, type, /* isIncomplete */ false);
                                } catch (e) {
                                    deleteCacheEntry(curFlowNode);
                                    throw e;
                                }
                            }
                        }

                        curFlowNode = wildcardImportFlowNode.antecedent;
                        continue;
                    }

                    // We shouldn't get here.
                    fail('Unexpected flow node flags');
                    return setCacheEntry(curFlowNode, /* type */ undefined, /* isIncomplete */ false);
                }
            }

            function getTypeFromBranchFlowNode(branchNode: FlowLabel) {
                const typesToCombine: Type[] = [];

                let sawIncomplete = false;
                let isProvenReachable = false;

                // Set the cache entry to undefined before evaluating the
                // expression in case it depends on itself.
                setCacheEntry(
                    branchNode,
                    reference ? undefined : initialType,
                    /* isIncomplete */ true,
                    /* isRecursionSentinel */ true
                );

                branchNode.antecedents.forEach((antecedent) => {
                    // If we're solving for "reachability", and we have now proven
                    // reachability, there's no reason to do more work.
                    if (reference === undefined && isProvenReachable) {
                        return;
                    }

                    const flowTypeResult = getTypeFromFlowNode(antecedent);

                    if (flowTypeResult.isIncomplete) {
                        sawIncomplete = true;
                    }

                    if (reference === undefined && flowTypeResult.type !== undefined) {
                        isProvenReachable = true;
                    }

                    if (flowTypeResult.type) {
                        typesToCombine.push(flowTypeResult.type);
                    }
                });

                if (isProvenReachable) {
                    return setCacheEntry(branchNode, initialType, /* isIncomplete */ false);
                }

                const effectiveType = typesToCombine.length > 0 ? combineTypes(typesToCombine) : undefined;

                return setCacheEntry(branchNode, effectiveType, sawIncomplete);
            }

            function getTypeFromLoopFlowNode(loopNode: FlowLabel) {
                // See if we've been here before. If so, there will be an incomplete cache entry.
                let cacheEntry = getCacheEntry(loopNode);

                // The type result from one antecedent may depend on the type
                // result from another, so loop up to one time for each
                // antecedent in the loop.
                const maxAttemptCount = loopNode.antecedents.length;

                if (cacheEntry === undefined) {
                    // We haven't been here before, so create a new incomplete cache entry.
                    cacheEntry = setCacheEntry(
                        loopNode,
                        reference ? undefined : initialType,
                        /* isIncomplete */ true,
                        /* isRecursionSentinel */ true
                    );
                } else if (cacheEntry.incompleteSubtypes?.some((subtype) => subtype.isPending)) {
                    // If there are pending entries that have not been evaluated even once,
                    // treat it as incomplete.
                    const isIncomplete =
                        cacheEntry.incompleteSubtypes.length < loopNode.antecedents.length ||
                        cacheEntry.incompleteSubtypes.some(
                            (subtype) => subtype.isPending && subtype.evaluationCount < maxAttemptCount
                        );
                    return { type: cacheEntry.type, isIncomplete };
                }

                let attemptCount = 0;

                while (true) {
                    let sawIncomplete = false;
                    let isProvenReachable =
                        reference === undefined &&
                        cacheEntry.incompleteSubtypes?.some((subtype) => subtype.type !== undefined);

                    loopNode.antecedents.forEach((antecedent, index) => {
                        // If we've trying to determine reachability and we've already proven
                        // reachability, then we're done.
                        if (reference === undefined && isProvenReachable) {
                            return;
                        }

                        cacheEntry = getCacheEntry(loopNode)!;

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
                                subtypeEntry?.type ?? (reference ? undefined : initialType),
                                /* isIncomplete */ true,
                                /* isPending */ true,
                                entryEvaluationCount
                            );

                            try {
                                const flowTypeResult = getTypeFromFlowNode(antecedent);

                                if (flowTypeResult.isIncomplete) {
                                    sawIncomplete = true;
                                }

                                cacheEntry = setIncompleteSubtype(
                                    loopNode,
                                    index,
                                    flowTypeResult.type,
                                    flowTypeResult.isIncomplete,
                                    /* isPending */ false,
                                    entryEvaluationCount + 1
                                );
                            } catch (e) {
                                setIncompleteSubtype(
                                    loopNode,
                                    index,
                                    undefined,
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
                        return setCacheEntry(loopNode, initialType, /* isIncomplete */ false);
                    }

                    let effectiveType = cacheEntry.type;
                    if (sawIncomplete) {
                        // If there is an incomplete "Unknown" type within a union type, remove
                        // it. Otherwise we might end up resolving the cycle with a type
                        // that includes an undesirable unknown.
                        if (effectiveType) {
                            const typeWithoutUnknown = removeIncompleteUnknownFromUnion(effectiveType);
                            if (!isNever(typeWithoutUnknown)) {
                                effectiveType = typeWithoutUnknown;
                            }
                        }
                    }

                    if (!sawIncomplete || attemptCount >= maxAttemptCount) {
                        return setCacheEntry(loopNode, effectiveType, /* isIncomplete */ false);
                    }

                    attemptCount++;
                }
            }

            function getTypeFromPreFinallyGateFlowNode(preFinallyFlowNode: FlowPreFinallyGate) {
                if (preFinallyFlowNode.isGateClosed) {
                    return { type: undefined, isIncomplete: false };
                }

                // Before recursively calling, set the cache entry to prevent infinite recursion.
                setCacheEntry(
                    preFinallyFlowNode,
                    reference ? undefined : initialType,
                    /* isIncomplete */ true,
                    /* isRecursionSentinel */ true
                );

                try {
                    const flowTypeResult = getTypeFromFlowNode(preFinallyFlowNode.antecedent);

                    // We want to cache the type only if we're evaluating the "gate closed" path.
                    deleteCacheEntry(preFinallyFlowNode);

                    return {
                        type: flowTypeResult.type,
                        isIncomplete: flowTypeResult.isIncomplete,
                    };
                } catch (e) {
                    deleteCacheEntry(preFinallyFlowNode);
                    throw e;
                }
            }

            function getTypeFromPostFinallyFlowNode(postFinallyFlowNode: FlowPostFinally) {
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
                    type: initialType,
                    isIncomplete: isInitialTypeIncomplete,
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

        if (isPrintControlFlowGraphEnabled) {
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
                                    EvaluatorFlags.ParamSpecDisallowed |
                                    EvaluatorFlags.TypeVarTupleDisallowed
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

        if (isPrintCallNoReturnEnabled) {
            console.log(`isCallNoReturn@${flowNode.id} Pre depth ${noReturnAnalysisDepth}`);
        }

        // See if this information is cached already.
        if (callIsNoReturnCache.has(node.id)) {
            const result = callIsNoReturnCache.get(node.id);

            if (isPrintCallNoReturnEnabled) {
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
            const callType = evaluator.getTypeOfExpression(node.leftExpression, EvaluatorFlags.DoNotSpecialize).type;

            doForEachSubtype(callType, (callSubtype) => {
                // Track the number of subtypes we've examined.
                subtypeCount++;

                let functionType: FunctionType | undefined;
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

                if (isFunction(callSubtype)) {
                    functionType = callSubtype;
                } else if (isOverloadedFunction(callSubtype)) {
                    // Use the last overload, which should be the most general.
                    const overloadedFunction = callSubtype;
                    functionType = overloadedFunction.overloads[overloadedFunction.overloads.length - 1];
                }

                if (functionType) {
                    const returnType = functionType.details.declaredReturnType;
                    if (FunctionType.isAsync(functionType)) {
                        if (
                            returnType &&
                            isClassInstance(returnType) &&
                            ClassType.isBuiltIn(returnType, 'Coroutine') &&
                            returnType.typeArguments &&
                            returnType.typeArguments.length >= 3
                        ) {
                            if (isNever(returnType.typeArguments[2])) {
                                if (node.parent?.nodeType === ParseNodeType.Await) {
                                    noReturnTypeCount++;
                                }
                            }
                        }
                    } else if (returnType) {
                        if (isNever(returnType)) {
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

                            if (!foundRaiseNotImplemented && !isAfterNodeReachable(evaluator, functionType)) {
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

            if (isPrintCallNoReturnEnabled) {
                console.log(`isCallNoReturn@${flowNode.id} Post: ${callIsNoReturn ? 'true' : 'false'}`);
            }

            return callIsNoReturn;
        } finally {
            noReturnAnalysisDepth--;
        }
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
                    cmSwallowsExceptions = isClassInstance(returnType) && ClassType.isBuiltIn(returnType, 'bool');
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
        callName: string
    ) {
        let referenceText = '';
        if (reference) {
            const fileInfo = getFileInfo(reference);
            const pos = convertOffsetToPosition(reference.start, fileInfo.lines);
            referenceText = `${printExpression(reference)}[${pos.line + 1}:${pos.character + 1}]`;
        }

        console.log(`${callName}@${flowNode.id}: ${referenceText || '(none)'}`);
        console.log(formatControlFlowGraph(flowNode));
    }

    return {
        createCodeFlowAnalyzer,
        isFlowNodeReachable,
        narrowConstrainedTypeVar,
    };
}
