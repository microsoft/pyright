/*
 * functionTransform.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Code that transforms the return result of a function.
 *
 */

import { DiagnosticRule } from '../common/diagnosticRules';
import { Localizer } from '../localization/localize';
import { ExpressionNode, ParameterCategory } from '../parser/parseNodes';
import { getFileInfo } from './analyzerNodeInfo';
import { Symbol, SymbolFlags } from './symbol';
import { FunctionArgument, FunctionResult, TypeEvaluator } from './typeEvaluatorTypes';
import {
    ClassType,
    FunctionParameter,
    FunctionType,
    FunctionTypeFlags,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    OverloadedFunctionType,
} from './types';
import { ClassMemberLookupFlags, lookUpObjectMember, synthesizeTypeVarForSelfCls } from './typeUtils';

export function applyFunctionTransform(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    argList: FunctionArgument[],
    functionType: FunctionType | OverloadedFunctionType,
    result: FunctionResult
): FunctionResult {
    if (isFunction(functionType)) {
        if (functionType.details.fullName === 'functools.total_ordering') {
            return applyTotalOrderingTransform(evaluator, errorNode, argList, result);
        }
    }

    // By default, return the result unmodified.
    return result;
}

function applyTotalOrderingTransform(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    argList: FunctionArgument[],
    result: FunctionResult
) {
    if (argList.length !== 1) {
        return result;
    }

    // This function is meant to apply to a concrete instantiable class.
    const classType = argList[0].type;
    if (!classType || !isInstantiableClass(classType) || classType.includeSubclasses) {
        return result;
    }

    const orderingMethods = ['__lt__', '__le__', '__gt__', '__ge__'];
    const instanceType = ClassType.cloneAsInstance(classType);

    // Verify that the class has at least one of the required functions.
    const missingMethods = orderingMethods.filter((methodName) => {
        return !lookUpObjectMember(instanceType, methodName, ClassMemberLookupFlags.SkipInstanceVariables);
    });

    if (missingMethods.length === orderingMethods.length) {
        evaluator.addDiagnostic(
            getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
            DiagnosticRule.reportGeneralTypeIssues,
            Localizer.Diagnostic.totalOrderingMissingMethod(),
            errorNode
        );
        return result;
    }

    const objectType = evaluator.getBuiltInObject(errorNode, 'object');
    if (!objectType || !isClassInstance(objectType)) {
        return result;
    }

    const boolType = evaluator.getBuiltInObject(errorNode, 'bool');
    if (!boolType || !isClassInstance(boolType)) {
        return result;
    }

    const selfParam: FunctionParameter = {
        category: ParameterCategory.Simple,
        name: 'self',
        type: synthesizeTypeVarForSelfCls(classType, /* isClsParam */ false),
        hasDeclaredType: true,
    };

    const objParam: FunctionParameter = {
        category: ParameterCategory.Simple,
        name: '__value',
        type: objectType,
        hasDeclaredType: true,
    };

    // Add the missing members to the class's symbol table.
    missingMethods.forEach((methodName) => {
        const methodToAdd = FunctionType.createInstance(methodName, '', '', FunctionTypeFlags.SynthesizedMethod);
        FunctionType.addParameter(methodToAdd, selfParam);
        FunctionType.addParameter(methodToAdd, objParam);
        methodToAdd.details.declaredReturnType = boolType;

        classType.details.fields.set(methodName, Symbol.createWithType(SymbolFlags.ClassMember, methodToAdd));
    });

    return result;
}
