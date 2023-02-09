/*
 * parameterUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Utility functions for parameters.
 */

import { ParameterCategory } from '../parser/parseNodes';
import { ClassType, FunctionParameter, TypeCategory } from './types';

export function isTypedKwargs(param: FunctionParameter): boolean {
    return (
        param.category === ParameterCategory.VarArgDictionary &&
        param.type.category === TypeCategory.Class &&
        !!param.type.isUnpacked &&
        ClassType.isTypedDictClass(param.type) &&
        !!param.type.details.typedDictEntries
    );
}
