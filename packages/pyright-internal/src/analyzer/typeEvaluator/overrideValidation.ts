/*
 * overrideValidation.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * overrideValidation implementation, using evaluator-owned dependencies and state.
 */

import { DiagnosticAddendum } from '../../common/diagnostic';
import { LocAddendum } from '../../localization/localize';
import { ParamCategory } from '../../parser/parseNodes';
import { ConstraintTracker } from '../constraintTracker';
import { getParamListDetails, ParamKind } from '../parameterUtils';
import { isPrivateOrProtectedName } from '../symbolNameUtils';
import { AssignTypeFlags, SolveConstraintsOptions, TypeEvaluator } from '../typeEvaluatorTypes';
import {
    ClassType,
    FunctionParam,
    FunctionType,
    isAnyOrUnknown,
    isFunction,
    isFunctionOrOverloaded,
    isTypeVar,
    OverloadedType,
    Type,
} from '../types';
import { ApplyTypeVarOptions } from '../typeUtils';

interface Context {
    readonly assignType: TypeEvaluator['assignType'];
    readonly getEffectiveReturnType: (type: FunctionType) => Type;
    readonly printType: TypeEvaluator['printType'];
    readonly solveAndApplyConstraints: (
        type: Type,
        constraints: ConstraintTracker,
        applyOptions?: ApplyTypeVarOptions,
        solveOptions?: SolveConstraintsOptions
    ) => Type;
}

// Validates overrides and reports mismatches through evaluator compatibility and diagnostic callbacks.
export function createOverrideValidation(context: Context) {
    const { assignType, getEffectiveReturnType, printType, solveAndApplyConstraints } = context;

    function validateOverrideMethod(
        baseMethod: Type,
        overrideMethod: FunctionType | OverloadedType,
        baseClass: ClassType | undefined,
        diag: DiagnosticAddendum,
        enforceParamNames = true
    ): boolean {
        // If we're overriding a non-method with a method, report it as an error.
        // This occurs when a non-property overrides a property.
        if (!isFunctionOrOverloaded(baseMethod)) {
            diag.addMessage(LocAddendum.overrideType().format({ type: printType(baseMethod) }));
            return false;
        }

        if (isFunction(baseMethod)) {
            // Handle the easy case - a simple function overriding another simple function.
            if (isFunction(overrideMethod)) {
                return validateOverrideMethodInternal(baseMethod, overrideMethod, diag, enforceParamNames);
            }

            const overloadsAndImpl = [...OverloadedType.getOverloads(overrideMethod)];
            const impl = OverloadedType.getImplementation(overrideMethod);
            if (impl && isFunction(impl)) {
                overloadsAndImpl.push(impl);
            }

            // For an overload overriding a base method, at least one overload
            // or the implementation must be compatible with the base method.
            if (
                overloadsAndImpl.some((overrideOverload) => {
                    return validateOverrideMethodInternal(
                        baseMethod,
                        overrideOverload,
                        /* diag */ undefined,
                        enforceParamNames
                    );
                })
            ) {
                return true;
            }

            diag.addMessage(LocAddendum.overrideNoOverloadMatches());
            return false;
        }

        // For a non-overloaded method overriding an overloaded method, the
        // override must match all of the overloads.
        if (isFunction(overrideMethod)) {
            return OverloadedType.getOverloads(baseMethod).every((overload) => {
                // If the override isn't applicable for this base class, skip the check.
                if (baseClass && !isOverrideMethodApplicable(overload, baseClass)) {
                    return true;
                }

                return validateOverrideMethodInternal(
                    overload,
                    overrideMethod,
                    diag?.createAddendum(),
                    enforceParamNames
                );
            });
        }

        // For an overloaded method overriding an overloaded method, the overrides
        // must all match and be in the correct order. It is OK if the base method
        // has additional overloads that are not present in the override.

        let previousMatchIndex = -1;
        const baseOverloads = OverloadedType.getOverloads(baseMethod);

        for (const overrideOverload of OverloadedType.getOverloads(overrideMethod)) {
            let possibleMatchIndex: number | undefined;

            let matchIndex = baseOverloads.findIndex((baseOverload, index) => {
                // If the override isn't applicable for this base class, skip the check.
                if (baseClass && !isOverrideMethodApplicable(baseOverload, baseClass)) {
                    return false;
                }

                const isCompatible = validateOverrideMethodInternal(
                    baseOverload,
                    overrideOverload,
                    /* diag */ undefined,
                    enforceParamNames
                );

                // If the override is compatible but the match is one that is below the previous
                // matched index, keep looking for additional matches. Record the fact that
                // we found at least one match.
                if (isCompatible && index <= previousMatchIndex && possibleMatchIndex === undefined) {
                    possibleMatchIndex = index;
                    return false;
                }

                return isCompatible;
            });

            if (matchIndex < 0 && possibleMatchIndex !== undefined) {
                matchIndex = possibleMatchIndex;
            }

            if (matchIndex < 0) {
                break;
            }

            if (matchIndex < previousMatchIndex) {
                diag.addMessage(LocAddendum.overrideOverloadOrder());
                return false;
            }

            previousMatchIndex = matchIndex;
        }

        if (previousMatchIndex < baseOverloads.length - 1) {
            const unmatchedOverloads = baseOverloads.slice(previousMatchIndex + 1);

            // See if all of the remaining overrides are nonapplicable.
            if (
                !baseClass ||
                unmatchedOverloads.some((overload) => {
                    return isOverrideMethodApplicable(overload, baseClass);
                })
            ) {
                // We didn't find matches for all of the base overloads.
                diag.addMessage(LocAddendum.overrideOverloadNoMatch());
                return false;
            }
        }

        return true;
    }

    function isOverrideMethodApplicable(baseMethod: FunctionType, childClass: ClassType): boolean {
        if (
            !FunctionType.isInstanceMethod(baseMethod) &&
            !FunctionType.isClassMethod(baseMethod) &&
            !FunctionType.isConstructorMethod(baseMethod)
        ) {
            return true;
        }

        const baseParamDetails = getParamListDetails(baseMethod);
        if (baseParamDetails.params.length === 0) {
            return true;
        }

        const baseParamType = baseParamDetails.params[0].param;

        if (baseParamType.category !== ParamCategory.Simple || !FunctionParam.isTypeDeclared(baseParamType)) {
            return true;
        }

        // If this is a self or cls parameter, determine whether the override
        // class can be assigned to the base parameter type. If not, then this
        // override doesn't apply. This is important for overloads where the
        // base class contains some overload signatures that are not applicable
        // to the child class.
        const childSelfOrClsType = FunctionType.isInstanceMethod(baseMethod)
            ? ClassType.cloneAsInstance(childClass)
            : childClass;

        return assignType(
            baseParamDetails.params[0].type,
            childSelfOrClsType,
            /* diag */ undefined,
            /* constraints */ undefined,
            AssignTypeFlags.Default
        );
    }

    function validateOverrideMethodInternal(
        baseMethod: FunctionType,
        overrideMethod: FunctionType,
        diag: DiagnosticAddendum | undefined,
        enforceParamNames: boolean
    ): boolean {
        const baseParamDetails = getParamListDetails(baseMethod);
        const overrideParamDetails = getParamListDetails(overrideMethod);
        const constraints = new ConstraintTracker();

        let canOverride = true;

        if (!FunctionType.isGradualCallableForm(baseMethod) && !FunctionType.isGradualCallableForm(overrideMethod)) {
            // Verify that we're not overriding a static, class or instance method with
            // an incompatible type.
            if (FunctionType.isStaticMethod(baseMethod)) {
                if (!FunctionType.isStaticMethod(overrideMethod)) {
                    diag?.addMessage(LocAddendum.overrideNotStaticMethod());
                    canOverride = false;
                }
            } else if (FunctionType.isClassMethod(baseMethod)) {
                if (!FunctionType.isClassMethod(overrideMethod)) {
                    diag?.addMessage(LocAddendum.overrideNotClassMethod());
                    canOverride = false;
                }
            } else if (FunctionType.isInstanceMethod(baseMethod)) {
                if (!FunctionType.isInstanceMethod(overrideMethod)) {
                    diag?.addMessage(LocAddendum.overrideNotInstanceMethod());
                    canOverride = false;
                }
            }

            // Verify that the positional param count matches exactly or that the override
            // adds only params that preserve the original signature.
            let foundParamCountMismatch = false;
            if (overrideParamDetails.positionParamCount < baseParamDetails.positionParamCount) {
                if (overrideParamDetails.argsIndex === undefined) {
                    foundParamCountMismatch = true;
                } else {
                    const overrideArgsType = overrideParamDetails.params[overrideParamDetails.argsIndex].type;
                    for (
                        let i = overrideParamDetails.positionParamCount;
                        i < baseParamDetails.positionParamCount;
                        i++
                    ) {
                        if (
                            !assignType(
                                overrideArgsType,
                                baseParamDetails.params[i].type,
                                diag?.createAddendum(),
                                constraints,
                                AssignTypeFlags.Default
                            )
                        ) {
                            LocAddendum.overrideParamType().format({
                                index: i + 1,
                                baseType: printType(baseParamDetails.params[i].type),
                                overrideType: printType(overrideArgsType),
                            });
                            canOverride = false;
                        }
                    }
                }
            } else if (overrideParamDetails.positionParamCount > baseParamDetails.positionParamCount) {
                const isCallableAttrOverriddenByInstanceMethod =
                    baseParamDetails.positionParamCount === 0 &&
                    overrideParamDetails.positionParamCount === 1 &&
                    FunctionType.isInstanceMethod(overrideMethod) &&
                    !FunctionType.isStaticMethod(baseMethod) &&
                    !FunctionType.isClassMethod(baseMethod);

                if (!isCallableAttrOverriddenByInstanceMethod) {
                    // Verify that all of the override parameters that extend the
                    // signature are either *args, **kwargs or parameters with
                    // default values.

                    for (
                        let i = baseParamDetails.positionParamCount;
                        i < overrideParamDetails.positionParamCount;
                        i++
                    ) {
                        const overrideParam = overrideParamDetails.params[i].param;

                        if (
                            overrideParam.category === ParamCategory.Simple &&
                            overrideParam.name &&
                            !overrideParamDetails.params[i].defaultType
                        ) {
                            foundParamCountMismatch = true;
                        }
                    }
                }
            }

            if (foundParamCountMismatch) {
                diag?.addMessage(
                    LocAddendum.overridePositionalParamCount().format({
                        baseCount: baseParamDetails.params.length,
                        overrideCount: overrideParamDetails.params.length,
                    })
                );
                canOverride = false;
            }

            const positionalParamCount = Math.min(
                baseParamDetails.positionParamCount,
                overrideParamDetails.positionParamCount
            );

            for (let i = 0; i < positionalParamCount; i++) {
                // If the first parameter is a "self" or "cls" parameter, skip the
                // test because these are allowed to violate the Liskov substitution
                // principle.
                //
                // Note: the checker deliberately defeats this skip for the
                // "callable variable overridden by a method" case by marking both
                // sides static before calling this routine (see
                // `_getCallableVariableOverrideComparison` in checker.ts). Keep the
                // two in sync if this skip logic changes.
                if (i === 0) {
                    if (
                        FunctionType.isInstanceMethod(overrideMethod) ||
                        FunctionType.isClassMethod(overrideMethod) ||
                        FunctionType.isConstructorMethod(overrideMethod)
                    ) {
                        const baseParamType = baseParamDetails.params[i].type;
                        const overrideParamType = overrideParamDetails.params[i].type;

                        // A declared "self" or "cls" type in the base method must
                        // still accept the override's.
                        if (
                            !(isTypeVar(baseParamType) && baseParamType.shared.isSynthesized) &&
                            !assignType(
                                baseParamType,
                                overrideParamType,
                                diag?.createAddendum(),
                                /* constraints */ undefined,
                                AssignTypeFlags.Default
                            )
                        ) {
                            diag?.addMessage(
                                LocAddendum.overrideParamType().format({
                                    index: i + 1,
                                    baseType: printType(baseParamType),
                                    overrideType: printType(overrideParamType),
                                })
                            );
                            canOverride = false;
                        }

                        continue;
                    }
                }

                const baseParam = baseParamDetails.params[i].param;
                const overrideParam = overrideParamDetails.params[i].param;

                if (
                    i >= baseParamDetails.positionOnlyParamCount &&
                    !isPrivateOrProtectedName(baseParam.name || '') &&
                    baseParamDetails.params[i].kind !== ParamKind.Positional &&
                    baseParam.category === ParamCategory.Simple &&
                    enforceParamNames &&
                    baseParam.name !== overrideParam.name
                ) {
                    if (overrideParam.category === ParamCategory.Simple) {
                        if (!FunctionParam.isNameSynthesized(baseParam)) {
                            if (overrideParamDetails.params[i].kind === ParamKind.Positional) {
                                diag?.addMessage(
                                    LocAddendum.overrideParamNamePositionOnly().format({
                                        index: i + 1,
                                        baseName: baseParam.name || '*',
                                    })
                                );
                            } else {
                                diag?.addMessage(
                                    LocAddendum.overrideParamName().format({
                                        index: i + 1,
                                        baseName: baseParam.name || '*',
                                        overrideName: overrideParam.name || '*',
                                    })
                                );
                            }
                            canOverride = false;
                        }
                    }
                } else if (
                    i < overrideParamDetails.positionOnlyParamCount &&
                    i >= baseParamDetails.positionOnlyParamCount
                ) {
                    if (
                        !FunctionParam.isNameSynthesized(baseParam) &&
                        baseParamDetails.params[i].kind !== ParamKind.Positional &&
                        baseParamDetails.params[i].kind !== ParamKind.ExpandedArgs
                    ) {
                        diag?.addMessage(
                            LocAddendum.overrideParamNamePositionOnly().format({
                                index: i + 1,
                                baseName: baseParam.name || '*',
                            })
                        );
                        canOverride = false;
                    }
                } else {
                    const baseParamType = baseParamDetails.params[i].type;
                    const overrideParamType = overrideParamDetails.params[i].type;

                    const baseIsSynthesizedTypeVar = isTypeVar(baseParamType) && baseParamType.shared.isSynthesized;
                    const overrideIsSynthesizedTypeVar =
                        isTypeVar(overrideParamType) && overrideParamType.shared.isSynthesized;

                    if (!baseIsSynthesizedTypeVar && !overrideIsSynthesizedTypeVar) {
                        if (
                            baseParam.category !== overrideParam.category ||
                            !assignType(
                                overrideParamType,
                                baseParamType,
                                diag?.createAddendum(),
                                constraints,
                                AssignTypeFlags.Default
                            )
                        ) {
                            diag?.addMessage(
                                LocAddendum.overrideParamType().format({
                                    index: i + 1,
                                    baseType: printType(baseParamType),
                                    overrideType: printType(overrideParamType),
                                })
                            );
                            canOverride = false;
                        }
                    }

                    if (baseParamDetails.params[i].defaultType && !overrideParamDetails.params[i].defaultType) {
                        diag?.addMessage(
                            LocAddendum.overrideParamNoDefault().format({
                                index: i + 1,
                            })
                        );
                        canOverride = false;
                    }
                }
            }

            // Check for positional (named) parameters in the base method that
            // do not exist in the override.
            if (enforceParamNames && overrideParamDetails.kwargsIndex === undefined) {
                for (let i = positionalParamCount; i < baseParamDetails.positionParamCount; i++) {
                    const baseParam = baseParamDetails.params[i];

                    if (baseParam.kind === ParamKind.Standard && baseParam.param.category === ParamCategory.Simple) {
                        diag?.addMessage(
                            LocAddendum.overrideParamNamePositionOnly().format({
                                index: i + 1,
                                baseName: baseParam.param.name || '*',
                            })
                        );
                        canOverride = false;
                    }
                }
            }

            // Check for a *args match.
            if (baseParamDetails.argsIndex !== undefined) {
                if (overrideParamDetails.argsIndex === undefined) {
                    diag?.addMessage(
                        LocAddendum.overrideParamNameMissing().format({
                            name: baseParamDetails.params[baseParamDetails.argsIndex].param.name ?? '?',
                        })
                    );
                    canOverride = false;
                } else {
                    const overrideParamType = overrideParamDetails.params[overrideParamDetails.argsIndex].type;
                    const baseParamType = baseParamDetails.params[baseParamDetails.argsIndex].type;

                    if (
                        !assignType(
                            overrideParamType,
                            baseParamType,
                            diag?.createAddendum(),
                            constraints,
                            AssignTypeFlags.Default
                        )
                    ) {
                        diag?.addMessage(
                            LocAddendum.overrideParamKeywordType().format({
                                name: overrideParamDetails.params[overrideParamDetails.argsIndex].param.name ?? '?',
                                baseType: printType(baseParamType),
                                overrideType: printType(overrideParamType),
                            })
                        );
                        canOverride = false;
                    }
                }
            }

            // Now check any keyword-only parameters.
            const baseKwOnlyParams = baseParamDetails.params.filter(
                (paramInfo) => paramInfo.kind === ParamKind.Keyword && paramInfo.param.category === ParamCategory.Simple
            );
            const overrideKwOnlyParams = overrideParamDetails.params.filter(
                (paramInfo) => paramInfo.kind === ParamKind.Keyword && paramInfo.param.category === ParamCategory.Simple
            );

            baseKwOnlyParams.forEach((paramInfo) => {
                const overrideParamInfo = overrideKwOnlyParams.find((pi) => paramInfo.param.name === pi.param.name);

                if (!overrideParamInfo && overrideParamDetails.kwargsIndex === undefined) {
                    diag?.addMessage(
                        LocAddendum.overrideParamNameMissing().format({
                            name: paramInfo.param.name ?? '?',
                        })
                    );
                    canOverride = false;
                } else {
                    let targetParamType = overrideParamInfo?.type;
                    if (!targetParamType) {
                        targetParamType = overrideParamDetails.params[overrideParamDetails.kwargsIndex!].type;
                    }

                    if (
                        !assignType(
                            targetParamType,
                            paramInfo.type,
                            diag?.createAddendum(),
                            constraints,
                            AssignTypeFlags.Default
                        )
                    ) {
                        diag?.addMessage(
                            LocAddendum.overrideParamKeywordType().format({
                                name: paramInfo.param.name ?? '?',
                                baseType: printType(paramInfo.type),
                                overrideType: printType(targetParamType),
                            })
                        );
                        canOverride = false;
                    }

                    if (overrideParamInfo) {
                        if (paramInfo.defaultType && !overrideParamInfo.defaultType) {
                            diag?.addMessage(
                                LocAddendum.overrideParamKeywordNoDefault().format({
                                    name: overrideParamInfo.param.name ?? '?',
                                })
                            );
                            canOverride = false;
                        }
                    }
                }
            });

            // Verify that any keyword-only parameters added by the overload are compatible
            // with the **kwargs in the base.
            overrideKwOnlyParams.forEach((paramInfo) => {
                const baseParamInfo = baseKwOnlyParams.find((pi) => paramInfo.param.name === pi.param.name);

                if (!baseParamInfo) {
                    if (baseParamDetails.kwargsIndex === undefined) {
                        if (!paramInfo.defaultType) {
                            diag?.addMessage(
                                LocAddendum.overrideParamNameExtra().format({
                                    name: paramInfo.param.name ?? '?',
                                })
                            );
                            canOverride = false;
                        }
                    } else {
                        // Base has a **kwargs; ensure the added keyword-only parameter's
                        // type is compatible with the base's **kwargs value type.
                        const baseKwargsType = baseParamDetails.params[baseParamDetails.kwargsIndex].type;
                        if (
                            !assignType(
                                paramInfo.type,
                                baseKwargsType,
                                diag?.createAddendum(),
                                constraints,
                                AssignTypeFlags.Default
                            )
                        ) {
                            diag?.addMessage(
                                LocAddendum.overrideParamKeywordType().format({
                                    name: paramInfo.param.name ?? '?',
                                    baseType: printType(baseKwargsType),
                                    overrideType: printType(paramInfo.type),
                                })
                            );
                            canOverride = false;
                        }
                    }
                }
            });

            // Verify that if the base method has a **kwargs parameter, the override does too.
            if (baseParamDetails.kwargsIndex !== undefined && overrideParamDetails.kwargsIndex === undefined) {
                diag?.addMessage(
                    LocAddendum.kwargsParamMissing().format({
                        paramName: baseParamDetails.params[baseParamDetails.kwargsIndex].param.name!,
                    })
                );
                canOverride = false;
            }
        }

        // Verify that one or the other method doesn't contain a ParamSpec.
        if (baseParamDetails.paramSpec && !overrideParamDetails.paramSpec) {
            // If the override uses an `*args: Any, **kwargs: Any` signature, we
            // will allow this as an acceptable overload for a `*args: P.args, **kwargs: P.kwargs`.
            const overrideHasArgsKwargs =
                overrideParamDetails.argsIndex !== undefined &&
                isAnyOrUnknown(overrideParamDetails.params[overrideParamDetails.argsIndex].type) &&
                overrideParamDetails.kwargsIndex !== undefined &&
                isAnyOrUnknown(overrideParamDetails.params[overrideParamDetails.kwargsIndex].type);

            if (!overrideHasArgsKwargs) {
                diag?.addMessage(LocAddendum.paramSpecMissingInOverride());
                canOverride = false;
            }
        }

        // Now check the return type.
        const baseReturnType = getEffectiveReturnType(baseMethod);
        const overrideReturnType = solveAndApplyConstraints(getEffectiveReturnType(overrideMethod), constraints);

        if (
            !assignType(
                baseReturnType,
                overrideReturnType,
                diag?.createAddendum(),
                constraints,
                AssignTypeFlags.Default
            )
        ) {
            diag?.addMessage(
                LocAddendum.overrideReturnType().format({
                    baseType: printType(baseReturnType),
                    overrideType: printType(overrideReturnType),
                })
            );

            canOverride = false;
        }

        return canOverride;
    }

    return {
        validateOverrideMethod,
    };
}
