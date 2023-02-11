/*
 * parameterUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Utility functions for parameters.
 */

import { ParameterCategory } from '../parser/parseNodes';
import { ClassType, FunctionParameter, isClassInstance, isUnpackedClass } from './types';

export function isTypedKwargs(param: FunctionParameter): boolean {
    return (
        param.category === ParameterCategory.VarArgDictionary &&
        isClassInstance(param.type) &&
        isUnpackedClass(param.type) &&
        ClassType.isTypedDictClass(param.type) &&
        !!param.type.details.typedDictEntries
    );
}
