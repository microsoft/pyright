/*
 * typeGuards.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides logic for narrowing types based on conditional
 * expressions. The logic handles both positive ("if") and
 * negative ("else") narrowing cases.
 */

import { ClassType, isClass, isClassInstance } from '../analyzer/types';

import { transformTypeForEnumMember } from './enums';
import { TypeEvaluatorInternal } from './asyncTypeEvaluatorTypes';
import { forEach, getSymbolTable } from './typeEvalUtils';

export async function enumerateLiteralsForType(
    evaluator: TypeEvaluatorInternal,
    type: ClassType
): Promise<ClassType[] | undefined> {
    if (ClassType.isBuiltIn(type, 'bool')) {
        // Booleans have only two types: True and False.
        return [
            ClassType.cloneWithLiteral(type, /* value */ true),
            ClassType.cloneWithLiteral(type, /* value */ false),
        ];
    }

    if (ClassType.isEnumClass(type)) {
        // Enum expansion doesn't apply to enum classes that derive
        // from enum.Flag.
        if (type.shared.baseClasses.some((baseClass) => isClass(baseClass) && ClassType.isBuiltIn(baseClass, 'Flag'))) {
            return undefined;
        }

        // Enumerate all of the values in this enumeration.
        const enumList: ClassType[] = [];
        const fields = await getSymbolTable(type);
        await forEach(fields, async (symbol, name) => {
            if (!symbol.isIgnoredForProtocolMatch()) {
                let symbolType = await evaluator.getEffectiveTypeOfSymbol(symbol);
                symbolType = (await transformTypeForEnumMember(evaluator, type, name)) ?? symbolType;

                if (
                    isClassInstance(symbolType) &&
                    ClassType.isSameGenericClass(type, symbolType) &&
                    symbolType.priv.literalValue !== undefined
                ) {
                    enumList.push(symbolType);
                }
            }
        });

        return enumList;
    }

    return undefined;
}
