/*
 * evaluatorNarrowing.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * evaluatorNarrowing implementation, using evaluator-owned dependencies and state.
 */

import { getTypedDictMembersForClass } from '../typedDicts';
import { TypeEvaluator, TypeResult } from '../typeEvaluatorTypes';
import {
    ClassType,
    combineTypes,
    EnumLiteral,
    findSubtype,
    getInferredTupleLiteralBase,
    isClass,
    isClassInstance,
    isFunction,
    isFunctionOrOverloaded,
    isNever,
    isTypeSame,
    isUnion,
    isUnknown,
    maxTypeRecursionCount,
    preserveInferredTupleLiterals,
    SentinelLiteral,
    Type,
    TypeBase,
    TypeCategory,
    TypeCondition,
    UnionType,
} from '../types';
import {
    ClassMember,
    isIncompleteUnknown,
    isLiteralType,
    isNoneInstance,
    isSentinelLiteral,
    isTupleClass,
    isUnboundedTupleClass,
    lookUpObjectMember,
    mapSubtypes,
} from '../typeUtils';

interface Context {
    readonly assignType: TypeEvaluator['assignType'];
    readonly evaluatorInterface: TypeEvaluator;
    readonly getTypeOfMember: (member: ClassMember) => Type;
    readonly makeTopLevelTypeVarsConcrete: (
        type: Type,
        makeParamSpecsConcrete?: boolean,
        conditionFilter?: TypeCondition[]
    ) => Type;
}

// Applies truthiness and assignment narrowing; conditional/type-guard dispatch is a separate layer.
export function createEvaluatorNarrowing(context: Context) {
    const { assignType, evaluatorInterface, getTypeOfMember, makeTopLevelTypeVarsConcrete } = context;

    function canBeFalsy(type: Type, recursionCount = 0): boolean {
        type = makeTopLevelTypeVarsConcrete(type);

        if (recursionCount > maxTypeRecursionCount) {
            return true;
        }
        recursionCount++;

        switch (type.category) {
            case TypeCategory.OverloadResult:
                return true;

            case TypeCategory.Unbound:
            case TypeCategory.Unknown:
            case TypeCategory.Any:
            case TypeCategory.Never: {
                return true;
            }

            case TypeCategory.Union: {
                return findSubtype(type, (subtype) => canBeFalsy(subtype, recursionCount)) !== undefined;
            }

            case TypeCategory.Function:
            case TypeCategory.Overloaded:
            case TypeCategory.Module:
            case TypeCategory.TypeVar: {
                return false;
            }

            case TypeCategory.Class: {
                if (TypeBase.isInstantiable(type)) {
                    return false;
                }

                // Sentinels are always truthy.
                if (isSentinelLiteral(type)) {
                    return false;
                }

                // Handle tuples specially.
                if (isTupleClass(type) && type.priv.tupleTypeArgs) {
                    return isUnboundedTupleClass(type) || type.priv.tupleTypeArgs.length === 0;
                }

                // Handle subclasses of tuple, such as NamedTuple.
                const tupleBaseClass = type.shared.mro.find((mroClass) => !isClass(mroClass) || isTupleClass(mroClass));
                if (tupleBaseClass && isClass(tupleBaseClass) && tupleBaseClass.priv.tupleTypeArgs) {
                    return isUnboundedTupleClass(tupleBaseClass) || tupleBaseClass.priv.tupleTypeArgs.length === 0;
                }

                // Handle TypedDicts specially. If one or more entries are required
                // or known to exist, we can say for sure that the type is not falsy.
                if (ClassType.isTypedDictClass(type)) {
                    const tdEntries = getTypedDictMembersForClass(evaluatorInterface, type, /* allowNarrowed */ true);
                    if (tdEntries) {
                        for (const tdEntry of tdEntries.knownItems.values()) {
                            if (tdEntry.isRequired || tdEntry.isProvided) {
                                return false;
                            }
                        }
                    }
                }

                // Check for bool, int, str and bytes literals that are never falsy.
                if (type.priv.literalValue !== undefined) {
                    if (ClassType.isBuiltIn(type, ['bool', 'int', 'str', 'bytes'])) {
                        return !type.priv.literalValue || type.priv.literalValue === BigInt(0);
                    }

                    if (type.priv.literalValue instanceof EnumLiteral) {
                        // Does the Enum class forward the truthiness check to the
                        // underlying member type?
                        if (type.priv.literalValue.isReprEnum) {
                            return canBeFalsy(type.priv.literalValue.itemType, recursionCount);
                        }
                    }
                }

                // If this is a protocol class, don't make any assumptions about the absence
                // of specific methods. These could be provided by a class that conforms
                // to the protocol.
                if (ClassType.isProtocolClass(type)) {
                    return true;
                }

                const lenMethod = lookUpObjectMember(type, '__len__');
                if (lenMethod) {
                    return true;
                }

                const boolMethod = lookUpObjectMember(type, '__bool__');
                if (boolMethod) {
                    const boolMethodType = getTypeOfMember(boolMethod);

                    // If the __bool__ function unconditionally returns True, it can never be falsy.
                    if (isFunction(boolMethodType) && boolMethodType.shared.declaredReturnType) {
                        const returnType = boolMethodType.shared.declaredReturnType;
                        if (
                            isClassInstance(returnType) &&
                            ClassType.isBuiltIn(returnType, 'bool') &&
                            returnType.priv.literalValue === true
                        ) {
                            return false;
                        }
                    }

                    return true;
                }

                // If the class is not final, it's possible that it could be overridden
                // such that it is falsy. To be fully correct, we'd need to do the
                // following:
                // return !ClassType.isFinal(type);
                // However, pragmatically if the class is not an `object`, it's typically
                // OK to assume that it will not be overridden in this manner.
                return ClassType.isBuiltIn(type, 'object');
            }
        }
    }

    function canBeTruthy(type: Type, recursionCount = 0): boolean {
        type = makeTopLevelTypeVarsConcrete(type);

        if (recursionCount > maxTypeRecursionCount) {
            return true;
        }
        recursionCount++;

        switch (type.category) {
            case TypeCategory.OverloadResult:
                return true;

            case TypeCategory.Unknown:
            case TypeCategory.Function:
            case TypeCategory.Overloaded:
            case TypeCategory.Module:
            case TypeCategory.TypeVar:
            case TypeCategory.Never:
            case TypeCategory.Any: {
                return true;
            }

            case TypeCategory.Union: {
                return findSubtype(type, (subtype) => canBeTruthy(subtype, recursionCount)) !== undefined;
            }

            case TypeCategory.Unbound: {
                return false;
            }

            case TypeCategory.Class: {
                if (TypeBase.isInstantiable(type)) {
                    return true;
                }

                if (isNoneInstance(type)) {
                    return false;
                }

                // // Check for tuple[()] (an empty tuple).
                if (type.priv.tupleTypeArgs && type.priv.tupleTypeArgs.length === 0) {
                    return false;
                }

                // Check for bool, int, str and bytes literals that are never falsy.
                if (type.priv.literalValue !== undefined) {
                    if (ClassType.isBuiltIn(type, ['bool', 'int', 'str', 'bytes'])) {
                        return !!type.priv.literalValue && type.priv.literalValue !== BigInt(0);
                    }

                    if (type.priv.literalValue instanceof EnumLiteral) {
                        // Does the Enum class forward the truthiness check to the
                        // underlying member type?
                        if (type.priv.literalValue.isReprEnum) {
                            return canBeTruthy(type.priv.literalValue.itemType, recursionCount);
                        }
                    }
                }

                // If this is a protocol class, don't make any assumptions about the absence
                // of specific methods. These could be provided by a class that conforms
                // to the protocol.
                if (ClassType.isProtocolClass(type)) {
                    return true;
                }

                const boolMethod = lookUpObjectMember(type, '__bool__');
                if (boolMethod) {
                    const boolMethodType = getTypeOfMember(boolMethod);

                    // If the __bool__ function unconditionally returns False, it can never be truthy.
                    if (isFunction(boolMethodType) && boolMethodType.shared.declaredReturnType) {
                        const returnType = boolMethodType.shared.declaredReturnType;
                        if (
                            isClassInstance(returnType) &&
                            ClassType.isBuiltIn(returnType, 'bool') &&
                            returnType.priv.literalValue === false
                        ) {
                            return false;
                        }
                    }
                }

                return true;
            }
        }
    }

    function removeTruthinessFromType(type: Type): Type {
        return mapSubtypes(type, (subtype) => {
            const concreteSubtype = makeTopLevelTypeVarsConcrete(subtype);

            if (isClassInstance(concreteSubtype)) {
                if (concreteSubtype.priv.literalValue !== undefined) {
                    let isLiteralFalsy: boolean;

                    if (concreteSubtype.priv.literalValue instanceof EnumLiteral) {
                        isLiteralFalsy = !canBeTruthy(concreteSubtype);
                    } else {
                        isLiteralFalsy = !concreteSubtype.priv.literalValue;
                    }

                    // If the object is already definitely falsy, it's fine to
                    // include, otherwise it should be removed.
                    return isLiteralFalsy ? subtype : undefined;
                }

                // If the object is a sentinel, we can eliminate it.
                if (isSentinelLiteral(concreteSubtype)) {
                    return undefined;
                }

                // If the object is a bool, make it "false", since
                // "true" is a truthy value.
                if (ClassType.isBuiltIn(concreteSubtype, 'bool')) {
                    return ClassType.cloneWithLiteral(concreteSubtype, /* value */ false);
                }

                // If the object is an int, str or bytes, narrow to a literal type.
                // This is slightly unsafe in that someone could subclass `int`, `str`
                // or `bytes` and override the `__bool__` method to change its behavior,
                // but this is extremely unlikely (and ill advised).
                if (ClassType.isBuiltIn(concreteSubtype, 'int')) {
                    return ClassType.cloneWithLiteral(concreteSubtype, /* value */ 0);
                } else if (ClassType.isBuiltIn(concreteSubtype, ['str', 'bytes'])) {
                    return ClassType.cloneWithLiteral(concreteSubtype, /* value */ '');
                }
            }

            // If it's possible for the type to be falsy, include it.
            if (canBeFalsy(subtype)) {
                return subtype;
            }

            return undefined;
        });
    }

    function removeFalsinessFromType(type: Type): Type {
        return mapSubtypes(type, (subtype) => {
            const concreteSubtype = makeTopLevelTypeVarsConcrete(subtype);

            if (isClassInstance(concreteSubtype)) {
                if (concreteSubtype.priv.literalValue !== undefined) {
                    let isLiteralTruthy: boolean;

                    if (concreteSubtype.priv.literalValue instanceof EnumLiteral) {
                        isLiteralTruthy = !canBeFalsy(concreteSubtype);
                    } else if (concreteSubtype.priv.literalValue instanceof SentinelLiteral) {
                        isLiteralTruthy = true;
                    } else {
                        isLiteralTruthy = !!concreteSubtype.priv.literalValue;
                    }

                    // If the object is already definitely truthy, it's fine to
                    // include, otherwise it should be removed.
                    return isLiteralTruthy ? subtype : undefined;
                }

                // If the object is a bool, make it "true", since
                // "false" is a falsy value.
                if (ClassType.isBuiltIn(concreteSubtype, 'bool')) {
                    return ClassType.cloneWithLiteral(concreteSubtype, /* value */ true);
                }

                // If the object is a "None" instance, we can eliminate it.
                if (isNoneInstance(concreteSubtype)) {
                    return undefined;
                }

                // If this is an instance of a class that cannot be subclassed,
                // we cannot say definitively that it's not falsy because a subclass
                // could override `__bool__`. For this reason, the code should not
                // remove any classes that are not final.
                // if (!ClassType.isFinal(concreteSubtype)) {
                //     return subtype;
                // }
                // However, we're going to pragmatically assume that any classes
                // other than `object` will not be overridden in this manner.
                if (ClassType.isBuiltIn(concreteSubtype, 'object')) {
                    return subtype;
                }
            }

            // If it's possible for the type to be truthy, include it.
            if (canBeTruthy(subtype)) {
                return subtype;
            }

            return undefined;
        });
    }

    function narrowTypeBasedOnAssignment(declaredType: Type, assignedTypeResult: TypeResult): TypeResult {
        // TODO: The rules for narrowing types on assignment are not defined in
        // the typing spec. Pyright's current logic is currently not even internally
        // consistent and probably not sound from a type theory perspective. It
        // should be completely reworked once there has been a public discussion
        // about the correct behavior.

        const narrowedType = mapSubtypes(assignedTypeResult.type, (assignedSubtype) => {
            // Handle the special case where the assigned type is a literal type.
            // Some types include very large unions of literal types, and we don't
            // want to use an n^2 loop to compare them.
            if (isClass(assignedSubtype) && isLiteralType(assignedSubtype)) {
                if (isUnion(declaredType) && UnionType.containsType(declaredType, assignedSubtype)) {
                    return assignedSubtype;
                }
            }

            const narrowedSubtype = mapSubtypes(declaredType, (declaredSubtype) => {
                if (!assignType(declaredSubtype, assignedSubtype)) {
                    return undefined;
                }

                // Retain unknowns for code flow analysis convergence and for
                // unknown type reporting in strict mode.
                if (isUnknown(assignedSubtype)) {
                    return assignedSubtype;
                }

                // Preserve assignment narrowing when an enum literal is assigned
                // to its non-literal enum class. A single-member enum is equivalent
                // to its only literal, but the assigned value is still more precise.
                if (
                    isClassInstance(assignedSubtype) &&
                    assignedSubtype.priv.literalValue instanceof EnumLiteral &&
                    isClassInstance(declaredSubtype) &&
                    declaredSubtype.priv.literalValue === undefined &&
                    ClassType.isSameGenericClass(assignedSubtype, declaredSubtype)
                ) {
                    return assignedSubtype;
                }

                // If the two types are bidirectionally assignable, they are
                // either equivalent (in which case it doesn't matter which
                // one we choose) or one or both include gradual types (Any, etc.),
                // in which case we'll want to stick with the declared subtype.
                if (assignType(assignedSubtype, declaredSubtype)) {
                    // We need to be careful with TypedDict types that have
                    // narrowed fields. In this case, we want to return the
                    // assigned type.
                    if (
                        isClass(assignedSubtype) &&
                        assignedSubtype.priv.typedDictNarrowedEntries &&
                        isTypeSame(assignedSubtype, declaredSubtype, { ignoreTypedDictNarrowEntries: true })
                    ) {
                        return assignedSubtype;
                    }

                    // We also need to be careful with callback protocols.
                    if (isClassInstance(declaredSubtype) && ClassType.isProtocolClass(declaredSubtype)) {
                        if (isFunctionOrOverloaded(assignedSubtype)) {
                            return assignedSubtype;
                        }
                    }

                    return declaredSubtype;
                }

                return assignedSubtype;
            });

            // If we couldn't assign the assigned subtype any of the declared
            // subtypes, the types are incompatible. Return the unnarrowed form.
            if (isNever(narrowedSubtype)) {
                return assignedSubtype;
            }

            return narrowedSubtype;
        });

        // If the result of narrowing is an Unknown that is incomplete, propagate the
        // incomplete type for the benefit of code flow analysis.
        // If the result of narrowing is a complete Unknown, combine the Unknown type
        // with the declared type. In strict mode, this will retain the "unknown type"
        // diagnostics while still providing reasonable completion suggestions.
        if (isIncompleteUnknown(narrowedType)) {
            return { type: narrowedType, isIncomplete: assignedTypeResult.isIncomplete };
        } else if (isUnknown(narrowedType)) {
            return { type: combineTypes([narrowedType, declaredType]), isIncomplete: assignedTypeResult.isIncomplete };
        }

        return {
            type:
                narrowedType.props?.inferredTupleLiteral &&
                !assignType(declaredType, getInferredTupleLiteralBase(narrowedType))
                    ? preserveInferredTupleLiterals(narrowedType)
                    : narrowedType,
            isIncomplete: assignedTypeResult.isIncomplete,
        };
    }

    return {
        canBeFalsy,
        canBeTruthy,
        removeTruthinessFromType,
        removeFalsinessFromType,
        narrowTypeBasedOnAssignment,
    };
}
