/*
 * sentinels.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides type evaluation logic that is specific to PEP 661 Sentinels.
 */

import { ArgCategory, ExpressionNode, ParseNodeType } from '../parser/parseNodes';
import { AnalyzerNodeInfoAccessor } from './analyzerNodeInfo';
import {
    getClassFullName,
    getEvaluationScopeNode,
    getExecutionScopeNode,
    getTypeSourceId,
    isWithinLoop,
} from './parseTreeUtils';
import { Arg } from './typeEvaluatorTypes';
import { ClassType, ClassTypeFlags, isClass, isInstantiableClass, SentinelLiteral, Type, TypeBase } from './types';
import { computeMroLinearization } from './typeUtils';

export function createSentinelType(
    errorNode: ExpressionNode,
    argList: Arg[],
    sentinelBaseClass: ClassType,
    nodeInfo: AnalyzerNodeInfoAccessor
): Type | undefined {
    const nameArg = argList[0];
    if (
        sentinelBaseClass.priv.includeSubclasses ||
        nameArg?.argCategory !== ArgCategory.Simple ||
        nameArg.valueExpression?.nodeType !== ParseNodeType.StringList ||
        nameArg.valueExpression.d.strings.some((s) => s.nodeType !== ParseNodeType.String)
    ) {
        return undefined;
    }

    const scopeNode = getEvaluationScopeNode(errorNode, nodeInfo).node;
    const isSingleton =
        (scopeNode.nodeType === ParseNodeType.Module || scopeNode.nodeType === ParseNodeType.Class) &&
        getExecutionScopeNode(errorNode, nodeInfo).nodeType === ParseNodeType.Module &&
        !isWithinLoop(errorNode);

    let className = nameArg.valueExpression.d.strings.map((s) => s.d.value).join('');
    if (
        errorNode.parent?.nodeType === ParseNodeType.Assignment &&
        errorNode.parent.d.leftExpr.nodeType === ParseNodeType.Name
    ) {
        className = errorNode.parent.d.leftExpr.d.value;
    }

    const fileInfo = nodeInfo.getFileInfo(errorNode);
    const fullClassName = getClassFullName(errorNode, fileInfo.moduleName, className);
    let classType = ClassType.createInstantiable(
        className,
        fullClassName,
        fileInfo.moduleName,
        fileInfo.fileUri,
        ClassTypeFlags.Final |
            ClassTypeFlags.SentinelValueClass |
            (isSingleton ? ClassTypeFlags.ValidTypeAliasClass : ClassTypeFlags.None),
        getTypeSourceId(errorNode),
        /* declaredMetaclass */ undefined,
        sentinelBaseClass.shared.effectiveMetaclass
    );

    classType.shared.sentinelIdentity = {
        name: className,
        fullName: fullClassName,
        moduleName: fileInfo.moduleName,
        typeSourceId: classType.shared.typeSourceId,
        isSingleton,
    };
    classType.shared.baseClasses.push(sentinelBaseClass);
    computeMroLinearization(classType);

    if (isSingleton) {
        classType = ClassType.cloneWithLiteral(classType, new SentinelLiteral(fullClassName, className));
    }

    const instanceType = ClassType.cloneAsInstance(classType);
    return isSingleton ? TypeBase.cloneWithTypeForm(instanceType, instanceType) : instanceType;
}

export function getSentinelClass(type: Type): ClassType | undefined {
    if (!isClass(type)) {
        return undefined;
    }

    if (
        (type.shared.flags & ClassTypeFlags.SentinelValueClass) !== 0 ||
        type.priv.literalValue instanceof SentinelLiteral
    ) {
        const baseClass = type.shared.baseClasses[0];
        return isInstantiableClass(baseClass) ? baseClass : undefined;
    }

    if (isSentinelClass(type)) {
        return isInstantiableClass(type) ? type : ClassType.cloneAsInstantiable(type);
    }

    return undefined;
}

export function isSentinelClass(classType: ClassType): boolean {
    return (
        classType.shared.fullName === 'builtins.sentinel' ||
        classType.shared.fullName === 'typing_extensions.sentinel' ||
        classType.shared.fullName === 'typing_extensions.Sentinel'
    );
}
