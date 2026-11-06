/*
 * diagnostics.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * diagnostics implementation, using evaluator-owned dependencies and state.
 */

import { DiagnosticLevel } from '../../common/configOptions';
import { DiagnosticRule } from '../../common/diagnosticRules';
import { convertOffsetsToRange } from '../../common/positionUtils';
import { TextRange } from '../../common/textRange';
import { LocMessage } from '../../localization/localize';
import { ParseNode } from '../../parser/parseNodes';
import { AnalyzerFileInfo } from '../analyzerFileInfo';
import * as AnalyzerNodeInfo from '../analyzerNodeInfo';
import { getFunctionInfoFromDecorators } from '../decorators';
import * as ParseTreeUtils from '../parseTreeUtils';
import { SpeculativeTypeTracker } from '../typeCacheUtils';
import { EvaluatorOptions, SuppressedNodeStackEntry } from '../typeEvaluator/internals';
import { PrintTypeOptions, Reachability, TypeEvaluator } from '../typeEvaluatorTypes';
import { FunctionTypeFlags, Type } from '../types';

interface Context {
    readonly evaluatorInterface: TypeEvaluator;
    readonly evaluatorOptions: EvaluatorOptions;
    readonly isNodeReachable: (node: ParseNode, sourceNode?: ParseNode) => boolean;
    readonly nodeInfo: AnalyzerNodeInfo.AnalyzerNodeInfoAccessor;
    readonly printType: (type: Type, options?: PrintTypeOptions) => string;
    readonly speculativeTypeTracker: SpeculativeTypeTracker;
    readonly suppressedNodeStack: SuppressedNodeStackEntry[];
}

// Formats and emits diagnostics; suppression and evaluation state remain evaluator-owned.
export function createDiagnostics(context: Context) {
    const {
        evaluatorInterface,
        evaluatorOptions,
        isNodeReachable,
        nodeInfo,
        printType,
        speculativeTypeTracker,
        suppressedNodeStack,
    } = context;

    function addInformation(message: string, node: ParseNode, range?: TextRange) {
        return addDiagnosticWithSuppressionCheck('information', message, node, range);
    }

    function addUnreachableCode(node: ParseNode, reachability: Reachability, textRange: TextRange) {
        if (reachability === Reachability.Reachable) {
            return;
        }

        if (!isDiagnosticSuppressedForNode(node)) {
            const fileInfo = nodeInfo.getFileInfo(node);
            const reportTypeReachability = fileInfo.diagnosticRuleSet.enableReachabilityAnalysis;

            if (
                reachability === Reachability.UnreachableStructural ||
                reachability === Reachability.UnreachableStaticCondition ||
                reportTypeReachability
            ) {
                fileInfo.diagnosticSink.addUnreachableCodeWithTextRange(
                    reachability === Reachability.UnreachableStructural
                        ? LocMessage.unreachableCodeStructure()
                        : reachability === Reachability.UnreachableStaticCondition
                        ? LocMessage.unreachableCodeCondition()
                        : LocMessage.unreachableCodeType(),
                    textRange
                );
            }
        }
    }

    function addDeprecated(message: string, node: ParseNode) {
        if (!isDiagnosticSuppressedForNode(node)) {
            const fileInfo = nodeInfo.getFileInfo(node);
            fileInfo.diagnosticSink.addDeprecatedWithTextRange(message, node);
        }
    }

    function addDiagnosticWithSuppressionCheck(
        diagLevel: DiagnosticLevel,
        message: string,
        node: ParseNode,
        range?: TextRange
    ) {
        if (isDiagnosticSuppressedForNode(node)) {
            // See if this node is suppressed but the diagnostic should be generated
            // anyway so it can be used by the caller that requested the suppression.
            const suppressionEntry = suppressedNodeStack.find(
                (suppressedNode) =>
                    ParseTreeUtils.isNodeContainedWithin(node, suppressedNode.node) && suppressedNode.suppressedDiags
            );
            suppressionEntry?.suppressedDiags?.push(message);

            return undefined;
        }

        if (isNodeReachable(node)) {
            const fileInfo = nodeInfo.getFileInfo(node);
            const sink =
                evaluatorOptions.experimentalOverloadResult?.getDiagnosticSink(node) ?? fileInfo.diagnosticSink;
            return sink.addDiagnosticWithTextRange(diagLevel, message, range ?? node);
        }

        return undefined;
    }

    function isDiagnosticSuppressedForNode(node: ParseNode) {
        if (speculativeTypeTracker.isSpeculative(node, /* ignoreIfDiagnosticsAllowed */ true)) {
            return true;
        }

        return suppressedNodeStack.some((suppressedNode) =>
            ParseTreeUtils.isNodeContainedWithin(node, suppressedNode.node)
        );
    }

    function canSkipDiagnosticForNode(node: ParseNode) {
        if (speculativeTypeTracker.isSpeculative(node, /* ignoreIfDiagnosticsAllowed */ true)) {
            return true;
        }

        const suppressedEntries = suppressedNodeStack.filter((suppressedNode) =>
            ParseTreeUtils.isNodeContainedWithin(node, suppressedNode.node)
        );

        if (suppressedEntries.length === 0) {
            return false;
        }

        return suppressedEntries.every((entry) => !entry.suppressedDiags);
    }

    function addDiagnostic(rule: DiagnosticRule, message: string, node: ParseNode, range?: TextRange) {
        const fileInfo = nodeInfo.getFileInfo(node);
        const diagLevel = fileInfo.diagnosticRuleSet[rule] as DiagnosticLevel;

        if (diagLevel === 'none') {
            return undefined;
        }

        const containingFunction = ParseTreeUtils.getEnclosingFunction(node);

        if (containingFunction) {
            // Should we suppress this diagnostic because it's within an unannotated function?
            const fileInfo = nodeInfo.getFileInfo(node);
            if (!fileInfo.diagnosticRuleSet.analyzeUnannotatedFunctions) {
                // Is the target node within the body of the function? If so, suppress the diagnostic.
                if (
                    ParseTreeUtils.isUnannotatedFunction(containingFunction) &&
                    ParseTreeUtils.isNodeContainedWithin(node, containingFunction.d.suite)
                ) {
                    return undefined;
                }
            }

            // Should we suppress this diagnostic because it's within a no_type_check function?
            const containingClassNode = ParseTreeUtils.getEnclosingClass(containingFunction, /* stopAtFunction */ true);
            const functionInfo = getFunctionInfoFromDecorators(
                evaluatorInterface,
                containingFunction,
                !!containingClassNode,
                nodeInfo
            );

            if ((functionInfo.flags & FunctionTypeFlags.NoTypeCheck) !== 0) {
                return undefined;
            }
        }

        const diagnostic = addDiagnosticWithSuppressionCheck(diagLevel, message, node, range);
        if (diagnostic) {
            diagnostic.setRule(rule);
        }

        return diagnostic;
    }

    function addDiagnosticForTextRange(
        fileInfo: AnalyzerFileInfo,
        rule: DiagnosticRule,
        message: string,
        range: TextRange
    ) {
        const diagLevel = fileInfo.diagnosticRuleSet[rule] as DiagnosticLevel;

        if (diagLevel === 'none') {
            return undefined;
        }

        const diagnostic = fileInfo.diagnosticSink.addDiagnosticWithTextRange(diagLevel, message, range);
        if (rule) {
            diagnostic.setRule(rule);
        }

        return diagnostic;
    }

    function suppressDiagnostics<T>(
        node: ParseNode,
        callback: () => T,
        diagCallback?: (suppressedDiags: string[]) => void
    ) {
        suppressedNodeStack.push({ node, suppressedDiags: diagCallback ? [] : undefined });

        try {
            const result = callback();
            const poppedNode = suppressedNodeStack.pop();
            if (diagCallback && poppedNode?.suppressedDiags) {
                diagCallback(poppedNode.suppressedDiags);
            }
            return result;
        } catch (e) {
            // We don't use finally here because the TypeScript debugger doesn't
            // handle finally well when single stepping.
            suppressedNodeStack.pop();
            throw e;
        }
    }

    function printSrcDestTypes(
        srcType: Type,
        destType: Type,
        options?: PrintTypeOptions
    ): { sourceType: string; destType: string } {
        const simpleSrcType = printType(srcType, options);
        const simpleDestType = printType(destType, options);

        if (simpleSrcType !== simpleDestType) {
            return { sourceType: simpleSrcType, destType: simpleDestType };
        }

        const fullSrcType = printType(srcType, { ...(options ?? {}), useFullyQualifiedNames: true });
        const fullDestType = printType(destType, { ...(options ?? {}), useFullyQualifiedNames: true });

        if (fullSrcType !== fullDestType) {
            return { sourceType: fullSrcType, destType: fullDestType };
        }

        return { sourceType: simpleSrcType, destType: simpleDestType };
    }

    function getLineNum(node: ParseNode) {
        const fileInfo = nodeInfo.getFileInfo(node);
        const range = convertOffsetsToRange(node.start, node.start + node.length, fileInfo.lines);
        return (range.start.line + 1).toString();
    }

    return {
        addInformation,
        addUnreachableCode,
        addDeprecated,
        addDiagnosticWithSuppressionCheck,
        isDiagnosticSuppressedForNode,
        canSkipDiagnosticForNode,
        addDiagnostic,
        addDiagnosticForTextRange,
        suppressDiagnostics,
        printSrcDestTypes,
        getLineNum,
    };
}
