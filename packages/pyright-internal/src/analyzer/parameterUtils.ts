/*
 * parameterUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Utility functions for parameters.
 */

import { assert } from '../common/debug';
import { ParamCategory } from '../parser/parseNodes';
import { isDunderName } from './symbolNameUtils';
import {
    AnyType,
    ClassType,
    FunctionParam,
    FunctionParamFlags,
    FunctionType,
    isAnyOrUnknown,
    isClassInstance,
    isNever,
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
    ExpandedArgs,
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

export interface ParamListDetailsOptions {
    // Should we disallow extra keyword arguments to be passed
    // if the function uses a **kwargs annotated with a (non-closed)
    // unpacked TypedDict? By default, this is allowed, but PEP 692
    // suggests that this should be disallowed for calls whereas it
    // explicitly says this is allowed for callable assignment rules.
    disallowExtraKwargsForTd?: boolean;
}

// Examines the input parameters within a function signature and creates a
// "virtual list" of parameters, stripping out any markers and expanding
// any *args with unpacked tuples.
export function getParamListDetails(type: FunctionType, options?: ParamListDetailsOptions): ParamListDetails {
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
                        ParamKind.ExpandedArgs
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
                    entry = paramType.priv.typedDictNarrowedEntries?.get(name) ?? entry;

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

                const extraItemsType = paramType.shared.typedDictEntries.extraItems?.valueType;

                let addKwargsForExtraItems: boolean;
                if (extraItemsType) {
                    addKwargsForExtraItems = !isNever(extraItemsType);
                } else {
                    addKwargsForExtraItems = !options?.disallowExtraKwargsForTd;
                }

                // Unless the TypedDict is completely closed (i.e. is not allowed to
                // have any extra items), add a virtual **kwargs parameter to represent
                // any additional items.
                if (addKwargsForExtraItems) {
                    addVirtualParam(
                        FunctionParam.create(
                            ParamCategory.KwargsDict,
                            extraItemsType ?? AnyType.create(),
                            FunctionParamFlags.TypeDeclared,
                            'kwargs'
                        ),
                        index,
                        extraItemsType
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

    result.firstPositionOrKeywordIndex = result.params.findIndex(
        (p) => p.kind !== ParamKind.Positional && p.kind !== ParamKind.ExpandedArgs
    );
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

export interface ParamAssignmentInfo {
    paramDetails: VirtualParamDetails;
    keywordName?: string;
    argsNeeded: number;
    argsReceived: number;
}

// A class that tracks which parameters in a signature
// have been assigned arguments.
export class ParamAssignmentTracker {
    params: ParamAssignmentInfo[];

    constructor(paramInfos: VirtualParamDetails[]) {
        this.params = paramInfos.map((p) => {
            const argsNeeded = !!p.defaultType || p.param.category !== ParamCategory.Simple ? 0 : 1;
            return { paramDetails: p, argsNeeded, argsReceived: 0 };
        });
    }

    // Add a virtual keyword parameter for a keyword argument that
    // targets a **kwargs parameter. This allows us to detect duplicate
    // keyword arguments.
    addKeywordParam(name: string, info: VirtualParamDetails): void {
        this.params.push({
            paramDetails: info,
            keywordName: name,
            argsNeeded: 1,
            argsReceived: 1,
        });
    }

    lookupName(name: string): ParamAssignmentInfo | undefined {
        return this.params.find((p) => {
            // Don't return positional parameters because their names are irrelevant.
            const kind = p.paramDetails.kind;
            if (kind === ParamKind.Positional || kind === ParamKind.ExpandedArgs) {
                return false;
            }

            const effectiveName = p.keywordName ?? p.paramDetails.param.name;
            return effectiveName === name;
        });
    }

    lookupDetails(paramInfo: VirtualParamDetails): ParamAssignmentInfo {
        const info = this.params.find((p) => p.paramDetails === paramInfo);
        assert(info !== undefined);
        return info;
    }

    markArgReceived(paramInfo: VirtualParamDetails) {
        const entry = this.lookupDetails(paramInfo);
        entry.argsReceived++;
    }

    // Returns a list of params that have not received their
    // required number of arguments.
    getUnassignedParams(): string[] {
        const unassignedParams: string[] = [];
        this.params.forEach((p) => {
            if (!p.paramDetails.param.name) {
                return;
            }

            if (p.argsReceived >= p.argsNeeded) {
                return;
            }

            unassignedParams.push(p.paramDetails.param.name);
        });

        return unassignedParams;
    }
}
