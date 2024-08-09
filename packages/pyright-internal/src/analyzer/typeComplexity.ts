/*
 * typeComplexity.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Routines that compute a "complexity score" for a type. This is used
 * during constraint solving to pick a "best" type when multiple types
 * meet the constraints.
 */

import { AnyType, ClassType, isInstantiableClass, maxTypeRecursionCount, Type, TypeBase, TypeCategory } from './types';

// Returns a "score" for a type that captures the relative complexity
// of the type. Scores should all be between 0 and 1 where 0 means
// very simple and 1 means complex. This is a heuristic, so there's
// often no objectively correct answer.
export function getComplexityScoreForType(type: Type, recursionCount = 0): number {
    if (recursionCount > maxTypeRecursionCount) {
        return 1;
    }
    recursionCount++;

    switch (type.category) {
        case TypeCategory.Unknown:
        case TypeCategory.Any: {
            return 0.5;
        }

        case TypeCategory.TypeVar: {
            // Assume type[T] is more complex than T.
            return TypeBase.isInstantiable(type) ? 0.55 : 0.5;
        }

        case TypeCategory.Function:
        case TypeCategory.Overloaded: {
            // Classes and unions should be preferred over functions,
            // so make this relatively high (more than 0.75).
            return TypeBase.isInstantiable(type) ? 0.85 : 0.8;
        }

        case TypeCategory.Unbound:
        case TypeCategory.Never:
            return 1.0;

        case TypeCategory.Union: {
            let maxScore = 0;

            // If this union has a very large number of subtypes, don't bother
            // accurately computing the score. Assume a fixed value.
            if (type.priv.subtypes.length < 16) {
                type.priv.subtypes.forEach((subtype) => {
                    const subtypeScore = getComplexityScoreForType(subtype, recursionCount);
                    maxScore = Math.max(maxScore, subtypeScore);
                });
            } else {
                maxScore = 0.5;
            }

            return maxScore;
        }

        case TypeCategory.Class: {
            return getComplexityScoreForClass(type, recursionCount);
        }
    }

    // For all other types, return a score of 0.
    return 0;
}

function getComplexityScoreForClass(classType: ClassType, recursionCount: number): number {
    let typeArgScoreSum = 0;
    let typeArgCount = 0;

    if (classType.priv.tupleTypeArgs) {
        classType.priv.tupleTypeArgs.forEach((typeArg) => {
            typeArgScoreSum += getComplexityScoreForType(typeArg.type, recursionCount);
            typeArgCount++;
        });
    } else if (classType.priv.typeArgs) {
        classType.priv.typeArgs.forEach((type) => {
            typeArgScoreSum += getComplexityScoreForType(type, recursionCount);
            typeArgCount++;
        });
    } else if (classType.shared.typeParams) {
        classType.shared.typeParams.forEach((type) => {
            typeArgScoreSum += getComplexityScoreForType(AnyType.create(), recursionCount);
            typeArgCount++;
        });
    }

    const averageTypeArgComplexity = typeArgCount > 0 ? typeArgScoreSum / typeArgCount : 0;
    let result = 0.5 + averageTypeArgComplexity * 0.25;

    // Assume type[T] is more complex than T.
    if (isInstantiableClass(classType)) {
        result += 0.05;
    }

    return result;
}
