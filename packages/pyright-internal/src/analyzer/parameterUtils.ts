/*
 * parameterUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Utility functions for parameters.
 */

import { ParamCategory } from '../parser/parseNodes';
import { isDunderName } from './symbolNameUtils';
import {
    ClassType,
    FunctionParam,
    FunctionParamFlags,
    FunctionType,
    isAnyOrUnknown,
    isClassInstance,
    isParamSpec,
    isPositionOnlySeparator,
    isTypeSame,
    isTypeVarTuple,
    isUnpackedClass,
    Type,
    TypeVarType,
} from './types';
import { doForEachSubtype, partiallySpecializeType } from './typeUtils';

export function isTypedKwargs(param: FunctionParam, effectiveParamType: Type): boolean {
    return (
        param.category === ParamCategory.KwargsDict &&
        isClassInstance(effectiveParamType) &&
        isUnpackedClass(effectiveParamType) &&
        ClassType.isTypedDictClass(effectiveParamType) &&
        !!effectiveParamType.shared.typedDictEntries
    );
}

export enum ParamKind {
    Positional,
    Standard,
    Keyword,
}

export interface VirtualParamDetails {
    param: FunctionParam;
    type: Type;
    declaredType: Type;
    defaultType?: Type | undefined;
    index: number;
    kind: ParamKind;
}

export interface ParamListDetails {
    // Virtual parameter list that refers to original parameters
    params: VirtualParamDetails[];

    // Counts of virtual parameters
    positionOnlyParamCount: number;
    positionParamCount: number;

    // Indexes into virtual parameter list
    kwargsIndex?: number;
    argsIndex?: number;
    firstKeywordOnlyIndex?: number;
    firstPositionOrKeywordIndex: number;

    // Other information
    hasUnpackedTypeVarTuple: boolean;
    hasUnpackedTypedDict: boolean;
    unpackedKwargsTypedDictType?: ClassType;
    paramSpec?: TypeVarType;
}

// Examines the input parameters within a function signature and creates a
// "virtual list" of parameters, stripping out any markers and expanding
// any *args with unpacked tuples.
export function getParamListDetails(type: FunctionType): ParamListDetails {
    const result: ParamListDetails = {
        firstPositionOrKeywordIndex: 0,
        positionParamCount: 0,
        positionOnlyParamCount: 0,
        params: [],
        hasUnpackedTypeVarTuple: false,
        hasUnpackedTypedDict: false,
    };

    let positionOnlyIndex = type.shared.parameters.findIndex((p) => isPositionOnlySeparator(p));

    // Handle the old (pre Python 3.8) way of specifying positional-only
    // parameters by naming them with "__".
    if (positionOnlyIndex < 0) {
        for (let i = 0; i < type.shared.parameters.length; i++) {
            const p = type.shared.parameters[i];
            if (p.category !== ParamCategory.Simple) {
                break;
            }

            if (!p.name) {
                break;
            }

            if (isDunderName(p.name) || !p.name.startsWith('__')) {
                // We exempt "self" and "cls" in class and instance methods.
                if (i > 0 || FunctionType.isStaticMethod(type)) {
                    break;
                }

                continue;
            }

            positionOnlyIndex = i + 1;
        }
    }

    for (let i = 0; i < positionOnlyIndex; i++) {
        if (FunctionType.getParamDefaultType(type, i)) {
            break;
        }

        result.positionOnlyParamCount++;
    }

    let sawKeywordOnlySeparator = false;

    const addVirtualParam = (
        param: FunctionParam,
        index: number,
        typeOverride?: Type,
        defaultTypeOverride?: Type,
        sourceOverride?: ParamKind
    ) => {
        if (param.name) {
            let kind: ParamKind;
            if (sourceOverride !== undefined) {
                kind = sourceOverride;
            } else if (param.category === ParamCategory.ArgsList) {
                kind = ParamKind.Positional;
            } else if (sawKeywordOnlySeparator) {
                kind = ParamKind.Keyword;
            } else if (positionOnlyIndex >= 0 && index < positionOnlyIndex) {
                kind = ParamKind.Positional;
            } else {
                kind = ParamKind.Standard;
            }

            result.params.push({
                param,
                index,
                type: typeOverride ?? FunctionType.getParamType(type, index),
                declaredType: FunctionType.getDeclaredParamType(type, index),
                defaultType: defaultTypeOverride ?? FunctionType.getParamDefaultType(type, index),
                kind,
            });
        }
    };

    type.shared.parameters.forEach((param, index) => {
        if (param.category === ParamCategory.ArgsList) {
            // If this is an unpacked tuple, expand the entries.
            const paramType = FunctionType.getParamType(type, index);
            if (param.name && isUnpackedClass(paramType) && paramType.priv.tupleTypeArgs) {
                const addToPositionalOnly = index < result.positionOnlyParamCount;

                paramType.priv.tupleTypeArgs.forEach((tupleArg, tupleIndex) => {
                    const category =
                        isTypeVarTuple(tupleArg.type) || tupleArg.isUnbounded
                            ? ParamCategory.ArgsList
                            : ParamCategory.Simple;

                    if (category === ParamCategory.ArgsList) {
                        result.argsIndex = result.params.length;
                    }

                    if (isTypeVarTuple(FunctionType.getParamType(type, index))) {
                        result.hasUnpackedTypeVarTuple = true;
                    }

                    addVirtualParam(
                        FunctionParam.create(
                            category,
                            tupleArg.type,
                            FunctionParamFlags.NameSynthesized | FunctionParamFlags.TypeDeclared,
                            `${param.name}[${tupleIndex.toString()}]`
                        ),
                        index,
                        tupleArg.type,
                        /* defaultArgTypeOverride */ undefined,
                        ParamKind.Positional
                    );

                    if (category === ParamCategory.Simple) {
                        result.positionParamCount++;
                    }

                    if (tupleIndex > 0 && addToPositionalOnly) {
                        result.positionOnlyParamCount++;
                    }
                });

                // Normally, a VarArgList parameter (either named or as an unnamed separator)
                // would signify the start of keyword-only parameters. However, we can construct
                // callable signatures that defy this rule by using Callable and TypeVarTuples
                // or unpacked tuples.
                if (!sawKeywordOnlySeparator && (positionOnlyIndex < 0 || index >= positionOnlyIndex)) {
                    result.firstKeywordOnlyIndex = result.params.length;
                    sawKeywordOnlySeparator = true;
                }
            } else {
                if (param.name && result.argsIndex === undefined) {
                    result.argsIndex = result.params.length;

                    if (isTypeVarTuple(paramType)) {
                        result.hasUnpackedTypeVarTuple = true;
                    }
                }

                // Normally, a VarArgList parameter (either named or as an unnamed separator)
                // would signify the start of keyword-only parameters. However, we can construct
                // callable signatures that defy this rule by using Callable and TypeVarTuples
                // or unpacked tuples.
                if (!sawKeywordOnlySeparator && (positionOnlyIndex < 0 || index >= positionOnlyIndex)) {
                    result.firstKeywordOnlyIndex = result.params.length;
                    if (param.name) {
                        result.firstKeywordOnlyIndex++;
                    }
                    sawKeywordOnlySeparator = true;
                }

                addVirtualParam(param, index);
            }
        } else if (param.category === ParamCategory.KwargsDict) {
            sawKeywordOnlySeparator = true;

            const paramType = FunctionType.getParamType(type, index);

            // Is this an unpacked TypedDict? If so, expand the entries.
            if (isClassInstance(paramType) && isUnpackedClass(paramType) && paramType.shared.typedDictEntries) {
                if (result.firstKeywordOnlyIndex === undefined) {
                    result.firstKeywordOnlyIndex = result.params.length;
                }

                const typedDictType = paramType;
                paramType.shared.typedDictEntries.knownItems.forEach((entry, name) => {
                    const specializedParamType = partiallySpecializeType(
                        entry.valueType,
                        typedDictType,
                        /* typeClassType */ undefined
                    );

                    const defaultParamType = !entry.isRequired ? specializedParamType : undefined;
                    addVirtualParam(
                        FunctionParam.create(
                            ParamCategory.Simple,
                            specializedParamType,
                            FunctionParamFlags.TypeDeclared,
                            name,
                            defaultParamType
                        ),
                        index,
                        specializedParamType,
                        defaultParamType
                    );
                });

                if (paramType.shared.typedDictEntries.extraItems) {
                    addVirtualParam(
                        FunctionParam.create(
                            ParamCategory.KwargsDict,
                            paramType.shared.typedDictEntries.extraItems.valueType,
                            FunctionParamFlags.TypeDeclared,
                            'kwargs'
                        ),
                        index,
                        paramType.shared.typedDictEntries.extraItems.valueType
                    );

                    result.kwargsIndex = result.params.length - 1;
                }

                result.hasUnpackedTypedDict = true;
                result.unpackedKwargsTypedDictType = paramType;
            } else if (param.name) {
                if (result.kwargsIndex === undefined) {
                    result.kwargsIndex = result.params.length;
                }

                if (result.firstKeywordOnlyIndex === undefined) {
                    result.firstKeywordOnlyIndex = result.params.length;
                }

                addVirtualParam(param, index);
            }
        } else if (param.category === ParamCategory.Simple) {
            if (param.name && !sawKeywordOnlySeparator) {
                result.positionParamCount++;
            }

            addVirtualParam(
                param,
                index,
                /* typeOverride */ undefined,
                type.priv.specializedTypes?.parameterDefaultTypes
                    ? type.priv.specializedTypes?.parameterDefaultTypes[index]
                    : undefined
            );
        }
    });

    // If the signature ends in `*args: P.args, **kwargs: P.kwargs`,
    // extract the ParamSpec P.
    result.paramSpec = FunctionType.getParamSpecFromArgsKwargs(type);

    result.firstPositionOrKeywordIndex = result.params.findIndex((p) => p.kind !== ParamKind.Positional);
    if (result.firstPositionOrKeywordIndex < 0) {
        result.firstPositionOrKeywordIndex = result.params.length;
    }

    return result;
}

// Returns true if the type of the argument type is "*args: P.args" or
// "*args: Any". Both of these match a parameter of type "*args: P.args".
export function isParamSpecArgs(paramSpec: TypeVarType, argType: Type) {
    let isCompatible = true;

    doForEachSubtype(argType, (argSubtype) => {
        if (
            isParamSpec(argSubtype) &&
            argSubtype.priv.paramSpecAccess === 'args' &&
            isTypeSame(argSubtype, paramSpec, { ignoreTypeFlags: true })
        ) {
            return;
        }

        if (
            isClassInstance(argSubtype) &&
            argSubtype.priv.tupleTypeArgs &&
            argSubtype.priv.tupleTypeArgs.length === 1 &&
            argSubtype.priv.tupleTypeArgs[0].isUnbounded &&
            isAnyOrUnknown(argSubtype.priv.tupleTypeArgs[0].type)
        ) {
            return;
        }

        if (isAnyOrUnknown(argSubtype)) {
            return;
        }

        isCompatible = false;
    });

    return isCompatible;
}

// Returns true if the type of the argument type is "**kwargs: P.kwargs" or
// "*kwargs: Any". Both of these match a parameter of type "*kwargs: P.kwargs".
export function isParamSpecKwargs(paramSpec: TypeVarType, argType: Type) {
    let isCompatible = true;

    doForEachSubtype(argType, (argSubtype) => {
        if (
            isParamSpec(argSubtype) &&
            argSubtype.priv.paramSpecAccess === 'kwargs' &&
            isTypeSame(argSubtype, paramSpec, { ignoreTypeFlags: true })
        ) {
            return;
        }

        if (
            isClassInstance(argSubtype) &&
            ClassType.isBuiltIn(argSubtype, 'dict') &&
            argSubtype.priv.typeArgs &&
            argSubtype.priv.typeArgs.length === 2 &&
            isClassInstance(argSubtype.priv.typeArgs[0]) &&
            ClassType.isBuiltIn(argSubtype.priv.typeArgs[0], 'str') &&
            isAnyOrUnknown(argSubtype.priv.typeArgs[1])
        ) {
            return;
        }

        if (isAnyOrUnknown(argSubtype)) {
            return;
        }

        isCompatible = false;
    });

    return isCompatible;
}
