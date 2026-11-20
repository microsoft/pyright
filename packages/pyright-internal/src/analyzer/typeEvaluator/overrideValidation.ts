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
    isUnion,
    OverloadedType,
    Type,
    TypeVarType,
} from '../types';
import { ApplyTypeVarOptions, getTypeVarScopeIds, mapSubtypes } from '../typeUtils';

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
        enforceParamNames = true,
        baseClassSelf?: ClassType,
        childClassSelf?: ClassType
    ): boolean {
        // If we're overriding a non-method with a method, report it as an error.
        // This occurs when a non-property overrides a property.
        if (!isFunctionOrOverloaded(baseMethod)) {
            diag.addMessage(LocAddendum.overrideType().format({ type: printType(baseMethod) }));
            return false;
        }

        if (isFunction(baseMethod)) {
            const specializedBaseMethod = partiallySpecializeOverrideMethod(baseMethod, baseClassSelf);

            // Handle the easy case - a simple function overriding another simple function.
            if (isFunction(overrideMethod)) {
                return validateOverrideMethodInternal(
                    specializedBaseMethod,
                    partiallySpecializeOverrideMethod(overrideMethod, childClassSelf),
                    diag,
                    enforceParamNames
                );
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
                        specializedBaseMethod,
                        partiallySpecializeOverrideMethod(overrideOverload, childClassSelf),
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
            const specializedOverrideMethod = partiallySpecializeOverrideMethod(overrideMethod, childClassSelf);

            return OverloadedType.getOverloads(baseMethod).every((overload) => {
                // If the override isn't applicable for this base class, skip the check.
                if (baseClass && !isOverrideMethodApplicable(overload, baseClass)) {
                    return true;
                }

                return validateOverrideMethodInternal(
                    partiallySpecializeOverrideMethod(overload, baseClassSelf),
                    specializedOverrideMethod,
                    diag?.createAddendum(),
                    enforceParamNames
                );
            });
        }

        // For an overloaded method overriding an overloaded method, each base
        // overload must be matched by an override overload, and the matches must
        // be in the same order. It is OK if the override has additional overloads
        // that are not present in the base method.

        let previousMatchIndex = -1;
        const overrideOverloads = OverloadedType.getOverloads(overrideMethod).map((overrideOverload) => {
            return partiallySpecializeOverrideMethod(overrideOverload, childClassSelf);
        });

        for (let baseOverload of OverloadedType.getOverloads(baseMethod)) {
            // If the override isn't applicable for this base class, skip the check.
            if (baseClass && !isOverrideMethodApplicable(baseOverload, baseClass)) {
                continue;
            }

            baseOverload = partiallySpecializeOverrideMethod(baseOverload, baseClassSelf);

            const isCompatible = (overrideOverload: FunctionType) => {
                return validateOverrideMethodInternal(
                    baseOverload,
                    overrideOverload,
                    /* diag */ undefined,
                    enforceParamNames
                );
            };

            const matchIndex = overrideOverloads.findIndex((overrideOverload, index) => {
                return index >= previousMatchIndex && isCompatible(overrideOverload);
            });

            if (matchIndex < 0) {
                if (overrideOverloads.some((overrideOverload) => isCompatible(overrideOverload))) {
                    diag.addMessage(LocAddendum.overrideOverloadOrder());
                } else {
                    diag.addMessage(LocAddendum.overrideOverloadNoMatch());
                }
                return false;
            }

            // An additional overload ahead of the match must not overlap the
            // base overload and return an incompatible type.
            const isOverlapping = overrideOverloads.some((overrideOverload, index) => {
                return index < matchIndex && isOverrideMethodOverlapping(baseOverload, overrideOverload);
            });

            if (isOverlapping) {
                diag.addMessage(LocAddendum.overrideOverloadNoMatch());
                return false;
            }

            previousMatchIndex = matchIndex;
        }

        return true;
    }

    function isOverrideMethodOverlapping(baseOverload: FunctionType, overrideOverload: FunctionType): boolean {
        if (
            FunctionType.isInstanceMethod(overrideOverload) ||
            FunctionType.isClassMethod(overrideOverload) ||
            FunctionType.isConstructorMethod(overrideOverload)
        ) {
            baseOverload = FunctionType.clone(baseOverload, /* stripFirstParam */ true);
            overrideOverload = FunctionType.clone(overrideOverload, /* stripFirstParam */ true);
        }

        const flags = AssignTypeFlags.SkipReturnTypeCheck;
        const partialOverlapFlags =
            flags |
            AssignTypeFlags.OverloadOverlap |
            AssignTypeFlags.PartialOverloadOverlap |
            AssignTypeFlags.IncludeOverlapByOmission;

        const checks: [FunctionType, FunctionType, AssignTypeFlags][] = [
            [baseOverload, overrideOverload, flags],
            [overrideOverload, baseOverload, flags],
            [overrideOverload, baseOverload, partialOverlapFlags],
        ];

        // Compare the return types with the TypeVars solved by the
        // parameters the two overloads share.
        return checks.some(([destType, srcType, checkFlags]) => {
            const constraints = new ConstraintTracker();
            if (!assignType(destType, srcType, /* diag */ undefined, constraints, checkFlags)) {
                return false;
            }

            return !assignType(
                solveAndApplyConstraints(getEffectiveReturnType(baseOverload), constraints),
                solveAndApplyConstraints(getEffectiveReturnType(overrideOverload), constraints)
            );
        });
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

    // Solves the TypeVars in an annotated "self" or "cls" parameter against
    // the class that "self" refers to, as is done when the method is bound.
    function partiallySpecializeOverrideMethod(method: FunctionType, selfClass: ClassType | undefined): FunctionType {
        if (
            !selfClass ||
            method.shared.parameters.length === 0 ||
            !FunctionParam.isTypeDeclared(method.shared.parameters[0]) ||
            !(
                FunctionType.isInstanceMethod(method) ||
                FunctionType.isClassMethod(method) ||
                FunctionType.isConstructorMethod(method)
            )
        ) {
            return method;
        }

        const constraints = new ConstraintTracker();
        const selfType = FunctionType.isInstanceMethod(method) ? selfClass : ClassType.cloneAsInstantiable(selfClass);

        if (!assignType(FunctionType.getParamType(method, 0), selfType, /* diag */ undefined, constraints)) {
            return method;
        }

        const specializedFunction = solveAndApplyConstraints(method, constraints);
        return isFunction(specializedFunction) ? specializedFunction : method;
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
        let overrideReturnType = solveAndApplyConstraints(getEffectiveReturnType(overrideMethod), constraints);

        // Replace unsolved TypeVars of the override in a union with their
        // default, or eliminate them if they have no default, as is done for
        // call return types.
        const overrideScopeIds = getTypeVarScopeIds(overrideMethod);
        const isUnsolvedTypeVar = (subtype: Type): subtype is TypeVarType => {
            return isTypeVar(subtype) && !!subtype.priv.scopeId && overrideScopeIds.includes(subtype.priv.scopeId);
        };
        if (
            isUnion(overrideReturnType) &&
            !overrideReturnType.priv.subtypes.every((subtype) => {
                return isUnsolvedTypeVar(subtype) && !subtype.shared.isDefaultExplicit;
            })
        ) {
            overrideReturnType = mapSubtypes(overrideReturnType, (subtype) => {
                if (isUnsolvedTypeVar(subtype)) {
                    return subtype.shared.isDefaultExplicit
                        ? solveAndApplyConstraints(subtype.shared.defaultType, constraints)
                        : undefined;
                }
                return subtype;
            });
        }

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
