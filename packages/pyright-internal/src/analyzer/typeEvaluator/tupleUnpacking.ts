/*
 * tupleUnpacking.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import {
    ClassType,
    isClassInstance,
    isInstantiableClass,
    isParamSpec,
    isTypeVar,
    isTypeVarTuple,
    Type,
    TypeVarType,
} from '../types';
import { isTupleClass } from '../typeUtils';

export function applyUnpackToTupleLike(type: Type): Type | undefined {
    if (isTypeVarTuple(type)) {
        if (!type.priv.isUnpacked) {
            return TypeVarType.cloneForUnpacked(type);
        }

        return undefined;
    }

    if (isParamSpec(type)) {
        return undefined;
    }

    // Is this a TypeVar that has a tuple upper bound?
    if (isTypeVar(type)) {
        const upperBound = type.shared.boundType;

        if (upperBound && isClassInstance(upperBound) && isTupleClass(upperBound)) {
            return TypeVarType.cloneForUnpacked(type);
        }

        return undefined;
    }

    if (isInstantiableClass(type) && !type.priv.includeSubclasses) {
        if (isTupleClass(type)) {
            return ClassType.cloneForUnpacked(type);
        }
    }

    return undefined;
}
