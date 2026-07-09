/*
 * typeUtils.ts
 * Copyright (c) Microsoft Corporation.
 *
 * Collection of helper functions around types
 */

import { isClass, isUnion as isUnionType, Type, TypeFlags } from '../analyzer/types';
import { isOptionalType } from '../analyzer/typeUtils';

export function isOptional(type: Type) {
    // Both `typing.Optional` and `T | None` is considered as Optional
    if (isOptionalType(type)) {
        return true;
    }

    return isClass(type) && type.shared.moduleName === 'typing' && type.shared.name === 'Optional';
}

export function isUnion(type: Type) {
    // Both TypeCategory.Union and TypeCategory.Class with name `Union` is considered as Union
    if (isUnionType(type)) {
        return true;
    }

    return isClass(type) && type.shared.moduleName === 'typing' && type.shared.name === 'Union';
}

export function isTypeFlagSet(flags: TypeFlags, flag: TypeFlags): boolean {
    return (flags & flag) === flag;
}
