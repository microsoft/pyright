/*
 * constructorTransform.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Code that transforms a newly-created object after a call to the
 * constructor is evaluated. It allows for special-case behavior that
 * cannot otherwise be described in the Python type system.
 *
 */

import { DiagnosticAddendum } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { Localizer } from '../localization/localize';
import { ArgumentCategory, ExpressionNode, ParameterCategory } from '../parser/parseNodes';
import { getFileInfo } from './analyzerNodeInfo';
import { Symbol, SymbolFlags } from './symbol';
import { FunctionArgument, FunctionResult, TypeEvaluator } from './typeEvaluatorTypes';
import { ClassType, FunctionParameter, FunctionType, isClassInstance, isFunction, isTypeSame } from './types';
import {
    applySolvedTypeVars,
    convertToInstance,
    getParameterListDetails,
    getTypeVarScopeId,
    lookUpObjectMember,
    ParameterSource,
} from './typeUtils';
import { TypeVarMap } from './typeVarMap';

export function applyConstructorTransform(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    argList: FunctionArgument[],
    classType: ClassType,
    result: FunctionResult
): FunctionResult {
    if (classType.details.fullName === 'functools.partial') {
        return applyPartialTransform(evaluator, errorNode, argList, result);
    }

    // By default, return the result unmodified.
    return result;
}

// Applies a transform for the functools.partial class constructor.
function applyPartialTransform(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    argList: FunctionArgument[],
    result: FunctionResult
): FunctionResult {
    // We assume that the normal return result is a functools.partial class instance.
    if (!isClassInstance(result.returnType) || result.returnType.details.fullName !== 'functools.partial') {
        return result;
    }

    const callMemberResult = lookUpObjectMember(result.returnType, '__call__');
    if (!callMemberResult || !isTypeSame(convertToInstance(callMemberResult.classType), result.returnType)) {
        return result;
    }

    const callMemberType = evaluator.getTypeOfMember(callMemberResult);
    if (!isFunction(callMemberType) || callMemberType.details.parameters.length < 1) {
        return result;
    }

    if (argList.length < 1) {
        return result;
    }

    const origFunctionTypeResult = evaluator.getTypeForArgument(argList[0]);
    const origFunctionType = origFunctionTypeResult.type;

    // Evaluate the inferred return type if necessary.
    evaluator.inferReturnTypeIfNecessary(origFunctionType);

    // Make sure the first argument is a simple function.
    // We don't currently handle overloaded functions.
    if (!isFunction(origFunctionType)) {
        return result;
    }

    // We don't currently handle unpacked arguments.
    if (argList.some((arg) => arg.argumentCategory !== ArgumentCategory.Simple)) {
        return result;
    }

    // Create a map to track which parameters have supplied arguments.
    const paramMap = new Map<string, boolean>();

    const paramListDetails = getParameterListDetails(origFunctionType);

    // Verify the types of the provided arguments.
    let argumentErrors = false;
    let reportedPositionalError = false;
    const typeVarMap = new TypeVarMap(getTypeVarScopeId(origFunctionType));

    const remainingArgsList = argList.slice(1);
    remainingArgsList.forEach((arg, argIndex) => {
        const argTypeResult = evaluator.getTypeForArgument(arg);

        // Is it a positional argument or a keyword argument?
        if (!arg.name) {
            // Does this positional argument map to a positional parameter?
            if (
                argIndex >= paramListDetails.params.length ||
                paramListDetails.params[argIndex].source === ParameterSource.KeywordOnly
            ) {
                if (paramListDetails.argsIndex !== undefined) {
                    const paramType = FunctionType.getEffectiveParameterType(
                        origFunctionType,
                        paramListDetails.params[paramListDetails.argsIndex].index
                    );
                    const diag = new DiagnosticAddendum();

                    if (!evaluator.canAssignType(paramType, argTypeResult.type, diag, typeVarMap)) {
                        evaluator.addDiagnostic(
                            getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.argAssignmentParamFunction().format({
                                argType: evaluator.printType(argTypeResult.type),
                                paramType: evaluator.printType(paramType),
                                functionName: origFunctionType.details.name,
                                paramName: paramListDetails.params[paramListDetails.argsIndex].param.name ?? '',
                            }),
                            arg.valueExpression ?? errorNode
                        );

                        argumentErrors = true;
                    }
                } else {
                    // Don't report multiple positional errors.
                    if (!reportedPositionalError) {
                        evaluator.addDiagnostic(
                            getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            paramListDetails.positionParamCount === 1
                                ? Localizer.Diagnostic.argPositionalExpectedOne()
                                : Localizer.Diagnostic.argPositionalExpectedCount().format({
                                      expected: paramListDetails.positionParamCount,
                                  }),
                            arg.valueExpression ?? errorNode
                        );
                    }

                    reportedPositionalError = true;
                    argumentErrors = true;
                }
            } else {
                const paramType = FunctionType.getEffectiveParameterType(origFunctionType, argIndex);
                const diag = new DiagnosticAddendum();
                const paramName = paramListDetails.params[argIndex].param.name ?? '';

                if (!evaluator.canAssignType(paramType, argTypeResult.type, diag, typeVarMap)) {
                    evaluator.addDiagnostic(
                        getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.argAssignmentParamFunction().format({
                            argType: evaluator.printType(argTypeResult.type),
                            paramType: evaluator.printType(paramType),
                            functionName: origFunctionType.details.name,
                            paramName,
                        }),
                        arg.valueExpression ?? errorNode
                    );

                    argumentErrors = true;
                }

                // Mark the parameter as assigned.
                paramMap.set(paramName, false);
            }
        } else {
            const matchingParam = paramListDetails.params.find(
                (paramInfo) =>
                    paramInfo.param.name === arg.name?.value && paramInfo.source !== ParameterSource.PositionOnly
            );

            if (!matchingParam) {
                // Is there a kwargs parameter?
                if (paramListDetails.kwargsIndex === undefined) {
                    evaluator.addDiagnostic(
                        getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.paramNameMissing().format({ name: arg.name.value }),
                        arg.name
                    );
                    argumentErrors = true;
                } else {
                    const paramType = FunctionType.getEffectiveParameterType(
                        origFunctionType,
                        paramListDetails.params[paramListDetails.kwargsIndex].index
                    );
                    const diag = new DiagnosticAddendum();

                    if (!evaluator.canAssignType(paramType, argTypeResult.type, diag, typeVarMap)) {
                        evaluator.addDiagnostic(
                            getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.argAssignmentParamFunction().format({
                                argType: evaluator.printType(argTypeResult.type),
                                paramType: evaluator.printType(paramType),
                                functionName: origFunctionType.details.name,
                                paramName: paramListDetails.params[paramListDetails.kwargsIndex].param.name ?? '',
                            }),
                            arg.valueExpression ?? errorNode
                        );

                        argumentErrors = true;
                    }
                }
            } else {
                const paramName = matchingParam.param.name!;
                const paramType = FunctionType.getEffectiveParameterType(origFunctionType, matchingParam.index);

                if (paramMap.has(paramName)) {
                    evaluator.addDiagnostic(
                        getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.paramAlreadyAssigned().format({ name: arg.name.value }),
                        arg.name
                    );

                    argumentErrors = true;
                } else {
                    const diag = new DiagnosticAddendum();

                    if (!evaluator.canAssignType(paramType, argTypeResult.type, diag, typeVarMap)) {
                        evaluator.addDiagnostic(
                            getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.argAssignmentParamFunction().format({
                                argType: evaluator.printType(argTypeResult.type),
                                paramType: evaluator.printType(paramType),
                                functionName: origFunctionType.details.name,
                                paramName,
                            }),
                            arg.valueExpression ?? errorNode
                        );

                        argumentErrors = true;
                    }
                    paramMap.set(paramName, true);
                }
            }
        }
    });

    const specializedFunctionType = applySolvedTypeVars(origFunctionType, typeVarMap);
    if (!isFunction(specializedFunctionType)) {
        return result;
    }

    // Create a new parameter list that omits parameters that have been
    // populated already.
    const updatedParamList: FunctionParameter[] = specializedFunctionType.details.parameters.map((param, index) => {
        const specializedParam: FunctionParameter = { ...param };
        specializedParam.type = FunctionType.getEffectiveParameterType(specializedFunctionType, index);

        // If it's a keyword parameter that has been assigned a value through
        // the "partial" mechanism, mark it has having a default value.
        if (param.name && paramMap.get(param.name)) {
            specializedParam.hasDefault = true;
        }
        return specializedParam;
    });
    const unassignedParamList = updatedParamList.filter((param) => {
        if (param.category === ParameterCategory.VarArgDictionary) {
            return false;
        }
        if (param.category === ParameterCategory.VarArgList) {
            return true;
        }
        return !param.name || !paramMap.has(param.name);
    });
    const assignedKeywordParamList = updatedParamList.filter((param) => {
        return param.name && paramMap.get(param.name);
    });
    const kwargsParam = updatedParamList.filter((param) => {
        return param.category === ParameterCategory.VarArgDictionary;
    });

    const newParamList = [...unassignedParamList, ...assignedKeywordParamList, ...kwargsParam];

    // Create a new __call__ method that uses the remaining parameters.
    const newCallMemberType = FunctionType.createInstance(
        callMemberType.details.name,
        callMemberType.details.fullName,
        callMemberType.details.moduleName,
        callMemberType.details.flags,
        specializedFunctionType.details.docString
    );

    if (callMemberType.details.parameters.length > 0) {
        FunctionType.addParameter(newCallMemberType, callMemberType.details.parameters[0]);
    }
    newParamList.forEach((param) => {
        FunctionType.addParameter(newCallMemberType, param);
    });

    newCallMemberType.details.declaredReturnType = specializedFunctionType.details.declaredReturnType
        ? FunctionType.getSpecializedReturnType(specializedFunctionType)
        : specializedFunctionType.inferredReturnType;
    newCallMemberType.details.declaration = callMemberType.details.declaration;
    newCallMemberType.details.typeVarScopeId = specializedFunctionType.details.typeVarScopeId;

    // Create a new copy of the functools.partial class that overrides the __call__ method.
    const newPartialClass = ClassType.cloneForSymbolTableUpdate(result.returnType);
    newPartialClass.details.fields.set('__call__', Symbol.createWithType(SymbolFlags.ClassMember, newCallMemberType));

    return {
        returnType: newPartialClass,
        isTypeIncomplete: false,
        argumentErrors,
    };
}
