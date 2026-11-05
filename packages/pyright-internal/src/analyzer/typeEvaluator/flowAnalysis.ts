/*
 * flowAnalysis.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * flowAnalysis implementation, using evaluator-owned dependencies and state.
 */

import { ConsoleInterface } from '../../common/console';
import { Diagnostic } from '../../common/diagnostic';
import { DiagnosticRule } from '../../common/diagnosticRules';
import { TextRange } from '../../common/textRange';
import { LocMessage } from '../../localization/localize';
import {
    ClassNode,
    ExecutionScopeNode,
    FunctionNode,
    LambdaNode,
    ParseNode,
    ParseNodeType,
} from '../../parser/parseNodes';
import { AnalyzerFileInfo } from '../analyzerFileInfo';
import * as AnalyzerNodeInfo from '../analyzerNodeInfo';
import { CodeFlowAnalyzer, CodeFlowEngine, FlowNodeTypeOptions, FlowNodeTypeResult } from '../codeFlowEngine';
import {
    CodeFlowReferenceExpressionNode,
    createKeyForReference,
    FlowNode,
    wildcardImportReferenceKey,
} from '../codeFlowTypes';
import * as ParseTreeUtils from '../parseTreeUtils';
import { CodeFlowAnalyzerCacheEntry } from '../typeEvaluator/internals';
import { Reachability, TypeResult } from '../typeEvaluatorTypes';
import { isNever, isTypeSame, isUnbound, Type, TypeVarType, UnboundType, UnknownType } from '../types';

interface Context {
    readonly addDiagnosticForTextRange: (
        fileInfo: AnalyzerFileInfo,
        rule: DiagnosticRule,
        message: string,
        range: TextRange
    ) => Diagnostic | undefined;
    readonly codeFlowAnalyzerCache: Map<number, CodeFlowAnalyzerCacheEntry[]>;
    readonly codeFlowEngine: CodeFlowEngine;
    readonly getCodeFlowAnalyzerForReturnTypeInferenceContext: () => CodeFlowAnalyzer;
    readonly isNodeInReturnTypeInferenceContext: (node: ParseNode) => boolean;
    readonly maxCodeComplexity: number;
    readonly nodeInfo: AnalyzerNodeInfo.AnalyzerNodeInfoAccessor;
}

export function createFlowAnalysis(context: Context) {
    const {
        addDiagnosticForTextRange,
        codeFlowEngine,
        getCodeFlowAnalyzerForReturnTypeInferenceContext,
        isNodeInReturnTypeInferenceContext,
        maxCodeComplexity,
        nodeInfo,
    } = context;

    function checkCodeFlowTooComplex(node: ParseNode): boolean {
        const scopeNode =
            node.nodeType === ParseNodeType.Function ? node : ParseTreeUtils.getExecutionScopeNode(node, nodeInfo);
        const codeComplexity = nodeInfo.getCodeFlowComplexity(scopeNode);

        if (codeComplexity > maxCodeComplexity) {
            let errorRange: TextRange = scopeNode;
            if (scopeNode.nodeType === ParseNodeType.Function) {
                errorRange = scopeNode.d.name;
            } else if (scopeNode.nodeType === ParseNodeType.Module) {
                errorRange = { start: 0, length: 0 };
            }

            const fileInfo = nodeInfo.getFileInfo(node);
            addDiagnosticForTextRange(
                fileInfo,
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.codeTooComplexToAnalyze(),
                errorRange
            );

            return true;
        }

        return false;
    }

    function isNodeReachable(node: ParseNode, sourceNode?: ParseNode): boolean {
        return getNodeReachability(node, sourceNode) === Reachability.Reachable;
    }

    function isAfterNodeReachable(node: ParseNode): boolean {
        return getAfterNodeReachability(node) === Reachability.Reachable;
    }

    function getNodeReachability(node: ParseNode, sourceNode?: ParseNode): Reachability {
        if (checkCodeFlowTooComplex(node)) {
            return Reachability.Reachable;
        }

        const flowNode = nodeInfo.getFlowNode(node);
        if (!flowNode) {
            if (node.parent) {
                return getNodeReachability(node.parent, sourceNode);
            }
            return Reachability.UnreachableStructural;
        }

        const sourceFlowNode = sourceNode ? nodeInfo.getFlowNode(sourceNode) : undefined;

        return codeFlowEngine.getFlowNodeReachability(flowNode, sourceFlowNode);
    }

    function getAfterNodeReachability(node: ParseNode): Reachability {
        const returnFlowNode = nodeInfo.getAfterFlowNode(node);
        if (!returnFlowNode) {
            return Reachability.UnreachableStructural;
        }

        if (checkCodeFlowTooComplex(node)) {
            return Reachability.Reachable;
        }

        const reachability = codeFlowEngine.getFlowNodeReachability(returnFlowNode);
        if (reachability !== Reachability.Reachable) {
            return reachability;
        }

        const executionScopeNode = ParseTreeUtils.getExecutionScopeNode(node, nodeInfo);
        if (!isFlowNodeReachableUsingNeverNarrowing(executionScopeNode, returnFlowNode)) {
            return Reachability.UnreachableByAnalysis;
        }

        return Reachability.Reachable;
    }

    function isFlowNodeReachableUsingNeverNarrowing(node: ExecutionScopeNode, flowNode: FlowNode) {
        const analyzer = getCodeFlowAnalyzerForNode(node, /* typeAtStart */ undefined);

        if (checkCodeFlowTooComplex(node)) {
            return true;
        }

        const codeFlowResult = analyzer.getTypeFromCodeFlow(flowNode, /* reference */ undefined, {
            typeAtStart: { type: UnboundType.create() },
        });

        return codeFlowResult.type !== undefined && !isNever(codeFlowResult.type);
    }

    function isFlowPathBetweenNodes(sourceNode: ParseNode, sinkNode: ParseNode, allowSelf = true) {
        if (checkCodeFlowTooComplex(sourceNode)) {
            return true;
        }

        const sourceFlowNode = nodeInfo.getFlowNode(sourceNode);
        const sinkFlowNode = nodeInfo.getFlowNode(sinkNode);
        if (!sourceFlowNode || !sinkFlowNode) {
            return false;
        }
        if (sourceFlowNode === sinkFlowNode) {
            return allowSelf;
        }

        return (
            codeFlowEngine.getFlowNodeReachability(sinkFlowNode, sourceFlowNode, /* ignoreNoReturn */ true) ===
            Reachability.Reachable
        );
    }

    function getCodeFlowAnalyzerForNode(
        node: ExecutionScopeNode,
        typeAtStart: TypeResult | undefined
    ): CodeFlowAnalyzer {
        let entries = context.codeFlowAnalyzerCache.get(node.id);

        if (entries) {
            const cachedEntry = entries.find((entry) => {
                if (!typeAtStart || !entry.typeAtStart) {
                    return !typeAtStart && !entry.typeAtStart;
                }

                if (!typeAtStart.isIncomplete !== !entry.typeAtStart.isIncomplete) {
                    return false;
                }

                return isTypeSame(typeAtStart.type, entry.typeAtStart.type);
            });

            if (cachedEntry) {
                return cachedEntry.codeFlowAnalyzer;
            }
        }

        // Allocate a new code flow analyzer.
        const analyzer = codeFlowEngine.createCodeFlowAnalyzer();
        if (entries) {
            entries.push({ typeAtStart, codeFlowAnalyzer: analyzer });
        } else {
            entries = [{ typeAtStart, codeFlowAnalyzer: analyzer }];
            context.codeFlowAnalyzerCache.set(node.id, entries);
        }

        return analyzer;
    }

    function getFlowTypeOfReference(
        reference: CodeFlowReferenceExpressionNode,
        startNode?: ClassNode | FunctionNode | LambdaNode,
        options?: FlowNodeTypeOptions
    ): FlowNodeTypeResult {
        // See if this execution scope requires code flow for this reference expression.
        const referenceKey = createKeyForReference(reference);
        const executionNode = ParseTreeUtils.getExecutionScopeNode(startNode?.parent ?? reference, nodeInfo);
        const codeFlowExpressions = nodeInfo.getCodeFlowExpressions(executionNode);

        if (
            !codeFlowExpressions ||
            (!codeFlowExpressions.has(referenceKey) && !codeFlowExpressions.has(wildcardImportReferenceKey))
        ) {
            return FlowNodeTypeResult.create(/* type */ undefined, /* isIncomplete */ false);
        }

        if (checkCodeFlowTooComplex(reference)) {
            return FlowNodeTypeResult.create(
                /* type */ options?.typeAtStart && isUnbound(options.typeAtStart.type)
                    ? UnknownType.create()
                    : undefined,
                /* isIncomplete */ true
            );
        }

        // Is there an code flow analyzer cached for this execution scope?
        let analyzer: CodeFlowAnalyzer | undefined;

        if (isNodeInReturnTypeInferenceContext(executionNode)) {
            // If we're performing the analysis within a temporary
            // context of a function for purposes of inferring its
            // return type for a specified set of arguments, use
            // a temporary analyzer that we'll use only for this context.
            analyzer = getCodeFlowAnalyzerForReturnTypeInferenceContext();
        } else {
            analyzer = getCodeFlowAnalyzerForNode(executionNode, options?.typeAtStart);
        }

        const flowNode = nodeInfo.getFlowNode(startNode ?? reference);
        if (flowNode === undefined) {
            return FlowNodeTypeResult.create(/* type */ undefined, /* isIncomplete */ false);
        }

        return analyzer.getTypeFromCodeFlow(flowNode!, reference, options);
    }

    function narrowConstrainedTypeVar(node: ParseNode, typeVar: TypeVarType): Type | undefined {
        const flowNode = nodeInfo.getFlowNode(node);

        if (!flowNode) {
            return undefined;
        }

        return codeFlowEngine.narrowConstrainedTypeVar(flowNode, typeVar);
    }

    function printControlFlowGraph(
        flowNode: FlowNode,
        reference: CodeFlowReferenceExpressionNode | undefined,
        callName: string,
        logger: ConsoleInterface
    ) {
        return codeFlowEngine.printControlFlowGraph(flowNode, reference, callName, logger);
    }

    return {
        checkCodeFlowTooComplex,
        isNodeReachable,
        isAfterNodeReachable,
        getNodeReachability,
        getAfterNodeReachability,
        isFlowNodeReachableUsingNeverNarrowing,
        isFlowPathBetweenNodes,
        getCodeFlowAnalyzerForNode,
        getFlowTypeOfReference,
        narrowConstrainedTypeVar,
        printControlFlowGraph,
    };
}
