/*
 * literalTypes.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Helpers for removing literal and type guard information from types.
 */

import {
    ClassType,
    isClass,
    isClassInstance,
    isInstantiableClass,
    isUnion,
    Type,
    TypeBase,
    UnknownType,
} from '../types';
import { convertToInstance, getTypeCondition, isSentinelLiteral, mapSubtypes } from '../typeUtils';

export function stripLiteralValue(type: Type, strClass: Type | undefined): Type {
    // Handle the not-uncommon case where the type is a union that consists
    // only of literal values.
    if (isUnion(type) && type.priv.subtypes.length > 0) {
        if (
            type.priv.literalInstances.literalStrMap?.size === type.priv.subtypes.length ||
            type.priv.literalInstances.literalIntMap?.size === type.priv.subtypes.length ||
            type.priv.literalInstances.literalEnumMap?.size === type.priv.subtypes.length
        ) {
            return stripLiteralValue(type.priv.subtypes[0], strClass);
        }
    }

    return mapSubtypes(type, (subtype) => {
        if (isClass(subtype)) {
            // A sentinel literal represents a stable singleton, so stripping
            // it cannot produce a wider instance type.
            if (subtype.priv.literalValue !== undefined && !isSentinelLiteral(subtype)) {
                subtype = ClassType.cloneWithLiteral(subtype, /* value */ undefined);
            }

            if (ClassType.isBuiltIn(subtype, 'LiteralString')) {
                // Handle "LiteralString" specially.
                if (strClass && isInstantiableClass(strClass)) {
                    let strInstance = ClassType.cloneAsInstance(strClass);
                    strInstance = TypeBase.cloneForCondition(strInstance, getTypeCondition(subtype));
                    return strInstance;
                }
            }
        }

        return subtype;
    });
}

// If a type contains a TypeGuard or TypeIs, convert it to a bool.
export function stripTypeGuard(type: Type, boolClass: Type | undefined): Type {
    return mapSubtypes(type, (subtype) => {
        if (isClassInstance(subtype) && ClassType.isBuiltIn(subtype, ['TypeGuard', 'TypeIs'])) {
            return boolClass ? convertToInstance(boolClass) : UnknownType.create();
        }

        return subtype;
    });
}
