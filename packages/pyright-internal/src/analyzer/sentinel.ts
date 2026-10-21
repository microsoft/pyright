/*
 * sentinels.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides type evaluation logic that is specific to PEP 661 Sentinels.
 */

import { DiagnosticAddendum } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { LocMessage } from '../localization/localize';
import { ArgCategory, ExpressionNode, ParseNodeType } from '../parser/parseNodes';
import { AnalyzerNodeInfoAccessor } from './analyzerNodeInfo';
import { getClassFullName, getTypeSourceId } from './parseTreeUtils';
import { Arg, TypeEvaluator } from './typeEvaluatorTypes';
import { ClassType, ClassTypeFlags, combineTypes, SentinelLiteral, Type, TypeBase } from './types';
import { computeMroLinearization, makeInferenceContext } from './typeUtils';

export function createSentinelType(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    argList: Arg[],
    sentinelBaseClass: ClassType,
    nodeInfo: AnalyzerNodeInfoAccessor
): Type | undefined {
    let className = '';

    const positionalArgs = argList.filter((arg) => !arg.name);
    const reprArg = argList.find((arg) => arg.name?.d.value === 'repr');

    if (positionalArgs.length !== 1 || argList.length !== (reprArg ? 2 : 1)) {
        evaluator.addDiagnostic(DiagnosticRule.reportCallIssue, LocMessage.sentinelParamCount(), errorNode);
        return undefined;
    }

    if (reprArg) {
        const reprParamType = combineTypes([evaluator.getBuiltInObject(errorNode, 'str'), evaluator.getNoneType()]);
        const reprArgType = evaluator.getTypeOfArg(reprArg, makeInferenceContext(reprParamType)).type;
        const diag = new DiagnosticAddendum();

        if (!evaluator.assignType(reprParamType, reprArgType, diag)) {
            evaluator.addDiagnostic(
                DiagnosticRule.reportArgumentType,
                LocMessage.argAssignmentParam().format({
                    argType: evaluator.printType(reprArgType),
                    paramType: evaluator.printType(reprParamType),
                    paramName: 'repr',
                }) + diag.getString(),
                reprArg.valueExpression ?? errorNode
            );
        }
    }

    const nameArg = positionalArgs[0];
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
    classType = ClassType.cloneWithLiteral(classType, new SentinelLiteral(fullClassName, className));

    let instanceType = ClassType.cloneAsInstance(classType);

    instanceType = TypeBase.cloneWithTypeForm(instanceType, instanceType);

    return instanceType;
}
