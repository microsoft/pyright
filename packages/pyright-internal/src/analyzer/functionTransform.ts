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
import { ExpressionNode, ParamCategory } from '../parser/parseNodes';
import { Symbol, SymbolFlags } from './symbol';
import { Arg, FunctionResult, TypeEvaluator } from './typeEvaluatorTypes';
import {
    ClassType,
    FunctionParam,
    FunctionParamFlags,
    FunctionType,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    OverloadedType,
    Type,
} from './types';
import { ClassMember, lookUpObjectMember, MemberAccessFlags, synthesizeTypeVarForSelfCls } from './typeUtils';

export function applyFunctionTransform(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    argList: Arg[],
    functionType: FunctionType | OverloadedType,
    result: FunctionResult
): FunctionResult {
    if (isFunction(functionType)) {
        if (functionType.shared.fullName === 'functools.total_ordering') {
            return applyTotalOrderingTransform(evaluator, errorNode, argList, result);
        }
    }

    // By default, return the result unmodified.
    return result;
}

function applyTotalOrderingTransform(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    argList: Arg[],
    result: FunctionResult
) {
    if (argList.length !== 1) {
        return result;
    }

    // This function is meant to apply to a concrete instantiable class.
    const classType = argList[0].typeResult?.type;
    if (!classType || !isInstantiableClass(classType) || classType.priv.includeSubclasses) {
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
        firstMemberType.shared.parameters.length >= 2 &&
        FunctionParam.isTypeDeclared(firstMemberType.shared.parameters[1])
    ) {
        operandType = FunctionType.getParamType(firstMemberType, 1);
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

    const selfParam = FunctionParam.create(
        ParamCategory.Simple,
        synthesizeTypeVarForSelfCls(classType, /* isClsParam */ false),
        FunctionParamFlags.TypeDeclared,
        'self'
    );

    const objParam = FunctionParam.create(
        ParamCategory.Simple,
        operandType,
        FunctionParamFlags.TypeDeclared,
        '__value'
    );

    // Add the missing members to the class's symbol table.
    missingMethods.forEach((methodName) => {
        const methodToAdd = FunctionType.createSynthesizedInstance(methodName);
        FunctionType.addParam(methodToAdd, selfParam);
        FunctionType.addParam(methodToAdd, objParam);
        methodToAdd.shared.declaredReturnType = boolType;

        ClassType.getSymbolTable(classType).set(
            methodName,
            Symbol.createWithType(SymbolFlags.ClassMember, methodToAdd)
        );
    });

    return result;
}
