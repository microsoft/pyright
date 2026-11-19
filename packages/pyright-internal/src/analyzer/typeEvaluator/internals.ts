/*
 * internals.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Shared private contracts for evaluator implementation modules.
 */

import {
    AssignmentNode,
    ClassNode,
    ExpressionNode,
    FunctionNode,
    LambdaNode,
    MemberAccessNode,
    ParseNode,
    TypeParameterScopeNode,
} from '../../parser/parseNodes';
import * as AnalyzerNodeInfo from '../analyzerNodeInfo';
import { CodeFlowAnalyzer } from '../codeFlowEngine';
import { ConstraintTracker } from '../constraintTracker';
import { Declaration } from '../declaration';
import { ContextualTypeCacheEntry } from '../typeCacheUtils';
import {
    Arg,
    ArgResult,
    CallSiteEvaluationInfo,
    EvalFlags,
    EvaluationOperationController,
    MemberAccessDeprecationInfo,
    TypeResult,
    ValidateArgTypeParams,
} from '../typeEvaluatorTypes';
import * as TypePrinter from '../typePrinter';
import {
    ClassType,
    FunctionParam,
    FunctionType,
    ParamSpecType,
    Type,
    TypeCondition,
    TypeVarType,
    Variance,
} from '../types';
import { UniqueSignatureTracker } from '../typeUtils';

export interface GetTypeArgsOptions {
    isAnnotatedClass?: boolean;
    hasCustomClassGetItem?: boolean;
    isFinalAnnotation?: boolean;
    isClassVarAnnotation?: boolean;
    supportsTypedDictTypeArg?: boolean;
}

export interface MatchArgsToParamsResult {
    overload: FunctionType;
    overloadIndex: number;

    argumentErrors: boolean;
    isTypeIncomplete: boolean;
    argParams: ValidateArgTypeParams[];
    unexpandedArgList?: Arg[] | undefined;
    activeParam?: FunctionParam | undefined;
    paramSpecTarget?: ParamSpecType | undefined;
    paramSpecArgList?: Arg[] | undefined;

    // Was there an unpacked argument of unknown length?
    unpackedArgOfUnknownLength?: boolean;

    // Did that unpacked argument map to a variadic parameter?
    unpackedArgMapsToVariadic?: boolean;

    // A score that indicates how well the overload matches with
    // supplied arguments. Used to pick the "best" for purposes
    // of error reporting when no matches are found. The higher
    // the score, the worse the match.
    argumentMatchScore: number;
}

export interface MemberAccessTypeResult {
    type: Type;
    isDescriptorApplied?: boolean;
    isAsymmetricAccessor?: boolean;
    memberAccessDeprecationInfo?: MemberAccessDeprecationInfo;
    typeErrors?: boolean;
}

export interface ScopedTypeVarResult {
    type: TypeVarType;
    scopeNode: TypeParameterScopeNode | AssignmentNode | undefined;
    foundInterveningClass: boolean;
}

export interface AliasMapEntry {
    alias: string;
    module: 'builtins' | 'collections' | 'internals';
    implicitBaseClass?: string;
    isSpecialForm?: boolean;
    isIllegalInIsinstance?: boolean;
    typeParamVariance?: Variance;
}

export interface AssignClassToSelfInfo {
    class: ClassType;
    assumedVariance: Variance;
}

export interface MatchedOverloadInfo {
    overload: FunctionType;
    matchResults: MatchArgsToParamsResult;
    constraints: ConstraintTracker;
    argResults: ArgResult[];
    returnType: Type;

    // The instance type inferred by a matched __init__ overload.
    specializedInitSelfType?: Type;
}

export interface ValidateArgTypeOptions {
    skipUnknownArgCheck?: boolean;
    isArgFirstPass?: boolean;
    conditionFilter?: TypeCondition[];
    skipReportError?: boolean;
}

export interface EffectiveReturnTypeOptions {
    callSiteInfo?: CallSiteEvaluationInfo;
}

export interface SignatureTrackerStackEntry {
    tracker: UniqueSignatureTracker;
    rootNode: ParseNode;
}

export interface SymbolResolutionStackEntry {
    // The symbol ID and declaration being resolved.
    symbolId: number;
    declaration: Declaration;

    // Initially true, it's set to false if a recursion
    // is detected.
    isResultValid: boolean;

    // Some limited forms of recursion are allowed. In these
    // cases, a partially-constructed type can be registered.
    partialType?: Type | undefined;
}

export interface ReturnTypeInferenceContext {
    functionNode: FunctionNode;
    codeFlowAnalyzer: CodeFlowAnalyzer;
}

export interface ParamSpecArgResult {
    argumentErrors: boolean;
    constraintTrackers: (ConstraintTracker | undefined)[];
}

export interface EvaluatorOptions {
    printTypeFlags: TypePrinter.PrintTypeFlags;
    logCalls: boolean;
    minimumLoggingThreshold: number;
    evaluateUnknownImportsAsAny: boolean;
    verifyTypeCacheEvaluatorFlags: boolean;
    nodeInfoReader: AnalyzerNodeInfo.AnalyzerNodeInfoReader;
    maxCodeComplexity: number;
    experimentalOverloadResult?: import('../overloadResultController').ExperimentalOverloadResultController;
    // Artifact-only root-operation experiment. No normal evaluator installs this hook.
    testOnlyMemberAccess?: {
        nodes: ReadonlySet<MemberAccessNode>;
        install: (getMember: (node: MemberAccessNode, baseTypeResult: TypeResult) => TypeResult) => void;
    };
    // Test-only injection uses the same production cache-ownership contract.
    testOnlyExpression?: EvaluationOperationController & {
        query?: (node: ExpressionNode) => TypeResult | undefined;
    };
}

export interface DeferredClassCompletion {
    dependsUpon: ClassType;
    classesToComplete: ClassNode[];
}

export interface TypeCacheEntry {
    typeResult: TypeResult;
    incompleteGenCount: number;
    flags: EvalFlags | undefined;
}

export interface ContextualLambdaTypeCache {
    lambdaNodes: LambdaNode[];
    entries: Map<ParseNode, Map<number, TypeCacheEntry>>;
    branchIndex: number;
}

export interface TypeFormTypeCacheEntry extends TypeCacheEntry, ContextualTypeCacheEntry {}

export interface CodeFlowAnalyzerCacheEntry {
    typeAtStart: TypeResult | undefined;
    codeFlowAnalyzer: CodeFlowAnalyzer;
}

export interface FunctionRecursionInfo {
    callerNode: ExpressionNode | undefined;
}

export type LogWrapper = <T extends (...args: any[]) => any>(func: T) => (...args: Parameters<T>) => ReturnType<T>;

export interface SuppressedNodeStackEntry {
    node: ParseNode;
    suppressedDiags: string[] | undefined;
}

export interface ExpectedTypeCacheEntry {
    type: Type;
    candidates: Type[];
}
