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
import { getFileInfo } from './analyzerNodeInfo';
import { getClassFullName, getTypeSourceId } from './parseTreeUtils';
import { Arg, TypeEvaluator } from './typeEvaluatorTypes';
import { ClassType, ClassTypeFlags, SentinelLiteral, Type, TypeBase } from './types';

export function createSentinelType(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    argList: Arg[]
): Type | undefined {
    let className = '';

    if (argList.length !== 1) {
        evaluator.addDiagnostic(DiagnosticRule.reportCallIssue, LocMessage.sentinelParamCount(), errorNode);
        return undefined;
    }

    const nameArg = argList[0];
    if (
        nameArg.argCategory === ArgCategory.Simple &&
        nameArg.valueExpression &&
        nameArg.valueExpression.nodeType === ParseNodeType.StringList
    ) {
        className = nameArg.valueExpression.d.strings.map((s) => s.d.value).join('');
    }

    if (!className) {
        evaluator.addDiagnostic(
            DiagnosticRule.reportArgumentType,
            LocMessage.sentinelBadName(),
            argList[0].node ?? errorNode
        );
        return undefined;
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
        return undefined;
    }

    const fileInfo = getFileInfo(errorNode);
    const fullClassName = getClassFullName(errorNode, fileInfo.moduleName, className);
    let classType = ClassType.createInstantiable(
        className,
        fullClassName,
        fileInfo.moduleName,
        fileInfo.fileUri,
        ClassTypeFlags.Final | ClassTypeFlags.ValidTypeAliasClass,
        getTypeSourceId(errorNode),
        /* declaredMetaclass */ undefined,
        evaluator.getTypeClassType()
    );

    classType = ClassType.cloneWithLiteral(classType, new SentinelLiteral(fullClassName, className));

    let instanceType = ClassType.cloneAsInstance(classType);

    // Is TypeForm supported?
    if (fileInfo.diagnosticRuleSet.enableExperimentalFeatures) {
        instanceType = TypeBase.cloneWithTypeForm(instanceType, instanceType);
    }

    return instanceType;
}
