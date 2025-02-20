/*
 * typePrinter.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Converts a type into a string representation.
 */

import { appendArray } from '../common/collectionUtils';
import { ConfigOptions } from '../common/configOptions';
import { assert } from '../common/debug';
import { ParamCategory } from '../parser/parseNodes';
import { isTypedKwargs } from './parameterUtils';
import * as ParseTreeUtils from './parseTreeUtils';
import { printBytesLiteral, printStringLiteral } from './typePrinterUtils';
import {
    ClassType,
    EnumLiteral,
    FunctionParam,
    FunctionType,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isInstantiableClass,
    isNever,
    isParamSpec,
    isTypeSame,
    isTypeVar,
    isTypeVarTuple,
    isUnknown,
    isUnpacked,
    maxTypeRecursionCount,
    OverloadedType,
    TupleTypeArg,
    Type,
    TypeBase,
    TypeCategory,
    TypeVarType,
    UnionType,
    Variance,
} from './types';
import { convertToInstance, doForEachSubtype, isNoneInstance, isTupleClass, removeNoneFromUnion } from './typeUtils';

export const enum PrintTypeFlags {
    None = 0,

    // Avoid printing "Unknown" and always use "Any" instead.
    PrintUnknownWithAny = 1 << 0,

    // Omit type arguments for generic classes if they are "Unknown".
    OmitTypeArgsIfUnknown = 1 << 1,

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

    // Omit TypeVar scopes.
    OmitTypeVarScope = 1 << 13,
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
    if (typeof type.priv.literalValue === 'string') {
        if (type.priv.literalValue.length > maxLiteralStringLength) {
            return true;
        }
    }

    return false;
}

export function printLiteralValueTruncated(type: ClassType): string {
    if (type.shared.name === 'bytes') {
        return 'bytes';
    }

    assert(type.shared.name === 'str');
    return 'LiteralString';
}

export function printLiteralValue(type: ClassType, quotation = "'"): string {
    const literalValue = type.priv.literalValue;
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

        if (type.shared.name === 'bytes') {
            literalStr = printBytesLiteral(effectiveLiteralValue);
        } else {
            literalStr = printStringLiteral(effectiveLiteralValue, quotation);
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
    if (recursionCount > maxTypeRecursionCount) {
        if (printTypeFlags & PrintTypeFlags.PythonSyntax) {
            return 'Any';
        }
        return '<Recursive>';
    }
    recursionCount++;

    const originalPrintTypeFlags = printTypeFlags;
    const parenthesizeUnion = (printTypeFlags & PrintTypeFlags.ParenthesizeUnion) !== 0;
    printTypeFlags &= ~(PrintTypeFlags.ParenthesizeUnion | PrintTypeFlags.ParenthesizeCallable);

    // If this is a type alias, see if we should use its name rather than
    // the type it represents.
    const aliasInfo = type.props?.typeAliasInfo;
    if (aliasInfo) {
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
                        ? aliasInfo.shared.fullName
                        : aliasInfo.shared.name;

                // Use the fully-qualified name if the name isn't unique.
                if (!uniqueNameMap.isUnique(aliasName)) {
                    aliasName = aliasInfo.shared.fullName;
                }

                const typeParams = aliasInfo.shared.typeParams;

                if (typeParams && typeParams.length > 0) {
                    let argumentStrings: string[] | undefined;

                    // If there is a type arguments array, it's a specialized type alias.
                    if (aliasInfo.typeArgs) {
                        if (
                            (printTypeFlags & PrintTypeFlags.OmitTypeArgsIfUnknown) === 0 ||
                            aliasInfo.typeArgs.some((typeArg) => !isUnknown(typeArg))
                        ) {
                            argumentStrings = [];
                            aliasInfo.typeArgs.forEach((typeArg, index) => {
                                // Which type parameter does this map to?
                                const typeParam =
                                    index < typeParams.length ? typeParams[index] : typeParams[typeParams.length - 1];

                                // If this type argument maps to a TypeVarTuple, unpack it.
                                if (
                                    isTypeVarTuple(typeParam) &&
                                    isClassInstance(typeArg) &&
                                    isTupleClass(typeArg) &&
                                    typeArg.priv.tupleTypeArgs &&
                                    typeArg.priv.tupleTypeArgs.every((typeArg) => !typeArg.isUnbounded)
                                ) {
                                    typeArg.priv.tupleTypeArgs.forEach((tupleTypeArg) => {
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
                            (printTypeFlags & PrintTypeFlags.OmitTypeArgsIfUnknown) === 0 ||
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
                (!!t.props?.typeAliasInfo && t.props.typeAliasInfo.shared.fullName === aliasInfo?.shared.fullName)
        ) ||
        recursionTypes.length > maxTypeRecursionCount
    ) {
        // If this is a recursive TypeVar, we've already expanded it once, so
        // just print its name at this point.
        if (isTypeVar(type) && type.shared.isSynthesized && type.shared.recursiveAlias) {
            return type.shared.recursiveAlias.name;
        }

        if (aliasInfo) {
            if (!aliasInfo.shared.typeParams) {
                let name =
                    (printTypeFlags & PrintTypeFlags.UseFullyQualifiedNames) !== 0
                        ? aliasInfo.shared.fullName
                        : aliasInfo.shared.name;
                if (!uniqueNameMap.isUnique(name)) {
                    name = aliasInfo.shared.fullName;
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
            return !!subtype.props?.condition && includeConditionalIndicator ? '*' : '';
        };
        const printWrappedType = (type: Type, typeToWrap: string) => {
            return `${_printNestedInstantiable(type, typeToWrap)}${getConditionalIndicator(type)}`;
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
                return `Module("${type.priv.moduleName}")`;
            }

            case TypeCategory.Class: {
                if (TypeBase.isInstance(type)) {
                    if (type.priv.literalValue !== undefined) {
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

                    if (type.priv.literalValue !== undefined) {
                        if (isLiteralValueTruncated(type) && (printTypeFlags & PrintTypeFlags.PythonSyntax) !== 0) {
                            typeToWrap = printLiteralValueTruncated(type);
                        } else {
                            typeToWrap = `Literal[${printLiteralValue(type)}]`;
                        }

                        return printWrappedType(type, typeToWrap);
                    }

                    if (type.props?.specialForm) {
                        const specialFormText = printTypeInternal(
                            type.props.specialForm,
                            printTypeFlags,
                            returnTypeCallback,
                            uniqueNameMap,
                            recursionTypes,
                            recursionCount
                        );

                        return specialFormText;
                    }

                    typeToWrap = printObjectTypeForClassInternal(
                        type,
                        printTypeFlags,
                        returnTypeCallback,
                        uniqueNameMap,
                        recursionTypes,
                        recursionCount
                    );

                    return printWrappedType(type, typeToWrap);
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

            case TypeCategory.Overloaded: {
                const overloads = OverloadedType.getOverloads(type).map((overload) =>
                    printTypeInternal(
                        overload,
                        printTypeFlags,
                        returnTypeCallback,
                        uniqueNameMap,
                        recursionTypes,
                        recursionCount
                    )
                );

                if ((printTypeFlags & PrintTypeFlags.PythonSyntax) !== 0) {
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
                if (TypeBase.isInstantiable(type) && type.props?.specialForm && !type.props?.typeAliasInfo) {
                    const specialFormText = printTypeInternal(
                        type.props.specialForm,
                        printTypeFlags,
                        returnTypeCallback,
                        uniqueNameMap,
                        recursionTypes,
                        recursionCount
                    );

                    return specialFormText;
                }

                // If we're using "|" notation, enclose callable subtypes in parens.
                const updatedPrintTypeFlags =
                    printTypeFlags & PrintTypeFlags.PEP604
                        ? printTypeFlags | PrintTypeFlags.ParenthesizeCallable
                        : printTypeFlags;

                return printUnionType(
                    type,
                    updatedPrintTypeFlags,
                    parenthesizeUnion,
                    returnTypeCallback,
                    uniqueNameMap,
                    recursionTypes,
                    recursionCount
                );
            }

            case TypeCategory.TypeVar: {
                // If it's synthesized, don't expose the internal name we generated.
                // This will confuse users. The exception is if it's a bound synthesized
                // type, in which case we'll print the bound type. This is used for
                // "self" and "cls" parameters.
                if (type.shared.isSynthesized) {
                    // If it's a synthesized type var used to implement recursive type
                    // aliases, return the type alias name.
                    if (type.shared.recursiveAlias) {
                        if ((printTypeFlags & PrintTypeFlags.ExpandTypeAlias) !== 0 && type.shared.boundType) {
                            return printTypeInternal(
                                TypeBase.isInstance(type)
                                    ? convertToInstance(type.shared.boundType)
                                    : type.shared.boundType,
                                printTypeFlags,
                                returnTypeCallback,
                                uniqueNameMap,
                                recursionTypes,
                                recursionCount
                            );
                        }
                        return type.shared.recursiveAlias.name;
                    }

                    // If it's a synthesized type var used to implement `self` or `cls` types,
                    // print the type with a special character that indicates that the type
                    // is internally represented as a TypeVar.
                    if (TypeVarType.isSelf(type) && type.shared.boundType) {
                        let boundTypeString = printTypeInternal(
                            type.shared.boundType,
                            printTypeFlags & ~PrintTypeFlags.ExpandTypeAlias,
                            returnTypeCallback,
                            uniqueNameMap,
                            recursionTypes,
                            recursionCount
                        );

                        if (!isAnyOrUnknown(type.shared.boundType)) {
                            if (
                                (printTypeFlags & PrintTypeFlags.PythonSyntax) === 0 &&
                                (printTypeFlags & PrintTypeFlags.OmitTypeVarScope) === 0
                            ) {
                                boundTypeString = `Self@${boundTypeString}`;
                            } else {
                                boundTypeString = `Self`;
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

                if (isParamSpec(type)) {
                    const paramSpecText = getReadableTypeVarName(
                        type,
                        (printTypeFlags & PrintTypeFlags.PythonSyntax) === 0 &&
                            (printTypeFlags & PrintTypeFlags.OmitTypeVarScope) === 0
                    );

                    if (type.priv.paramSpecAccess) {
                        return `${paramSpecText}.${type.priv.paramSpecAccess}`;
                    }
                    return paramSpecText;
                }

                let typeVarName = getReadableTypeVarName(
                    type,
                    (printTypeFlags & PrintTypeFlags.PythonSyntax) === 0 &&
                        (printTypeFlags & PrintTypeFlags.OmitTypeVarScope) === 0
                );

                if (type.priv.isUnpacked) {
                    typeVarName = printUnpack(typeVarName, printTypeFlags);
                }

                if (isTypeVarTuple(type) && type.priv.isInUnion) {
                    typeVarName = `Union[${typeVarName}]`;
                }

                if (TypeBase.isInstantiable(type)) {
                    typeVarName = `${_printNestedInstantiable(type, typeVarName)}`;
                }

                if (!isTypeVarTuple(type) && (printTypeFlags & PrintTypeFlags.PrintTypeVarVariance) !== 0) {
                    const varianceText = getTypeVarVarianceText(type);
                    if (varianceText) {
                        typeVarName = `${typeVarName} (${varianceText})`;
                    }
                }

                return typeVarName;
            }

            case TypeCategory.Never: {
                return type.priv.isNoReturn ? 'NoReturn' : 'Never';
            }

            case TypeCategory.Any: {
                const anyType = type;
                return anyType.priv.isEllipsis ? '...' : 'Any';
            }
        }

        return '';
    } finally {
        recursionTypes.pop();
    }
}

function printUnionType(
    type: UnionType,
    printTypeFlags: PrintTypeFlags,
    parenthesizeUnion: boolean,
    returnTypeCallback: FunctionReturnTypeCallback,
    uniqueNameMap: UniqueNameMap,
    recursionTypes: Type[],
    recursionCount: number
) {
    // Allocate a set that refers to subtypes in the union by
    // their indices. If the index is within the set, it is already
    // accounted for in the output.
    const subtypeHandledSet = new Set<number>();

    // Allocate another set that represents the textual representations
    // of the subtypes in the union.
    const subtypeStrings = new Set<string>();

    // Start by matching possible type aliases to the subtypes.
    if ((printTypeFlags & PrintTypeFlags.ExpandTypeAlias) === 0 && type.priv.typeAliasSources) {
        for (const typeAliasSource of type.priv.typeAliasSources) {
            let matchedAllSubtypes = true;
            let allSubtypesPreviouslyHandled = true;
            const indicesCoveredByTypeAlias = new Set<number>();

            for (const sourceSubtype of typeAliasSource.priv.subtypes) {
                let unionSubtypeIndex = 0;
                let foundMatch = false;
                const sourceSubtypeInstance = convertToInstance(sourceSubtype);

                for (const unionSubtype of type.priv.subtypes) {
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
                        printTypeFlags,
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

    const noneIndex = type.priv.subtypes.findIndex((subtype) => isNoneInstance(subtype));
    if (noneIndex >= 0 && !subtypeHandledSet.has(noneIndex)) {
        const typeWithoutNone = removeNoneFromUnion(type);
        if (isNever(typeWithoutNone)) {
            return 'None';
        }

        const optionalType = printTypeInternal(
            typeWithoutNone,
            printTypeFlags,
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
            if (isClassInstance(subtype) && subtype.priv.literalValue !== undefined) {
                if (isLiteralValueTruncated(subtype) && (printTypeFlags & PrintTypeFlags.PythonSyntax) !== 0) {
                    subtypeStrings.add(printLiteralValueTruncated(subtype));
                } else {
                    literalObjectStrings.add(printLiteralValue(subtype));
                }
            } else if (isInstantiableClass(subtype) && subtype.priv.literalValue !== undefined) {
                if (isLiteralValueTruncated(subtype) && (printTypeFlags & PrintTypeFlags.PythonSyntax) !== 0) {
                    subtypeStrings.add(`type[${printLiteralValueTruncated(subtype)}]`);
                } else {
                    literalClassStrings.add(printLiteralValue(subtype));
                }
            } else {
                subtypeStrings.add(
                    printTypeInternal(
                        subtype,
                        printTypeFlags,
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

function printFunctionType(
    type: FunctionType,
    printTypeFlags: PrintTypeFlags,
    returnTypeCallback: FunctionReturnTypeCallback,
    uniqueNameMap: UniqueNameMap,
    recursionTypes: Type[],
    recursionCount: number
) {
    if (printTypeFlags & PrintTypeFlags.PythonSyntax) {
        const paramSpec = FunctionType.getParamSpecFromArgsKwargs(type);
        const typeWithoutParamSpec = paramSpec ? FunctionType.cloneRemoveParamSpecArgsKwargs(type) : type;

        // Callable works only in cases where all parameters are positional-only.
        let isPositionalParamsOnly = false;
        if (typeWithoutParamSpec.shared.parameters.length === 0) {
            isPositionalParamsOnly = true;
        } else {
            if (typeWithoutParamSpec.shared.parameters.every((param) => param.category === ParamCategory.Simple)) {
                const lastParam =
                    typeWithoutParamSpec.shared.parameters[typeWithoutParamSpec.shared.parameters.length - 1];
                if (!lastParam.name) {
                    isPositionalParamsOnly = true;
                }
            }
        }

        const returnType = returnTypeCallback(typeWithoutParamSpec);
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

            typeWithoutParamSpec.shared.parameters.forEach((param, index) => {
                if (param.name) {
                    const paramType = FunctionType.getParamType(typeWithoutParamSpec, index);
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

            if (paramSpec) {
                if (paramTypes.length > 0) {
                    return `Callable[Concatenate[${paramTypes.join(', ')}, ${
                        paramSpec.shared.name
                    }], ${returnTypeString}]`;
                }

                return `Callable[${paramSpec.shared.name}, ${returnTypeString}]`;
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
    let objName = type.priv.aliasName;
    if (!objName) {
        objName =
            (printTypeFlags & PrintTypeFlags.UseFullyQualifiedNames) !== 0 ? type.shared.fullName : type.shared.name;
    }

    // Special-case NoneType to convert it to None.
    if (ClassType.isBuiltIn(type, 'NoneType')) {
        objName = 'None';
    }

    // Use the fully-qualified name if the name isn't unique.
    if (!uniqueNameMap.isUnique(objName)) {
        objName = type.shared.fullName;
    }

    // If this is a pseudo-generic class, don't display the type arguments
    // or type parameters because it will confuse users.
    if (!ClassType.isPseudoGenericClass(type)) {
        const typeParams = ClassType.getTypeParams(type);
        const lastTypeParam = typeParams.length > 0 ? typeParams[typeParams.length - 1] : undefined;
        const isVariadic = lastTypeParam ? isTypeVarTuple(lastTypeParam) : false;

        // If there is a type arguments array, it's a specialized class.
        const typeArgs: TupleTypeArg[] | undefined =
            type.priv.tupleTypeArgs ??
            type.priv.typeArgs?.map((t) => {
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
                        isTypeVarTuple(typeParam) &&
                        isClassInstance(typeArg.type) &&
                        ClassType.isBuiltIn(typeArg.type, 'tuple') &&
                        typeArg.type.priv.tupleTypeArgs
                    ) {
                        // Expand the tuple type that maps to the TypeVarTuple.
                        if (typeArg.type.priv.tupleTypeArgs.length === 0) {
                            if (!isUnknown(typeArg.type)) {
                                isAllUnknown = false;
                            }

                            if (index === 0) {
                                typeArgStrings.push(printUnpack('tuple[()]', printTypeFlags));
                            }
                        } else {
                            appendArray(
                                typeArgStrings,
                                typeArg.type.priv.tupleTypeArgs.map((typeArg) => {
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
                                        return printUnpack(`tuple[${typeArgText}, ...]`, printTypeFlags);
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
                                typeArgStrings.push(printUnpack(`tuple[${typeArgTypeText}, ...]`, printTypeFlags));
                            }
                        } else {
                            typeArgStrings.push(typeArgTypeText);
                        }
                    }
                });

                if (type.priv.isUnpacked) {
                    objName = printUnpack(objName, printTypeFlags);
                }

                if ((printTypeFlags & PrintTypeFlags.OmitTypeArgsIfUnknown) === 0 || !isAllUnknown) {
                    objName += '[' + typeArgStrings.join(', ') + ']';
                }
            } else {
                if (type.priv.isUnpacked) {
                    objName = printUnpack(objName, printTypeFlags);
                }

                if (ClassType.isTupleClass(type) || isVariadic) {
                    objName += '[()]';
                }
            }
        } else {
            if (type.priv.isUnpacked) {
                objName = printUnpack(objName, printTypeFlags);
            }

            if (typeParams.length > 0) {
                if (
                    (printTypeFlags & PrintTypeFlags.OmitTypeArgsIfUnknown) === 0 ||
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
    if (type.priv.isTypedDictPartial) {
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

    // Remove the (*args: P.args, **kwargs: P.kwargs) from the end of the parameter list.
    const paramSpec = FunctionType.getParamSpecFromArgsKwargs(type);
    if (paramSpec) {
        type = FunctionType.cloneRemoveParamSpecArgsKwargs(type);
    }

    type.shared.parameters.forEach((param, index) => {
        const paramType = FunctionType.getParamType(type, index);
        const defaultType = FunctionType.getParamDefaultType(type, index);

        // Handle specialized TypeVarTuples specially.
        if (
            index === type.shared.parameters.length - 1 &&
            param.category === ParamCategory.ArgsList &&
            isTypeVarTuple(paramType)
        ) {
            const specializedParamType = FunctionType.getParamType(type, index);
            if (
                isClassInstance(specializedParamType) &&
                ClassType.isBuiltIn(specializedParamType, 'tuple') &&
                specializedParamType.priv.tupleTypeArgs
            ) {
                specializedParamType.priv.tupleTypeArgs.forEach((paramType) => {
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
            isTypedKwargs(param, paramType) &&
            printTypeFlags & PrintTypeFlags.ExpandTypedDictArgs &&
            paramType.category === TypeCategory.Class
        ) {
            paramType.shared.typedDictEntries!.knownItems.forEach((v, k) => {
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
        if (param.category === ParamCategory.ArgsList) {
            if (!param.name || !FunctionParam.isNameSynthesized(param)) {
                paramString += '*';
            }
        } else if (param.category === ParamCategory.KwargsDict) {
            paramString += '**';
        }

        let emittedParamName = false;
        if (param.name && !FunctionParam.isNameSynthesized(param)) {
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
            if (FunctionParam.isTypeDeclared(param) || FunctionParam.isTypeInferred(param)) {
                const paramType = FunctionType.getParamType(type, index);
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
                } else if (param.category === ParamCategory.ArgsList && !isUnpacked(paramType)) {
                    paramString += '*';
                }

                if (param.category === ParamCategory.KwargsDict && isUnpacked(paramType)) {
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
                    if (param.category === ParamCategory.ArgsList || param.category === ParamCategory.KwargsDict) {
                        isParamSpecArgsKwargsParam = true;
                    }
                }

                // PEP8 indicates that the "=" for the default value should have surrounding
                // spaces when used with a type annotation.
                defaultValueAssignment = ' = ';
            } else if ((printTypeFlags & PrintTypeFlags.OmitTypeArgsIfUnknown) === 0) {
                if (!FunctionParam.isNameSynthesized(param)) {
                    paramString += ': ';
                }
                if (printTypeFlags & (PrintTypeFlags.PrintUnknownWithAny | PrintTypeFlags.PythonSyntax)) {
                    paramString += 'Any';
                } else {
                    paramString += 'Unknown';
                }
                defaultValueAssignment = ' = ';
            }
        } else if (param.category === ParamCategory.Simple) {
            if (sawDefinedName) {
                paramString += '/';
            } else {
                return;
            }
        }

        if (defaultType) {
            if (param.defaultExpr) {
                paramString += defaultValueAssignment + ParseTreeUtils.printExpression(param.defaultExpr);
            } else {
                // If the function doesn't originate from a function declaration (e.g. it is
                // synthesized), we can't get to the default declaration, but we can still indicate
                // that there is a default value provided.
                paramString += defaultValueAssignment + '...';
            }
        }

        // If this is a (...) signature, replace the *args, **kwargs with "...".
        if (FunctionType.isGradualCallableForm(type) && !isParamSpecArgsKwargsParam) {
            if (param.category === ParamCategory.ArgsList) {
                paramString = '...';
            } else if (param.category === ParamCategory.KwargsDict) {
                return;
            }
        }

        paramTypeStrings.push(paramString);
    });

    if (paramSpec) {
        if (printTypeFlags & PrintTypeFlags.PythonSyntax) {
            paramTypeStrings.push(`*args: ${paramSpec}.args`);
            paramTypeStrings.push(`**kwargs: ${paramSpec}.kwargs`);
        } else {
            paramTypeStrings.push(
                `**${printTypeInternal(
                    paramSpec,
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

function printUnpack(textToWrap: string, flags: PrintTypeFlags) {
    return flags & PrintTypeFlags.UseTypingUnpack ? `Unpack[${textToWrap}]` : `*${textToWrap}`;
}

// Surrounds a printed type with Type[...] as many times as needed
// for the nested instantiable count.
function _printNestedInstantiable(type: Type, textToWrap: string) {
    const nestedTypes = (type.props?.instantiableDepth ?? 0) + 1;

    for (let nestLevel = 0; nestLevel < nestedTypes; nestLevel++) {
        textToWrap = `type[${textToWrap}]`;
    }

    return textToWrap;
}

function getReadableTypeVarName(type: TypeVarType, includeScope: boolean) {
    return TypeVarType.getReadableName(type, includeScope);
}

function getTypeVarVarianceText(type: TypeVarType) {
    const computedVariance = type.priv.computedVariance ?? type.shared.declaredVariance;
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

        const aliasInfo = type.props?.typeAliasInfo;
        if (aliasInfo) {
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
                        ? aliasInfo.shared.fullName
                        : aliasInfo.shared.name;
                this._addIfUnique(typeAliasName, type, /* useTypeAliasName */ true);

                // Recursively add the type arguments if present.
                if (aliasInfo.typeArgs) {
                    recursionTypes.push(type);

                    try {
                        aliasInfo.typeArgs.forEach((typeArg) => {
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
                    type.shared.parameters.forEach((_, index) => {
                        const paramType = FunctionType.getParamType(type, index);
                        this.build(paramType, recursionTypes, recursionCount);
                    });

                    const returnType = this._returnTypeCallback(type);
                    this.build(returnType, recursionTypes, recursionCount);
                    break;
                }

                case TypeCategory.Overloaded: {
                    OverloadedType.getOverloads(type).forEach((overload) => {
                        this.build(overload, recursionTypes, recursionCount);
                    });
                    break;
                }

                case TypeCategory.Class: {
                    if (type.priv.literalValue !== undefined) {
                        break;
                    }

                    let className = type.priv.aliasName;
                    if (!className) {
                        className =
                            (this._printTypeFlags & PrintTypeFlags.UseFullyQualifiedNames) !== 0
                                ? type.shared.fullName
                                : type.shared.name;
                    }

                    this._addIfUnique(className, type);

                    if (!ClassType.isPseudoGenericClass(type)) {
                        if (type.priv.tupleTypeArgs) {
                            type.priv.tupleTypeArgs.forEach((typeArg) => {
                                this.build(typeArg.type, recursionTypes, recursionCount);
                            });
                        } else if (type.priv.typeArgs) {
                            type.priv.typeArgs.forEach((typeArg) => {
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

                    type.priv.typeAliasSources?.forEach((typeAliasSource) => {
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
            return type1.props?.typeAliasInfo?.shared.fullName === type2.props?.typeAliasInfo?.shared.fullName;
        }

        if (isClass(type1) && isClass(type2)) {
            while (TypeBase.isInstantiable(type1)) {
                type1 = ClassType.cloneAsInstance(type1);
            }

            while (TypeBase.isInstantiable(type2)) {
                type2 = ClassType.cloneAsInstance(type2);
            }

            return ClassType.isSameGenericClass(type1, type2);
        }

        return false;
    }
}

export function getPrintTypeFlags(configOptions: ConfigOptions): PrintTypeFlags {
    let flags = PrintTypeFlags.None;

    if (configOptions.diagnosticRuleSet.printUnknownAsAny) {
        flags |= PrintTypeFlags.PrintUnknownWithAny;
    }

    if (configOptions.diagnosticRuleSet.omitConditionalConstraint) {
        flags |= PrintTypeFlags.OmitConditionalConstraint;
    }

    if (configOptions.diagnosticRuleSet.omitTypeArgsIfUnknown) {
        flags |= PrintTypeFlags.OmitTypeArgsIfUnknown;
    }

    if (configOptions.diagnosticRuleSet.omitUnannotatedParamType) {
        flags |= PrintTypeFlags.OmitUnannotatedParamType;
    }

    if (configOptions.diagnosticRuleSet.pep604Printing) {
        flags |= PrintTypeFlags.PEP604;
    }

    return flags;
}
