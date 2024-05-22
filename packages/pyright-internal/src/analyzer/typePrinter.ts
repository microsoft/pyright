/*
 * typePrinter.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Converts a type into a string representation.
 */

import { appendArray } from '../common/collectionUtils';
import { assert } from '../common/debug';
import { ParameterCategory } from '../parser/parseNodes';
import { isTypedKwargs } from './parameterUtils';
import * as ParseTreeUtils from './parseTreeUtils';
import {
    ClassType,
    EnumLiteral,
    FunctionType,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isInstantiableClass,
    isNever,
    isParamSpec,
    isTypeSame,
    isTypeVar,
    isUnknown,
    isUnpacked,
    isVariadicTypeVar,
    maxTypeRecursionCount,
    OverloadedFunctionType,
    TupleTypeArgument,
    Type,
    TypeBase,
    TypeCategory,
    TypeVarType,
    Variance,
} from './types';
import { convertToInstance, doForEachSubtype, isNoneInstance, isTupleClass, removeNoneFromUnion } from './typeUtils';

const singleTickRegEx = /'/g;
const escapedDoubleQuoteRegEx = /\\"/g;

export const enum PrintTypeFlags {
    None = 0,

    // Avoid printing "Unknown" and always use "Any" instead.
    PrintUnknownWithAny = 1 << 0,

    // Omit type arguments for generic classes if they are "Unknown".
    OmitTypeArgumentsIfUnknown = 1 << 1,

    // Omit printing type for param if type is not specified.
    OmitUnannotatedParamType = 1 << 2,

    // Print Union and Optional in PEP 604 format.
    PEP604 = 1 << 3,

    // Include a parentheses around a union if there's more than
    // one subtype.
    ParenthesizeUnion = 1 << 4,

    // Expand type aliases to display their individual parts?
    ExpandTypeAlias = 1 << 5,

    // Omit "*" for types that are conditionally constrained when
    // used with constrained TypeVars.
    OmitConditionalConstraint = 1 << 6,

    // Include a parentheses around a callable.
    ParenthesizeCallable = 1 << 7,

    // Limit output to legal Python syntax.
    PythonSyntax = 1 << 8,

    // Use Unpack instead of "*" for unpacked tuples and TypeVarTuples.
    // Requires Python 3.11 or newer.
    UseTypingUnpack = 1 << 9,

    // Expand TypedDict kwargs to show the keys from the TypedDict instead of **kwargs.
    ExpandTypedDictArgs = 1 << 10,

    // Print the variance of a type parameter.
    PrintTypeVarVariance = 1 << 11,

    // Use the fully-qualified name of classes, type aliases, modules,
    // and functions rather than short names.
    UseFullyQualifiedNames = 1 << 12,
}

export type FunctionReturnTypeCallback = (type: FunctionType) => Type;

export function printType(
    type: Type,
    printTypeFlags: PrintTypeFlags,
    returnTypeCallback: FunctionReturnTypeCallback
): string {
    const uniqueNameMap = new UniqueNameMap(printTypeFlags, returnTypeCallback);
    uniqueNameMap.build(type);

    return printTypeInternal(type, printTypeFlags, returnTypeCallback, uniqueNameMap, [], 0);
}

export function printFunctionParts(
    type: FunctionType,
    printTypeFlags: PrintTypeFlags,
    returnTypeCallback: FunctionReturnTypeCallback
): [string[], string] {
    const uniqueNameMap = new UniqueNameMap(printTypeFlags, returnTypeCallback);
    uniqueNameMap.build(type);

    return printFunctionPartsInternal(type, printTypeFlags, returnTypeCallback, uniqueNameMap, [], 0);
}

export function printObjectTypeForClass(
    type: ClassType,
    printTypeFlags: PrintTypeFlags,
    returnTypeCallback: FunctionReturnTypeCallback
): string {
    const uniqueNameMap = new UniqueNameMap(printTypeFlags, returnTypeCallback);
    uniqueNameMap.build(type);

    return printObjectTypeForClassInternal(type, printTypeFlags, returnTypeCallback, uniqueNameMap, [], 0);
}

const maxLiteralStringLength = 50;

export function isLiteralValueTruncated(type: ClassType): boolean {
    if (typeof type.literalValue === 'string') {
        if (type.literalValue.length > maxLiteralStringLength) {
            return true;
        }
    }

    return false;
}

export function printLiteralValueTruncated(type: ClassType): string {
    if (type.details.name === 'bytes') {
        return 'bytes';
    }

    assert(type.details.name === 'str');
    return 'LiteralString';
}

export function printLiteralValue(type: ClassType, quotation = "'"): string {
    const literalValue = type.literalValue;
    if (literalValue === undefined) {
        return '';
    }

    let literalStr: string;
    if (typeof literalValue === 'string') {
        let effectiveLiteralValue = literalValue;

        // Limit the length of the string literal.
        if (literalValue.length > maxLiteralStringLength) {
            effectiveLiteralValue = literalValue.substring(0, maxLiteralStringLength) + '…';
        }

        if (type.details.name === 'bytes') {
            let bytesString = '';

            // There's no good built-in conversion routine in javascript to convert
            // bytes strings. Determine on a character-by-character basis whether
            // it can be rendered into an ASCII character. If not, use an escape.
            for (let i = 0; i < effectiveLiteralValue.length; i++) {
                const char = effectiveLiteralValue.substring(i, i + 1);
                const charCode = char.charCodeAt(0);

                if (charCode >= 20 && charCode <= 126) {
                    if (charCode === 34) {
                        bytesString += '\\' + char;
                    } else {
                        bytesString += char;
                    }
                } else {
                    bytesString += `\\x${((charCode >> 4) & 0xf).toString(16)}${(charCode & 0xf).toString(16)}`;
                }
            }

            literalStr = `b"${bytesString}"`;
        } else {
            // JSON.stringify will perform proper escaping for " case.
            // So, we only need to do our own escaping for ' case.
            literalStr = JSON.stringify(effectiveLiteralValue).toString();
            if (quotation !== '"') {
                literalStr = `'${literalStr
                    .substring(1, literalStr.length - 1)
                    .replace(escapedDoubleQuoteRegEx, '"')
                    .replace(singleTickRegEx, "\\'")}'`; // CodeQL [SM02383] Code ql is just wrong here. We don't need to replace backslashes.
            }
        }
    } else if (typeof literalValue === 'boolean') {
        literalStr = literalValue ? 'True' : 'False';
    } else if (literalValue instanceof EnumLiteral) {
        literalStr = `${literalValue.className}.${literalValue.itemName}`;
    } else if (typeof literalValue === 'bigint') {
        literalStr = literalValue.toString();
        if (literalStr.endsWith('n')) {
            literalStr = literalStr.substring(0, literalStr.length - 1);
        }
    } else {
        literalStr = literalValue.toString();
    }

    return literalStr;
}

function printTypeInternal(
    type: Type,
    printTypeFlags: PrintTypeFlags,
    returnTypeCallback: FunctionReturnTypeCallback,
    uniqueNameMap: UniqueNameMap,
    recursionTypes: Type[],
    recursionCount: number
): string {
    const originalPrintTypeFlags = printTypeFlags;
    const parenthesizeUnion = (printTypeFlags & PrintTypeFlags.ParenthesizeUnion) !== 0;
    printTypeFlags &= ~(PrintTypeFlags.ParenthesizeUnion | PrintTypeFlags.ParenthesizeCallable);

    if (recursionCount > maxTypeRecursionCount) {
        if (printTypeFlags & PrintTypeFlags.PythonSyntax) {
            return 'Any';
        }
        return '<Recursive>';
    }
    recursionCount++;

    // If this is a type alias, see if we should use its name rather than
    // the type it represents.
    if (type.typeAliasInfo) {
        let expandTypeAlias = true;
        if ((printTypeFlags & PrintTypeFlags.ExpandTypeAlias) === 0) {
            expandTypeAlias = false;
        } else {
            if (recursionTypes.find((t) => t === type)) {
                expandTypeAlias = false;
            }
        }

        if (!expandTypeAlias) {
            try {
                recursionTypes.push(type);
                let aliasName =
                    (printTypeFlags & PrintTypeFlags.UseFullyQualifiedNames) !== 0
                        ? type.typeAliasInfo.fullName
                        : type.typeAliasInfo.name;

                // Use the fully-qualified name if the name isn't unique.
                if (!uniqueNameMap.isUnique(aliasName)) {
                    aliasName = type.typeAliasInfo.fullName;
                }

                const typeParams = type.typeAliasInfo.typeParameters;

                if (typeParams && typeParams.length > 0) {
                    let argumentStrings: string[] | undefined;

                    // If there is a type arguments array, it's a specialized type alias.
                    if (type.typeAliasInfo.typeArguments) {
                        if (
                            (printTypeFlags & PrintTypeFlags.OmitTypeArgumentsIfUnknown) === 0 ||
                            type.typeAliasInfo.typeArguments.some((typeArg) => !isUnknown(typeArg))
                        ) {
                            argumentStrings = [];
                            type.typeAliasInfo.typeArguments.forEach((typeArg, index) => {
                                // Which type parameter does this map to?
                                const typeParam =
                                    index < typeParams.length ? typeParams[index] : typeParams[typeParams.length - 1];

                                // If this type argument maps to a variadic type parameter, unpack it.
                                if (
                                    isVariadicTypeVar(typeParam) &&
                                    isClassInstance(typeArg) &&
                                    isTupleClass(typeArg) &&
                                    typeArg.tupleTypeArguments &&
                                    typeArg.tupleTypeArguments.every((typeArg) => !typeArg.isUnbounded)
                                ) {
                                    typeArg.tupleTypeArguments.forEach((tupleTypeArg) => {
                                        argumentStrings!.push(
                                            printTypeInternal(
                                                tupleTypeArg.type,
                                                printTypeFlags,
                                                returnTypeCallback,
                                                uniqueNameMap,
                                                recursionTypes,
                                                recursionCount
                                            )
                                        );
                                    });
                                } else {
                                    argumentStrings!.push(
                                        printTypeInternal(
                                            typeArg,
                                            printTypeFlags,
                                            returnTypeCallback,
                                            uniqueNameMap,
                                            recursionTypes,
                                            recursionCount
                                        )
                                    );
                                }
                            });
                        }
                    } else {
                        if (
                            (printTypeFlags & PrintTypeFlags.OmitTypeArgumentsIfUnknown) === 0 ||
                            typeParams.some((typeParam) => !isUnknown(typeParam))
                        ) {
                            argumentStrings = [];
                            typeParams.forEach((typeParam) => {
                                argumentStrings!.push(
                                    printTypeInternal(
                                        typeParam,
                                        printTypeFlags,
                                        returnTypeCallback,
                                        uniqueNameMap,
                                        recursionTypes,
                                        recursionCount
                                    )
                                );
                            });
                        }
                    }

                    if (argumentStrings) {
                        if (argumentStrings.length === 0) {
                            aliasName += `[()]`;
                        } else {
                            aliasName += `[${argumentStrings.join(', ')}]`;
                        }
                    }
                }

                // If it's a TypeVar, don't use the alias name. Instead, use the full
                // name, which may have a scope associated with it.
                if (type.category !== TypeCategory.TypeVar) {
                    return aliasName;
                }
            } finally {
                recursionTypes.pop();
            }
        }
    }

    if (
        recursionTypes.find(
            (t) =>
                t === type ||
                (t.typeAliasInfo !== undefined && t.typeAliasInfo.fullName === type.typeAliasInfo?.fullName)
        ) ||
        recursionTypes.length > maxTypeRecursionCount
    ) {
        // If this is a recursive TypeVar, we've already expanded it once, so
        // just print its name at this point.
        if (isTypeVar(type) && type.details.isSynthesized && type.details.recursiveTypeAliasName) {
            return type.details.recursiveTypeAliasName;
        }

        if (type.typeAliasInfo) {
            if (!type.typeAliasInfo.typeParameters) {
                let name =
                    (printTypeFlags & PrintTypeFlags.UseFullyQualifiedNames) !== 0
                        ? type.typeAliasInfo.fullName
                        : type.typeAliasInfo.name;
                if (!uniqueNameMap.isUnique(name)) {
                    name = type.typeAliasInfo.fullName;
                }
                return name;
            }

            try {
                recursionTypes.push(type);

                return printTypeInternal(
                    type,
                    printTypeFlags & ~PrintTypeFlags.ExpandTypeAlias,
                    returnTypeCallback,
                    uniqueNameMap,
                    recursionTypes,
                    recursionCount
                );
            } finally {
                recursionTypes.pop();
            }
        }

        return '...';
    }

    try {
        recursionTypes.push(type);

        const includeConditionalIndicator =
            (printTypeFlags & (PrintTypeFlags.OmitConditionalConstraint | PrintTypeFlags.PythonSyntax)) === 0;
        const getConditionalIndicator = (subtype: Type) => {
            return subtype.condition !== undefined && includeConditionalIndicator ? '*' : '';
        };

        switch (type.category) {
            case TypeCategory.Unbound: {
                if (printTypeFlags & PrintTypeFlags.PythonSyntax) {
                    return 'Any';
                }
                return 'Unbound';
            }

            case TypeCategory.Unknown: {
                if (printTypeFlags & (PrintTypeFlags.PythonSyntax | PrintTypeFlags.PrintUnknownWithAny)) {
                    return 'Any';
                }
                return 'Unknown';
            }

            case TypeCategory.Module: {
                if (printTypeFlags & PrintTypeFlags.PythonSyntax) {
                    return 'Any';
                }
                return `Module("${type.moduleName}")`;
            }

            case TypeCategory.Class: {
                if (TypeBase.isInstance(type)) {
                    if (type.literalValue !== undefined) {
                        if (isLiteralValueTruncated(type) && (printTypeFlags & PrintTypeFlags.PythonSyntax) !== 0) {
                            return printLiteralValueTruncated(type);
                        } else {
                            return `Literal[${printLiteralValue(type)}]`;
                        }
                    }

                    return `${printObjectTypeForClassInternal(
                        type,
                        printTypeFlags,
                        returnTypeCallback,
                        uniqueNameMap,
                        recursionTypes,
                        recursionCount
                    )}${getConditionalIndicator(type)}`;
                } else {
                    let typeToWrap: string;

                    if (type.literalValue !== undefined) {
                        if (isLiteralValueTruncated(type) && (printTypeFlags & PrintTypeFlags.PythonSyntax) !== 0) {
                            typeToWrap = printLiteralValueTruncated(type);
                        } else {
                            typeToWrap = `Literal[${printLiteralValue(type)}]`;
                        }
                    } else {
                        typeToWrap = printObjectTypeForClassInternal(
                            type.specialForm ?? type,
                            printTypeFlags,
                            returnTypeCallback,
                            uniqueNameMap,
                            recursionTypes,
                            recursionCount
                        );
                    }

                    return `${_printNestedInstantiable(type, typeToWrap)}${getConditionalIndicator(type)}`;
                }
            }

            case TypeCategory.Function: {
                if (TypeBase.isInstantiable(type)) {
                    const typeString = printFunctionType(
                        FunctionType.cloneAsInstance(type),
                        printTypeFlags,
                        returnTypeCallback,
                        uniqueNameMap,
                        recursionTypes,
                        recursionCount
                    );
                    return `type[${typeString}]`;
                }

                return printFunctionType(
                    type,
                    originalPrintTypeFlags,
                    returnTypeCallback,
                    uniqueNameMap,
                    recursionTypes,
                    recursionCount
                );
            }

            case TypeCategory.OverloadedFunction: {
                const overloads = OverloadedFunctionType.getOverloads(type).map((overload) =>
                    printTypeInternal(
                        overload,
                        printTypeFlags,
                        returnTypeCallback,
                        uniqueNameMap,
                        recursionTypes,
                        recursionCount
                    )
                );

                if (printTypeFlags & PrintTypeFlags.PythonSyntax) {
                    return 'Callable[..., Any]';
                }

                if (overloads.length === 1) {
                    return overloads[0];
                }

                return `Overload[${overloads.join(', ')}]`;
            }

            case TypeCategory.Union: {
                // If this is a value expression that evaluates to a union type but is
                // not a type alias, simply print the special form ("UnionType").
                if (TypeBase.isInstantiable(type) && type.specialForm && !type.typeAliasInfo) {
                    return printTypeInternal(
                        type.specialForm,
                        printTypeFlags,
                        returnTypeCallback,
                        uniqueNameMap,
                        recursionTypes,
                        recursionCount
                    );
                }

                // Allocate a set that refers to subtypes in the union by
                // their indices. If the index is within the set, it is already
                // accounted for in the output.
                const subtypeHandledSet = new Set<number>();

                // Allocate another set that represents the textual representations
                // of the subtypes in the union.
                const subtypeStrings = new Set<string>();

                // If we're using "|" notation, enclose callable subtypes in parens.
                const updatedPrintTypeFlags =
                    printTypeFlags & PrintTypeFlags.PEP604
                        ? printTypeFlags | PrintTypeFlags.ParenthesizeCallable
                        : printTypeFlags;

                // Start by matching possible type aliases to the subtypes.
                if ((printTypeFlags & PrintTypeFlags.ExpandTypeAlias) === 0 && type.typeAliasSources) {
                    for (const typeAliasSource of type.typeAliasSources) {
                        let matchedAllSubtypes = true;
                        let allSubtypesPreviouslyHandled = true;
                        const indicesCoveredByTypeAlias = new Set<number>();

                        for (const sourceSubtype of typeAliasSource.subtypes) {
                            let unionSubtypeIndex = 0;
                            let foundMatch = false;
                            const sourceSubtypeInstance = convertToInstance(sourceSubtype);

                            for (const unionSubtype of type.subtypes) {
                                if (isTypeSame(sourceSubtypeInstance, unionSubtype)) {
                                    if (!subtypeHandledSet.has(unionSubtypeIndex)) {
                                        allSubtypesPreviouslyHandled = false;
                                    }
                                    indicesCoveredByTypeAlias.add(unionSubtypeIndex);
                                    foundMatch = true;
                                    break;
                                }

                                unionSubtypeIndex++;
                            }

                            if (!foundMatch) {
                                matchedAllSubtypes = false;
                                break;
                            }
                        }

                        if (matchedAllSubtypes && !allSubtypesPreviouslyHandled) {
                            subtypeStrings.add(
                                printTypeInternal(
                                    typeAliasSource,
                                    updatedPrintTypeFlags,
                                    returnTypeCallback,
                                    uniqueNameMap,
                                    recursionTypes,
                                    recursionCount
                                )
                            );
                            indicesCoveredByTypeAlias.forEach((index) => subtypeHandledSet.add(index));
                        }
                    }
                }

                const noneIndex = type.subtypes.findIndex((subtype) => isNoneInstance(subtype));
                if (noneIndex >= 0 && !subtypeHandledSet.has(noneIndex)) {
                    const typeWithoutNone = removeNoneFromUnion(type);
                    if (isNever(typeWithoutNone)) {
                        return 'None';
                    }

                    const optionalType = printTypeInternal(
                        typeWithoutNone,
                        updatedPrintTypeFlags,
                        returnTypeCallback,
                        uniqueNameMap,
                        recursionTypes,
                        recursionCount
                    );

                    if (printTypeFlags & PrintTypeFlags.PEP604) {
                        const unionString = optionalType + ' | None';
                        if (parenthesizeUnion) {
                            return `(${unionString})`;
                        }
                        return unionString;
                    }

                    return 'Optional[' + optionalType + ']';
                }

                const literalObjectStrings = new Set<string>();
                const literalClassStrings = new Set<string>();
                doForEachSubtype(type, (subtype, index) => {
                    if (!subtypeHandledSet.has(index)) {
                        if (isClassInstance(subtype) && subtype.literalValue !== undefined) {
                            if (
                                isLiteralValueTruncated(subtype) &&
                                (printTypeFlags & PrintTypeFlags.PythonSyntax) !== 0
                            ) {
                                subtypeStrings.add(printLiteralValueTruncated(subtype));
                            } else {
                                literalObjectStrings.add(printLiteralValue(subtype));
                            }
                        } else if (isInstantiableClass(subtype) && subtype.literalValue !== undefined) {
                            if (
                                isLiteralValueTruncated(subtype) &&
                                (printTypeFlags & PrintTypeFlags.PythonSyntax) !== 0
                            ) {
                                subtypeStrings.add(`type[${printLiteralValueTruncated(subtype)}]`);
                            } else {
                                literalClassStrings.add(printLiteralValue(subtype));
                            }
                        } else {
                            subtypeStrings.add(
                                printTypeInternal(
                                    subtype,
                                    updatedPrintTypeFlags,
                                    returnTypeCallback,
                                    uniqueNameMap,
                                    recursionTypes,
                                    recursionCount
                                )
                            );
                        }
                    }
                });

                const dedupedSubtypeStrings: string[] = [];
                subtypeStrings.forEach((s) => dedupedSubtypeStrings.push(s));

                if (literalObjectStrings.size > 0) {
                    const literalStrings: string[] = [];
                    literalObjectStrings.forEach((s) => literalStrings.push(s));
                    dedupedSubtypeStrings.push(`Literal[${literalStrings.join(', ')}]`);
                }

                if (literalClassStrings.size > 0) {
                    const literalStrings: string[] = [];
                    literalClassStrings.forEach((s) => literalStrings.push(s));
                    dedupedSubtypeStrings.push(`type[Literal[${literalStrings.join(', ')}]]`);
                }

                if (dedupedSubtypeStrings.length === 1) {
                    return dedupedSubtypeStrings[0];
                }

                if (printTypeFlags & PrintTypeFlags.PEP604) {
                    const unionString = dedupedSubtypeStrings.join(' | ');
                    if (parenthesizeUnion) {
                        return `(${unionString})`;
                    }
                    return unionString;
                }

                return `Union[${dedupedSubtypeStrings.join(', ')}]`;
            }

            case TypeCategory.TypeVar: {
                // If it's synthesized, don't expose the internal name we generated.
                // This will confuse users. The exception is if it's a bound synthesized
                // type, in which case we'll print the bound type. This is used for
                // "self" and "cls" parameters.
                if (type.details.isSynthesized) {
                    // If it's a synthesized type var used to implement recursive type
                    // aliases, return the type alias name.
                    if (type.details.recursiveTypeAliasName) {
                        if ((printTypeFlags & PrintTypeFlags.ExpandTypeAlias) !== 0 && type.details.boundType) {
                            return printTypeInternal(
                                TypeBase.isInstance(type)
                                    ? convertToInstance(type.details.boundType)
                                    : type.details.boundType,
                                printTypeFlags,
                                returnTypeCallback,
                                uniqueNameMap,
                                recursionTypes,
                                recursionCount
                            );
                        }
                        return type.details.recursiveTypeAliasName;
                    }

                    // If it's a synthesized type var used to implement `self` or `cls` types,
                    // print the type with a special character that indicates that the type
                    // is internally represented as a TypeVar.
                    if (type.details.isSynthesizedSelf && type.details.boundType) {
                        let boundTypeString = printTypeInternal(
                            type.details.boundType,
                            printTypeFlags & ~PrintTypeFlags.ExpandTypeAlias,
                            returnTypeCallback,
                            uniqueNameMap,
                            recursionTypes,
                            recursionCount
                        );

                        if (!isAnyOrUnknown(type.details.boundType)) {
                            if (printTypeFlags & PrintTypeFlags.PythonSyntax) {
                                boundTypeString = `Self`;
                            } else {
                                boundTypeString = `Self@${boundTypeString}`;
                            }
                        }

                        if (TypeBase.isInstantiable(type)) {
                            return `${_printNestedInstantiable(type, boundTypeString)}`;
                        }

                        return boundTypeString;
                    }

                    return (printTypeFlags & (PrintTypeFlags.PrintUnknownWithAny | PrintTypeFlags.PythonSyntax)) !== 0
                        ? 'Any'
                        : 'Unknown';
                }

                if (type.details.isParamSpec) {
                    const paramSpecText = _getReadableTypeVarName(
                        type,
                        (printTypeFlags & PrintTypeFlags.PythonSyntax) !== 0
                    );

                    if (type.paramSpecAccess) {
                        return `${paramSpecText}.${type.paramSpecAccess}`;
                    }
                    return paramSpecText;
                }

                let typeVarName = _getReadableTypeVarName(type, (printTypeFlags & PrintTypeFlags.PythonSyntax) !== 0);
                if (type.isVariadicUnpacked) {
                    typeVarName = _printUnpack(typeVarName, printTypeFlags);
                }

                if (type.isVariadicInUnion) {
                    typeVarName = `Union[${typeVarName}]`;
                }

                if (TypeBase.isInstantiable(type)) {
                    typeVarName = `${_printNestedInstantiable(type, typeVarName)}`;
                }

                if (!type.details.isVariadic && (printTypeFlags & PrintTypeFlags.PrintTypeVarVariance) !== 0) {
                    const varianceText = _getTypeVarVarianceText(type);
                    if (varianceText) {
                        typeVarName = `${typeVarName} (${varianceText})`;
                    }
                }

                return typeVarName;
            }

            case TypeCategory.Never: {
                return type.isNoReturn ? 'NoReturn' : 'Never';
            }

            case TypeCategory.Any: {
                const anyType = type;
                return anyType.isEllipsis ? '...' : 'Any';
            }
        }

        return '';
    } finally {
        recursionTypes.pop();
    }
}

function printFunctionType(
    type: FunctionType,
    printTypeFlags: PrintTypeFlags,
    returnTypeCallback: FunctionReturnTypeCallback,
    uniqueNameMap: UniqueNameMap,
    recursionTypes: Type[],
    recursionCount: number
) {
    if (printTypeFlags & PrintTypeFlags.PythonSyntax) {
        // Callable works only in cases where all parameters are positional-only.
        let isPositionalParamsOnly = false;
        if (type.details.parameters.length === 0) {
            isPositionalParamsOnly = true;
        } else {
            if (type.details.parameters.every((param) => param.category === ParameterCategory.Simple)) {
                const lastParam = type.details.parameters[type.details.parameters.length - 1];
                if (!lastParam.name) {
                    isPositionalParamsOnly = true;
                }
            }
        }

        const returnType = returnTypeCallback(type);
        let returnTypeString = 'Any';
        if (returnType) {
            returnTypeString = printTypeInternal(
                returnType,
                printTypeFlags,
                returnTypeCallback,
                uniqueNameMap,
                recursionTypes,
                recursionCount
            );
        }

        if (isPositionalParamsOnly) {
            const paramTypes: string[] = [];

            type.details.parameters.forEach((param, index) => {
                if (param.name) {
                    const paramType = FunctionType.getEffectiveParameterType(type, index);
                    if (recursionTypes.length < maxTypeRecursionCount) {
                        paramTypes.push(
                            printTypeInternal(
                                paramType,
                                printTypeFlags,
                                returnTypeCallback,
                                uniqueNameMap,
                                recursionTypes,
                                recursionCount
                            )
                        );
                    } else {
                        paramTypes.push('Any');
                    }
                }
            });

            if (type.details.paramSpec) {
                if (paramTypes.length > 0) {
                    return `Callable[Concatenate[${paramTypes.join(', ')}, ${
                        type.details.paramSpec.details.name
                    }], ${returnTypeString}]`;
                }

                return `Callable[${type.details.paramSpec.details.name}, ${returnTypeString}]`;
            }

            return `Callable[[${paramTypes.join(', ')}], ${returnTypeString}]`;
        } else {
            // We can't represent this type using a Callable so default to
            // a "catch all" Callable.
            return `Callable[..., ${returnTypeString}]`;
        }
    } else {
        const parts = printFunctionPartsInternal(
            type,
            printTypeFlags,
            returnTypeCallback,
            uniqueNameMap,
            recursionTypes,
            recursionCount
        );
        const paramSignature = `(${parts[0].join(', ')})`;

        if (FunctionType.isParamSpecValue(type)) {
            if (parts[0].length === 1 && parts[0][0] === '...') {
                return parts[0][0];
            }

            return paramSignature;
        }

        const fullSignature = `${paramSignature} -> ${parts[1]}`;
        const parenthesizeCallable = (printTypeFlags & PrintTypeFlags.ParenthesizeCallable) !== 0;
        if (parenthesizeCallable) {
            return `(${fullSignature})`;
        }

        return fullSignature;
    }
}

function printObjectTypeForClassInternal(
    type: ClassType,
    printTypeFlags: PrintTypeFlags,
    returnTypeCallback: FunctionReturnTypeCallback,
    uniqueNameMap: UniqueNameMap,
    recursionTypes: Type[],
    recursionCount: number
): string {
    let objName = type.aliasName;
    if (!objName) {
        objName =
            (printTypeFlags & PrintTypeFlags.UseFullyQualifiedNames) !== 0 ? type.details.fullName : type.details.name;
    }

    // Special-case NoneType to convert it to None.
    if (ClassType.isBuiltIn(type, 'NoneType')) {
        objName = 'None';
    }

    // Use the fully-qualified name if the name isn't unique.
    if (!uniqueNameMap.isUnique(objName)) {
        objName = type.details.fullName;
    }

    // If this is a pseudo-generic class, don't display the type arguments
    // or type parameters because it will confuse users.
    if (!ClassType.isPseudoGenericClass(type)) {
        const typeParams = ClassType.getTypeParameters(type);
        const lastTypeParam = typeParams.length > 0 ? typeParams[typeParams.length - 1] : undefined;
        const isVariadic = lastTypeParam ? lastTypeParam.details.isVariadic : false;

        // If there is a type arguments array, it's a specialized class.
        const typeArgs: TupleTypeArgument[] | undefined =
            type.tupleTypeArguments ??
            type.typeArguments?.map((t) => {
                return { type: t, isUnbounded: false };
            });
        if (typeArgs) {
            // Handle Tuple[()] as a special case.
            if (typeArgs.length > 0) {
                const typeArgStrings: string[] = [];
                let isAllUnknown = true;

                typeArgs.forEach((typeArg, index) => {
                    const typeParam = index < typeParams.length ? typeParams[index] : undefined;
                    if (
                        typeParam &&
                        typeParam.details.isVariadic &&
                        isClassInstance(typeArg.type) &&
                        ClassType.isBuiltIn(typeArg.type, 'tuple') &&
                        typeArg.type.tupleTypeArguments
                    ) {
                        // Expand the tuple type that maps to the variadic type parameter.
                        if (typeArg.type.tupleTypeArguments.length === 0) {
                            if (!isUnknown(typeArg.type)) {
                                isAllUnknown = false;
                            }

                            if (index === 0) {
                                typeArgStrings.push(_printUnpack('tuple[()]', printTypeFlags));
                            }
                        } else {
                            appendArray(
                                typeArgStrings,
                                typeArg.type.tupleTypeArguments.map((typeArg) => {
                                    if (!isUnknown(typeArg.type)) {
                                        isAllUnknown = false;
                                    }

                                    const typeArgText = printTypeInternal(
                                        typeArg.type,
                                        printTypeFlags,
                                        returnTypeCallback,
                                        uniqueNameMap,
                                        recursionTypes,
                                        recursionCount
                                    );

                                    if (typeArg.isUnbounded) {
                                        return _printUnpack(`tuple[${typeArgText}, ...]`, printTypeFlags);
                                    }

                                    return typeArgText;
                                })
                            );
                        }
                    } else {
                        if (!isUnknown(typeArg.type)) {
                            isAllUnknown = false;
                        }

                        const typeArgTypeText = printTypeInternal(
                            typeArg.type,
                            printTypeFlags,
                            returnTypeCallback,
                            uniqueNameMap,
                            recursionTypes,
                            recursionCount
                        );

                        if (typeArg.isUnbounded) {
                            if (typeArgs.length === 1) {
                                typeArgStrings.push(typeArgTypeText, '...');
                            } else {
                                typeArgStrings.push(_printUnpack(`tuple[${typeArgTypeText}, ...]`, printTypeFlags));
                            }
                        } else {
                            typeArgStrings.push(typeArgTypeText);
                        }
                    }
                });

                if (type.isUnpacked) {
                    objName = _printUnpack(objName, printTypeFlags);
                }

                if ((printTypeFlags & PrintTypeFlags.OmitTypeArgumentsIfUnknown) === 0 || !isAllUnknown) {
                    objName += '[' + typeArgStrings.join(', ') + ']';
                }
            } else {
                if (type.isUnpacked) {
                    objName = _printUnpack(objName, printTypeFlags);
                }

                if (ClassType.isTupleClass(type) || isVariadic) {
                    objName += '[()]';
                }
            }
        } else {
            if (type.isUnpacked) {
                objName = _printUnpack(objName, printTypeFlags);
            }

            if (typeParams.length > 0) {
                if (
                    (printTypeFlags & PrintTypeFlags.OmitTypeArgumentsIfUnknown) === 0 ||
                    typeParams.some((typeParam) => !isUnknown(typeParam))
                ) {
                    objName +=
                        '[' +
                        typeParams
                            .map((typeParam) => {
                                return printTypeInternal(
                                    typeParam,
                                    printTypeFlags,
                                    returnTypeCallback,
                                    uniqueNameMap,
                                    recursionTypes,
                                    recursionCount
                                );
                            })
                            .join(', ') +
                        ']';
                }
            }
        }
    }

    // Wrap in a "Partial" for TypedDict that has been synthesized as partial.
    if (type.isTypedDictPartial) {
        if ((printTypeFlags & PrintTypeFlags.PythonSyntax) === 0) {
            objName = `Partial[${objName}]`;
        }
    }

    return objName;
}

function printFunctionPartsInternal(
    type: FunctionType,
    printTypeFlags: PrintTypeFlags,
    returnTypeCallback: FunctionReturnTypeCallback,
    uniqueNameMap: UniqueNameMap,
    recursionTypes: Type[],
    recursionCount: number
): [string[], string] {
    const paramTypeStrings: string[] = [];
    let sawDefinedName = false;

    type.details.parameters.forEach((param, index) => {
        // Handle specialized variadic type parameters specially.
        if (
            index === type.details.parameters.length - 1 &&
            param.category === ParameterCategory.ArgsList &&
            isVariadicTypeVar(param.type)
        ) {
            const specializedParamType = FunctionType.getEffectiveParameterType(type, index);
            if (
                isClassInstance(specializedParamType) &&
                ClassType.isBuiltIn(specializedParamType, 'tuple') &&
                specializedParamType.tupleTypeArguments
            ) {
                specializedParamType.tupleTypeArguments.forEach((paramType) => {
                    const paramString = printTypeInternal(
                        paramType.type,
                        printTypeFlags,
                        returnTypeCallback,
                        uniqueNameMap,
                        recursionTypes,
                        recursionCount
                    );
                    paramTypeStrings.push(paramString);
                });
                return;
            }
        }

        // Handle expanding TypedDict kwargs specially.
        if (
            isTypedKwargs(param) &&
            printTypeFlags & PrintTypeFlags.ExpandTypedDictArgs &&
            param.type.category === TypeCategory.Class
        ) {
            param.type.details.typedDictEntries!.knownItems.forEach((v, k) => {
                const valueTypeString = printTypeInternal(
                    v.valueType,
                    printTypeFlags,
                    returnTypeCallback,
                    uniqueNameMap,
                    recursionTypes,
                    recursionCount
                );
                paramTypeStrings.push(`${k}: ${valueTypeString}`);
            });
            return;
        }

        let paramString = '';
        if (param.category === ParameterCategory.ArgsList) {
            if (!param.name || !param.isNameSynthesized) {
                paramString += '*';
            }
        } else if (param.category === ParameterCategory.KwargsDict) {
            paramString += '**';
        }

        let emittedParamName = false;
        if (param.name && !param.isNameSynthesized) {
            paramString += param.name;
            sawDefinedName = true;
            emittedParamName = true;
        } else if (printTypeFlags & PrintTypeFlags.PythonSyntax) {
            paramString += `__p${index}`;
            sawDefinedName = true;
            emittedParamName = true;
        }

        let defaultValueAssignment = '=';
        let isParamSpecArgsKwargsParam = false;

        if (param.name) {
            // Avoid printing type types if parameter have unknown type.
            if (param.hasDeclaredType || param.isTypeInferred) {
                const paramType = FunctionType.getEffectiveParameterType(type, index);
                let paramTypeString =
                    recursionTypes.length < maxTypeRecursionCount
                        ? printTypeInternal(
                              paramType,
                              printTypeFlags,
                              returnTypeCallback,
                              uniqueNameMap,
                              recursionTypes,
                              recursionCount
                          )
                        : '';

                if (emittedParamName) {
                    paramString += ': ';
                } else if (param.category === ParameterCategory.ArgsList && !isUnpacked(paramType)) {
                    paramString += '*';
                }

                if (param.category === ParameterCategory.KwargsDict && isUnpacked(paramType)) {
                    if (printTypeFlags & PrintTypeFlags.PythonSyntax) {
                        // Use "Unpack" because ** isn't legal syntax prior to Python 3.12.
                        paramTypeString = `Unpack[${paramTypeString.substring(1)}]`;
                    } else {
                        // If this is an unpacked TypeDict for a **kwargs parameter, add another star.
                        paramTypeString = '*' + paramTypeString;
                    }
                }

                paramString += paramTypeString;

                if (isParamSpec(paramType)) {
                    if (
                        param.category === ParameterCategory.ArgsList ||
                        param.category === ParameterCategory.KwargsDict
                    ) {
                        isParamSpecArgsKwargsParam = true;
                    }
                }

                // PEP8 indicates that the "=" for the default value should have surrounding
                // spaces when used with a type annotation.
                defaultValueAssignment = ' = ';
            } else if ((printTypeFlags & PrintTypeFlags.OmitTypeArgumentsIfUnknown) === 0) {
                if (!param.isNameSynthesized) {
                    paramString += ': ';
                }
                if (printTypeFlags & (PrintTypeFlags.PrintUnknownWithAny | PrintTypeFlags.PythonSyntax)) {
                    paramString += 'Any';
                } else {
                    paramString += 'Unknown';
                }
                defaultValueAssignment = ' = ';
            }
        } else if (param.category === ParameterCategory.Simple) {
            if (sawDefinedName) {
                paramString += '/';
            } else {
                return;
            }
        }

        if (param.hasDefault) {
            if (param.defaultValueExpression) {
                paramString += defaultValueAssignment + ParseTreeUtils.printExpression(param.defaultValueExpression);
            } else {
                // If the function doesn't originate from a function declaration (e.g. it is
                // synthesized), we can't get to the default declaration, but we can still indicate
                // that there is a default value provided.
                paramString += defaultValueAssignment + '...';
            }
        }

        // If this is a (...) signature, replace the *args, **kwargs with "...".
        if (FunctionType.shouldSkipArgsKwargsCompatibilityCheck(type) && !isParamSpecArgsKwargsParam) {
            if (param.category === ParameterCategory.ArgsList) {
                paramString = '...';
            } else if (param.category === ParameterCategory.KwargsDict) {
                return;
            }
        }

        paramTypeStrings.push(paramString);
    });

    if (type.details.paramSpec) {
        if (printTypeFlags & PrintTypeFlags.PythonSyntax) {
            paramTypeStrings.push(`*args: ${type.details.paramSpec}.args`);
            paramTypeStrings.push(`**kwargs: ${type.details.paramSpec}.kwargs`);
        } else {
            paramTypeStrings.push(
                `**${printTypeInternal(
                    type.details.paramSpec,
                    printTypeFlags,
                    returnTypeCallback,
                    uniqueNameMap,
                    recursionTypes,
                    recursionCount
                )}`
            );
        }
    }

    const returnType = returnTypeCallback(type);
    const returnTypeString =
        recursionTypes.length < maxTypeRecursionCount
            ? printTypeInternal(
                  returnType,
                  printTypeFlags | PrintTypeFlags.ParenthesizeUnion | PrintTypeFlags.ParenthesizeCallable,
                  returnTypeCallback,
                  uniqueNameMap,
                  recursionTypes,
                  recursionCount
              )
            : '';

    return [paramTypeStrings, returnTypeString];
}

function _printUnpack(textToWrap: string, flags: PrintTypeFlags) {
    return flags & PrintTypeFlags.UseTypingUnpack ? `Unpack[${textToWrap}]` : `*${textToWrap}`;
}

// Surrounds a printed type with Type[...] as many times as needed
// for the nested instantiable count.
function _printNestedInstantiable(type: Type, textToWrap: string) {
    const nestedTypes = (type.instantiableNestingLevel ?? 0) + 1;

    for (let nestLevel = 0; nestLevel < nestedTypes; nestLevel++) {
        textToWrap = `type[${textToWrap}]`;
    }

    return textToWrap;
}

function _getReadableTypeVarName(type: TypeVarType, usePythonSyntax: boolean) {
    if (usePythonSyntax) {
        return type.details.name;
    }

    return TypeVarType.getReadableName(type);
}

function _getTypeVarVarianceText(type: TypeVarType) {
    const computedVariance = type.computedVariance ?? type.details.declaredVariance;
    if (computedVariance === Variance.Invariant) {
        return 'invariant';
    }

    if (computedVariance === Variance.Covariant) {
        return 'covariant';
    }

    if (computedVariance === Variance.Contravariant) {
        return 'contravariant';
    }

    return '';
}

// Represents a map of named types (classes and type aliases) that appear within
// a specified type to determine whether any of the names require disambiguation
// (i.e. their fully-qualified name is required).
class UniqueNameMap {
    private _map = new Map<string, Type[]>();

    constructor(private _printTypeFlags: PrintTypeFlags, private _returnTypeCallback: FunctionReturnTypeCallback) {}

    build(type: Type, recursionTypes: Type[] = [], recursionCount = 0) {
        if (recursionCount > maxTypeRecursionCount) {
            return;
        }
        recursionCount++;

        if (type.typeAliasInfo) {
            let expandTypeAlias = true;
            if ((this._printTypeFlags & PrintTypeFlags.ExpandTypeAlias) === 0) {
                expandTypeAlias = false;
            } else {
                if (recursionTypes.find((t) => t === type)) {
                    expandTypeAlias = false;
                }
            }

            if (!expandTypeAlias) {
                const typeAliasName =
                    (this._printTypeFlags & PrintTypeFlags.UseFullyQualifiedNames) !== 0
                        ? type.typeAliasInfo.fullName
                        : type.typeAliasInfo.name;
                this._addIfUnique(typeAliasName, type, /* useTypeAliasName */ true);

                // Recursively add the type arguments if present.
                if (type.typeAliasInfo.typeArguments) {
                    recursionTypes.push(type);

                    try {
                        type.typeAliasInfo.typeArguments.forEach((typeArg) => {
                            this.build(typeArg, recursionTypes, recursionCount);
                        });
                    } finally {
                        recursionTypes.pop();
                    }
                }

                return;
            }
        }

        try {
            recursionTypes.push(type);

            switch (type.category) {
                case TypeCategory.Function: {
                    type.details.parameters.forEach((_, index) => {
                        const paramType = FunctionType.getEffectiveParameterType(type, index);
                        this.build(paramType, recursionTypes, recursionCount);
                    });

                    const returnType = this._returnTypeCallback(type);
                    this.build(returnType, recursionTypes, recursionCount);
                    break;
                }

                case TypeCategory.OverloadedFunction: {
                    type.overloads.forEach((overload) => {
                        this.build(overload, recursionTypes, recursionCount);
                    });
                    break;
                }

                case TypeCategory.Class: {
                    if (type.literalValue !== undefined) {
                        break;
                    }

                    let className = type.aliasName;
                    if (!className) {
                        className =
                            (this._printTypeFlags & PrintTypeFlags.UseFullyQualifiedNames) !== 0
                                ? type.details.fullName
                                : type.details.name;
                    }

                    this._addIfUnique(className, type);

                    if (!ClassType.isPseudoGenericClass(type)) {
                        if (type.tupleTypeArguments) {
                            type.tupleTypeArguments.forEach((typeArg) => {
                                this.build(typeArg.type, recursionTypes, recursionCount);
                            });
                        } else if (type.typeArguments) {
                            type.typeArguments.forEach((typeArg) => {
                                this.build(typeArg, recursionTypes, recursionCount);
                            });
                        }
                    }
                    break;
                }

                case TypeCategory.Union: {
                    doForEachSubtype(type, (subtype) => {
                        this.build(subtype, recursionTypes, recursionCount);
                    });

                    type.typeAliasSources?.forEach((typeAliasSource) => {
                        this.build(typeAliasSource, recursionTypes, recursionCount);
                    });
                    break;
                }
            }
        } finally {
            recursionTypes.pop();
        }
    }

    isUnique(name: string) {
        const entry = this._map.get(name);
        return !entry || entry.length === 1;
    }

    private _addIfUnique(name: string, type: Type, useTypeAliasName = false) {
        const existingEntry = this._map.get(name);
        if (!existingEntry) {
            this._map.set(name, [type]);
        } else {
            if (!existingEntry.some((t) => this._isSameTypeName(t, type, useTypeAliasName))) {
                existingEntry.push(type);
            }
        }
    }

    private _isSameTypeName(type1: Type, type2: Type, useTypeAliasName: boolean): boolean {
        if (useTypeAliasName) {
            return type1.typeAliasInfo?.fullName === type2.typeAliasInfo?.fullName;
        }

        if (isClass(type1) && isClass(type2)) {
            return ClassType.isSameGenericClass(type1, type2);
        }

        return false;
    }
}
