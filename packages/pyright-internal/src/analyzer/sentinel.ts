/*
 * sentinels.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides type evaluation logic that is specific to PEP 661 Sentinels.
 */

import { DiagnosticRule } from '../common/diagnosticRules';
import { LocMessage } from '../localization/localize';
import { ArgCategory, ExpressionNode, ParseNodeType } from '../parser/parseNodes';
import { AnalyzerNodeInfoAccessor } from './analyzerNodeInfo';
import { validateConstructorArgs } from './constructors';
import {
    getClassFullName,
    getEvaluationScopeNode,
    getExecutionScopeNode,
    getTypeSourceId,
    isWithinLoop,
} from './parseTreeUtils';
import { Arg, CallResult, TypeEvaluator } from './typeEvaluatorTypes';
import { ClassType, ClassTypeFlags, SentinelLiteral, TypeBase } from './types';
import { InferenceContext, computeMroLinearization } from './typeUtils';

export function createSentinelType(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    argList: Arg[],
    sentinelBaseClass: ClassType,
    nodeInfo: AnalyzerNodeInfoAccessor,
    skipUnknownArgCheck: boolean | undefined,
    inferenceContext: InferenceContext | undefined
): CallResult {
    let className = '';

    if (argList.length !== 1) {
        evaluator.addDiagnostic(DiagnosticRule.reportCallIssue, LocMessage.sentinelParamCount(), errorNode);
        return {};
    }

    const nameArg = argList[0];
    if (
        nameArg.argCategory === ArgCategory.Simple &&
        nameArg.valueExpression &&
        nameArg.valueExpression.nodeType === ParseNodeType.StringList &&
        nameArg.valueExpression.d.strings.every((s) => s.nodeType === ParseNodeType.String)
    ) {
        className = nameArg.valueExpression.d.strings.map((s) => s.d.value).join('');
    }

    if (!className) {
        // Runtime names do not declare singleton types. Use ordinary constructor
        // validation so argument types and unpacking follow the class signature.
        return validateConstructorArgs(
            evaluator,
            errorNode,
            argList,
            sentinelBaseClass,
            skipUnknownArgCheck,
            inferenceContext
        );
    }

    if (
        errorNode.parent?.nodeType === ParseNodeType.Assignment &&
        errorNode.parent.d.leftExpr.nodeType === ParseNodeType.Name &&
        errorNode.parent.d.leftExpr.d.value !== className
    ) {
        evaluator.addDiagnostic(
            DiagnosticRule.reportGeneralTypeIssues,
            LocMessage.sentinelNameMismatch(),
            errorNode.parent.d.leftExpr
        );
        return {};
    }

    const fileInfo = nodeInfo.getFileInfo(errorNode);
    const fullClassName = getClassFullName(errorNode, fileInfo.moduleName, className);
    let classType = ClassType.createInstantiable(
        className,
        fullClassName,
        fileInfo.moduleName,
        fileInfo.fileUri,
        ClassTypeFlags.Final | ClassTypeFlags.ValidTypeAliasClass,
        getTypeSourceId(errorNode),
        /* declaredMetaclass */ undefined,
        sentinelBaseClass.shared.effectiveMetaclass
    );

    classType.shared.baseClasses.push(sentinelBaseClass);
    computeMroLinearization(classType);

    // A repeatable allocation site can produce multiple distinct sentinel objects.
    const scopeNode = getEvaluationScopeNode(errorNode, nodeInfo).node;
    if (
        (scopeNode.nodeType === ParseNodeType.Module || scopeNode.nodeType === ParseNodeType.Class) &&
        getExecutionScopeNode(errorNode, nodeInfo).nodeType === ParseNodeType.Module &&
        !isWithinLoop(errorNode)
    ) {
        classType = ClassType.cloneWithLiteral(classType, new SentinelLiteral(fullClassName, className));
    }

    let instanceType = ClassType.cloneAsInstance(classType);

    instanceType = TypeBase.cloneWithTypeForm(instanceType, instanceType);

    return { returnType: instanceType };
}
