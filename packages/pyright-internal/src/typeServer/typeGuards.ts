/*
 * typeGuards.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Provides logic for narrowing types based on conditional
 * expressions. The logic handles both positive ("if") and
 * negative ("else") narrowing cases.
 *
 * NOTE: This module is forked from `analyzer/typeGuards.ts` and intentionally kept
 * structurally identical to it. The only substantive difference is that file-info
 * is routed through the `ITypeServerEvaluator` rather than the analyzer's evaluator.
 * Keep this copy in sync whenever the canonical narrowing semantics in
 * `analyzer/typeGuards.ts` change, otherwise the two will silently drift. Tracked by
 * the type-server deduplication follow-up.
 */

import { ClassType, isClass, isClassInstance } from '../analyzer/types';

import { transformTypeForEnumMember } from './enums';
import { forEach, getSymbolTable } from './typeEvalUtils';
import { ITypeServerEvaluator } from './typeServerEvaluator';

export function enumerateLiteralsForType(evaluator: ITypeServerEvaluator, type: ClassType): ClassType[] | undefined {
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
        const fields = getSymbolTable(type);
        forEach(fields, (symbol, name) => {
            if (!symbol.isIgnoredForProtocolMatch()) {
                let symbolType = evaluator.getEffectiveTypeOfSymbol(symbol);
                symbolType = transformTypeForEnumMember(evaluator, type, name) ?? symbolType;

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
