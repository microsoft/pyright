/*
 * returnTypeInference.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Contextual return inference using evaluator-owned cache bindings and inference frames.
 */

import { assert } from '../../common/debug';
import { ExpressionNode, FunctionNode, ParseNode } from '../../parser/parseNodes';
import * as AnalyzerNodeInfo from '../analyzerNodeInfo';
import { CodeFlowEngine } from '../codeFlowEngine';
import * as ParseTreeUtils from '../parseTreeUtils';
import { SpeculativeTypeTracker } from '../typeCacheUtils';
import { ReturnTypeInferenceContext, TypeCacheEntry, TypeFormTypeCacheEntry } from '../typeEvaluator/internals';
import {
    CallSiteEvaluationInfo,
    EvalFlags,
    FunctionTypeResult,
    TypeEvaluator,
    TypeResult,
} from '../typeEvaluatorTypes';
import { FunctionType, isTypeSame, isUnknown, removeUnbound, Type, UnknownType } from '../types';
import { InferenceContext, stripTypeForm } from '../typeUtils';

interface Context {
    readonly codeFlowEngine: CodeFlowEngine;
    readonly convertSpecialFormToRuntimeValue: (type: Type, flags: EvalFlags, convertModule?: boolean) => Type;
    readonly getTypeOfExpression: TypeEvaluator['getTypeOfExpression'];
    readonly getTypeOfFunction: (node: FunctionNode) => FunctionTypeResult | undefined;
    readonly inferFunctionReturnType: (
        node: FunctionNode,
        isAbstract: boolean,
        callerNode: ExpressionNode | undefined
    ) => TypeResult | undefined;
    readonly maxCallSiteReturnTypeCacheSize: 8;
    readonly maxReturnCallSiteTypeInferenceCodeFlowComplexity: 8;
    readonly maxReturnTypeInferenceArgCount: 6;
    readonly maxReturnTypeInferenceStackSize: 2;
    readonly nodeInfo: AnalyzerNodeInfo.AnalyzerNodeInfoAccessor;
    readonly returnTypeInferenceContextStack: ReturnTypeInferenceContext[];
    returnTypeInferenceTypeCache: Map<number, TypeCacheEntry> | undefined;
    returnTypeInferenceTypeFormTypeCache: Map<number, TypeFormTypeCacheEntry[]> | undefined;
    readonly speculativeTypeTracker: SpeculativeTypeTracker;
    readonly stripLiteralValue: (type: Type) => Type;
    readonly suppressDiagnostics: <T>(
        node: ParseNode,
        callback: () => T,
        diagCallback?: (suppressedDiags: string[]) => void
    ) => T;
    readonly writeTypeCache: (
        node: ParseNode,
        typeResult: TypeResult,
        flags: EvalFlags | undefined,
        inferenceContext?: InferenceContext,
        allowSpeculativeCaching?: boolean
    ) => void;
}

// Infers contextual call-site returns; the evaluator owns the live caches and inference stack.
export function createReturnTypeInference(context: Context) {
    const {
        codeFlowEngine,
        convertSpecialFormToRuntimeValue,
        getTypeOfExpression,
        getTypeOfFunction,
        inferFunctionReturnType,
        maxCallSiteReturnTypeCacheSize,
        maxReturnCallSiteTypeInferenceCodeFlowComplexity,
        maxReturnTypeInferenceArgCount,
        maxReturnTypeInferenceStackSize,
        nodeInfo,
        returnTypeInferenceContextStack,
        speculativeTypeTracker,
        stripLiteralValue,
        suppressDiagnostics,
        writeTypeCache,
    } = context;

    function isNodeInReturnTypeInferenceContext(node: ParseNode) {
        const stackSize = returnTypeInferenceContextStack.length;
        if (stackSize === 0) {
            return false;
        }

        const contextNode = returnTypeInferenceContextStack[stackSize - 1];

        let curNode: ParseNode | undefined = node;
        while (curNode) {
            if (curNode === contextNode.functionNode) {
                return true;
            }
            curNode = curNode.parent;
        }

        return false;
    }

    function getCodeFlowAnalyzerForReturnTypeInferenceContext() {
        const stackSize = returnTypeInferenceContextStack.length;
        assert(stackSize > 0);
        const contextNode = returnTypeInferenceContextStack[stackSize - 1];
        return contextNode.codeFlowAnalyzer;
    }

    function inferReturnTypeForCallSite(type: FunctionType, callSiteInfo: CallSiteEvaluationInfo): Type | undefined {
        const args = callSiteInfo.args;
        let contextualReturnType: Type | undefined;

        if (!type.shared.declaration) {
            return undefined;
        }
        const functionNode = type.shared.declaration.node;
        const codeFlowComplexity = nodeInfo.getCodeFlowComplexity(functionNode);

        if (codeFlowComplexity >= maxReturnCallSiteTypeInferenceCodeFlowComplexity) {
            return undefined;
        }

        // If an arg hasn't been matched to a specific named parameter,
        // it's an unpacked value that corresponds to multiple parameters.
        // That's an edge case that we don't handle here.
        if (args.some((arg) => !arg.paramName)) {
            return undefined;
        }

        // Detect recurrence. If a function invokes itself either directly
        // or indirectly, we won't attempt to infer contextual return
        // types any further.
        if (returnTypeInferenceContextStack.some((context) => context.functionNode === functionNode)) {
            return undefined;
        }

        const functionTypeResult = getTypeOfFunction(functionNode);
        if (!functionTypeResult) {
            return undefined;
        }

        // Very complex functions with many arguments can take a long time to analyze,
        // so we'll use a heuristic and avoiding this inference technique for any
        // call site that involves too many arguments.
        if (args.length > maxReturnTypeInferenceArgCount) {
            return undefined;
        }

        // Don't explore arbitrarily deep in the call graph.
        if (returnTypeInferenceContextStack.length >= maxReturnTypeInferenceStackSize) {
            return undefined;
        }

        const paramTypes: Type[] = [];
        let isResultFromCache = false;

        // If the call is located in a loop, don't use literal argument types
        // for the same reason we don't do literal math in loops.
        const stripLiteralArgTypes = ParseTreeUtils.isWithinLoop(callSiteInfo.errorNode);

        // Suppress diagnostics because we don't want to generate errors.
        suppressDiagnostics(functionNode, () => {
            // Argument expressions belong to the caller's contextual cache.
            const argTypes = functionNode.d.params.map((param) => {
                const arg = args.find((arg) => param.d.name?.d.value === arg.paramName);
                return arg?.argument.valueExpression
                    ? getTypeOfExpression(arg.argument.valueExpression).type
                    : undefined;
            });

            // Allocate a new temporary type cache for the context of just
            // this function so we can analyze it separately without polluting
            // the main type cache.
            const prevTypeCache = context.returnTypeInferenceTypeCache;
            const prevTypeFormTypeCache = context.returnTypeInferenceTypeFormTypeCache;
            returnTypeInferenceContextStack.push({
                functionNode,
                codeFlowAnalyzer: codeFlowEngine.createCodeFlowAnalyzer(),
            });

            try {
                context.returnTypeInferenceTypeCache = new Map<number, TypeCacheEntry>();
                context.returnTypeInferenceTypeFormTypeCache = new Map<number, TypeFormTypeCacheEntry[]>();

                let allArgTypesAreUnknown = true;
                functionNode.d.params.forEach((param, index) => {
                    if (param.d.name) {
                        let paramType = argTypes[index];

                        if (paramType) {
                            if (!isUnknown(paramType)) {
                                allArgTypesAreUnknown = false;
                            }
                        } else if (param.d.defaultValue) {
                            paramType = getTypeOfExpression(param.d.defaultValue).type;
                            if (!isUnknown(paramType)) {
                                allArgTypesAreUnknown = false;
                            }
                        } else if (index === 0) {
                            // If this is an instance or class method, use the implied
                            // parameter type for the "self" or "cls" parameter.
                            if (
                                FunctionType.isInstanceMethod(functionTypeResult.functionType) ||
                                FunctionType.isClassMethod(functionTypeResult.functionType)
                            ) {
                                if (functionTypeResult.functionType.shared.parameters.length > 0) {
                                    if (functionNode.d.params[0].d.name) {
                                        paramType = FunctionType.getParamType(functionTypeResult.functionType, 0);
                                    }
                                }
                            }
                        }

                        if (!paramType) {
                            paramType = UnknownType.create();
                        }

                        if (stripLiteralArgTypes) {
                            paramType = stripTypeForm(
                                convertSpecialFormToRuntimeValue(
                                    stripLiteralValue(paramType),
                                    EvalFlags.None,
                                    /* convertModule */ true
                                )
                            );
                        }

                        paramTypes.push(paramType);
                        writeTypeCache(param.d.name, { type: paramType }, EvalFlags.None);
                    }
                });

                // Don't bother trying to determine the contextual return
                // type if none of the argument types are known.
                if (!allArgTypesAreUnknown) {
                    // See if the return type is already cached. If so, skip the
                    // inference step, which is potentially very expensive.
                    const cacheEntry = functionTypeResult.functionType.priv.callSiteReturnTypeCache?.find((entry) => {
                        return (
                            entry.paramTypes.length === paramTypes.length &&
                            entry.paramTypes.every((t, i) => isTypeSame(t, paramTypes[i]))
                        );
                    });

                    if (cacheEntry) {
                        contextualReturnType = cacheEntry.returnType;
                        isResultFromCache = true;
                    } else {
                        // Speculative results also depend on these temporary parameter bindings,
                        // not just the expected types used during overload resolution.
                        contextualReturnType = speculativeTypeTracker.useSpeculativeTypeCacheIsolation(() =>
                            inferFunctionReturnType(
                                functionNode,
                                FunctionType.isAbstractMethod(type),
                                callSiteInfo?.errorNode
                            )
                        )?.type;
                    }
                }
            } finally {
                returnTypeInferenceContextStack.pop();
                context.returnTypeInferenceTypeCache = prevTypeCache;
                context.returnTypeInferenceTypeFormTypeCache = prevTypeFormTypeCache;
            }
        });

        if (contextualReturnType) {
            contextualReturnType = removeUnbound(contextualReturnType);

            if (!isResultFromCache) {
                // Cache the resulting type.
                if (!functionTypeResult.functionType.priv.callSiteReturnTypeCache) {
                    functionTypeResult.functionType.priv.callSiteReturnTypeCache = [];
                }
                if (
                    functionTypeResult.functionType.priv.callSiteReturnTypeCache.length >=
                    maxCallSiteReturnTypeCacheSize
                ) {
                    functionTypeResult.functionType.priv.callSiteReturnTypeCache =
                        functionTypeResult.functionType.priv.callSiteReturnTypeCache.slice(1);
                }
                functionTypeResult.functionType.priv.callSiteReturnTypeCache.push({
                    paramTypes,
                    returnType: contextualReturnType,
                });
            }

            return contextualReturnType;
        }

        return undefined;
    }

    return {
        isNodeInReturnTypeInferenceContext,
        getCodeFlowAnalyzerForReturnTypeInferenceContext,
        inferReturnTypeForCallSite,
    };
}
