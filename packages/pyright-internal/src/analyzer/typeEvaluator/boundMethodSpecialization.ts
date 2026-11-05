/*
 * boundMethodSpecialization.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * boundMethodSpecialization implementation, using evaluator-owned dependencies and state.
 */

import { DiagnosticAddendum } from '../../common/diagnostic';
import { LocMessage } from '../../localization/localize';
import { ConstraintTracker } from '../constraintTracker';
import { AssignTypeFlags, PrintTypeOptions, SolveConstraintsOptions } from '../typeEvaluatorTypes';
import {
    ClassType,
    FunctionParam,
    FunctionType,
    isClassInstance,
    isFunction,
    isFunctionOrOverloaded,
    isOverloaded,
    isTypeVar,
    OverloadedType,
    Type,
    TypeBase,
    TypeVarType,
} from '../types';
import { ApplyTypeVarOptions, convertToInstance } from '../typeUtils';

interface Context {
    readonly assignType: (
        destType: Type,
        srcType: Type,
        diag?: DiagnosticAddendum,
        constraints?: ConstraintTracker,
        flags?: AssignTypeFlags,
        recursionCount?: number
    ) => boolean;
    readonly getEffectiveReturnType: (type: FunctionType) => Type;
    readonly printType: (type: Type, options?: PrintTypeOptions) => string;
    readonly solveAndApplyConstraints: (
        type: Type,
        constraints: ConstraintTracker,
        applyOptions?: ApplyTypeVarOptions,
        solveOptions?: SolveConstraintsOptions
    ) => Type;
}

export function createBoundMethodSpecialization(context: Context) {
    const { assignType, getEffectiveReturnType, printType, solveAndApplyConstraints } = context;

    function partiallySpecializeBoundMethod(
        baseType: ClassType,
        memberType: FunctionType,
        diag: DiagnosticAddendum | undefined,
        recursionCount: number,
        firstParamType: ClassType | TypeVarType | undefined,
        stripFirstParam = true
    ): FunctionType | undefined {
        const constraints = new ConstraintTracker();

        if (firstParamType) {
            if (memberType.shared.parameters.length > 0) {
                const memberTypeFirstParam = memberType.shared.parameters[0];
                const memberTypeFirstParamType = FunctionType.getParamType(memberType, 0);

                if (
                    isTypeVar(memberTypeFirstParamType) &&
                    memberTypeFirstParamType.shared.boundType &&
                    isClassInstance(memberTypeFirstParamType.shared.boundType) &&
                    ClassType.isProtocolClass(memberTypeFirstParamType.shared.boundType)
                ) {
                    // Handle the protocol class specially. Some protocol classes
                    // contain references to themselves or their subclasses, so if
                    // we attempt to call assignType, we'll risk infinite recursion.
                    // Instead, we'll assume it's assignable.
                    constraints.setBounds(
                        memberTypeFirstParamType,
                        TypeBase.isInstantiable(memberTypeFirstParamType)
                            ? convertToInstance(firstParamType)
                            : firstParamType
                    );
                } else {
                    const subDiag = diag?.createAddendum();

                    // Protect against the case where a callback protocol is being
                    // bound to its own __call__ method but the first parameter
                    // is annotated with its own callable type. This can lead to
                    // infinite recursion.
                    if (isFunctionOrOverloaded(memberTypeFirstParamType)) {
                        if (isClassInstance(firstParamType) && ClassType.isProtocolClass(firstParamType)) {
                            if (subDiag) {
                                subDiag.addMessage(
                                    LocMessage.bindTypeMismatch().format({
                                        type: printType(firstParamType),
                                        methodName: memberType.shared.name || '<anonymous>',
                                        paramName: memberTypeFirstParam.name || '__p0',
                                    })
                                );
                            }
                            return undefined;
                        }
                    }

                    if (
                        !assignType(
                            memberTypeFirstParamType,
                            firstParamType,
                            subDiag?.createAddendum(),
                            constraints,
                            AssignTypeFlags.AllowUnspecifiedTypeArgs,
                            recursionCount
                        )
                    ) {
                        if (
                            memberTypeFirstParam.name &&
                            !FunctionParam.isNameSynthesized(memberTypeFirstParam) &&
                            FunctionParam.isTypeDeclared(memberTypeFirstParam)
                        ) {
                            if (subDiag) {
                                subDiag.addMessage(
                                    LocMessage.bindTypeMismatch().format({
                                        type: printType(firstParamType),
                                        methodName: memberType.shared.name || '<anonymous>',
                                        paramName: memberTypeFirstParam.name,
                                    })
                                );
                            }
                            return undefined;
                        }
                    }
                }
            } else {
                const subDiag = diag?.createAddendum();
                if (subDiag) {
                    subDiag.addMessage(
                        LocMessage.bindParamMissing().format({
                            methodName: memberType.shared.name || '<anonymous>',
                        })
                    );
                }
                return undefined;
            }
        }

        // Get the effective return type, which will have the side effect of lazily
        // evaluating (and caching) the inferred return type if there is no defined return type.
        getEffectiveReturnType(memberType);

        const specializedFunction = solveAndApplyConstraints(memberType, constraints);
        if (isFunction(specializedFunction)) {
            return FunctionType.clone(specializedFunction, stripFirstParam, baseType);
        }

        if (isOverloaded(specializedFunction)) {
            // For overloaded functions, use the first overload. This isn't
            // strictly correct, but this is an extreme edge case.
            return FunctionType.clone(OverloadedType.getOverloads(specializedFunction)[0], stripFirstParam, baseType);
        }

        return undefined;
    }

    return { partiallySpecializeBoundMethod };
}
