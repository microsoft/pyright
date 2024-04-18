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
import { LocMessage } from '../localization/localize';
import { ExpressionNode, ParameterCategory } from '../parser/parseNodes';
import { Symbol, SymbolFlags } from './symbol';
import { FunctionArgument, FunctionResult, TypeEvaluator } from './typeEvaluatorTypes';
import {
    ClassType,
    FunctionParameter,
    FunctionType,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    OverloadedFunctionType,
    Type,
} from './types';
import { ClassMember, lookUpObjectMember, MemberAccessFlags, synthesizeTypeVarForSelfCls } from './typeUtils';

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
    const classType = argList[0].typeResult?.type;
    if (!classType || !isInstantiableClass(classType) || classType.includeSubclasses) {
        return result;
    }

    const orderingMethods = ['__lt__', '__le__', '__gt__', '__ge__'];
    const instanceType = ClassType.cloneAsInstance(classType);

    // Verify that the class has at least one of the required functions.
    let firstMemberFound: ClassMember | undefined;
    const missingMethods = orderingMethods.filter((methodName) => {
        const memberInfo = lookUpObjectMember(instanceType, methodName, MemberAccessFlags.SkipInstanceMembers);
        if (memberInfo && !firstMemberFound) {
            firstMemberFound = memberInfo;
        }
        return !memberInfo;
    });

    if (!firstMemberFound) {
        evaluator.addDiagnostic(
            DiagnosticRule.reportGeneralTypeIssues,
            LocMessage.totalOrderingMissingMethod(),
            errorNode
        );
        return result;
    }

    // Determine what type to use for the parameter corresponding to
    // the second operand. This will be taken from the existing method.
    let operandType: Type | undefined;

    const firstMemberType = evaluator.getTypeOfMember(firstMemberFound);
    if (
        isFunction(firstMemberType) &&
        firstMemberType.details.parameters.length >= 2 &&
        firstMemberType.details.parameters[1].hasDeclaredType
    ) {
        operandType = firstMemberType.details.parameters[1].type;
    }

    // If there was no provided operand type, fall back to object.
    if (!operandType) {
        const objectType = evaluator.getBuiltInObject(errorNode, 'object');
        if (!objectType || !isClassInstance(objectType)) {
            return result;
        }
        operandType = objectType;
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
        type: operandType,
        hasDeclaredType: true,
    };

    // Add the missing members to the class's symbol table.
    missingMethods.forEach((methodName) => {
        const methodToAdd = FunctionType.createSynthesizedInstance(methodName);
        FunctionType.addParameter(methodToAdd, selfParam);
        FunctionType.addParameter(methodToAdd, objParam);
        methodToAdd.details.declaredReturnType = boolType;

        ClassType.getSymbolTable(classType).set(
            methodName,
            Symbol.createWithType(SymbolFlags.ClassMember, methodToAdd)
        );
    });

    return result;
}
