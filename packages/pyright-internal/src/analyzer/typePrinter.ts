/*
 * typePrinter.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Converts a type into a string representation.
 */

import { ParameterCategory } from '../parser/parseNodes';
import { isTypedKwargs } from './parameterUtils';
import * as ParseTreeUtils from './parseTreeUtils';
import {
    ClassType,
    EnumLiteral,
    FunctionType,
    isAnyOrUnknown,
    isClassInstance,
    isInstantiableClass,
    isNever,
    isNoneInstance,
    isParamSpec,
    isTypeSame,
    isTypeVar,
    isUnpacked,
    isVariadicTypeVar,
    maxTypeRecursionCount,
    removeNoneFromUnion,
    TupleTypeArgument,
    Type,
    TypeBase,
    TypeCategory,
    TypeVarType,
} from './types';
import { convertToInstance, doForEachSubtype, isTupleClass } from './typeUtils';

const singleTickRegEx = /'/g;
const escapedDoubleQuoteRegEx = /\\"/g;

export const enum PrintTypeFlags {
    None = 0,

    // Avoid printing "Unknown" and always use "Any" instead.
    PrintUnknownWithAny = 1 << 0,

    // Omit type arguments for generic classes if they are "Any".
    OmitTypeArgumentsIfAny = 1 << 1,

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
}

export type FunctionReturnTypeCallback = (type: FunctionType) => Type;

export function printType(
    type: Type,
    printTypeFlags: PrintTypeFlags,
    returnTypeCallback: FunctionReturnTypeCallback,
    recursionTypes: Type[] = [],
    recursionCount = 0
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
                let aliasName = type.typeAliasInfo.name;
                const typeParams = type.typeAliasInfo.typeParameters;

                if (typeParams) {
                    let argumentStrings: string[] | undefined;

                    // If there is a type arguments array, it's a specialized type alias.
                    if (type.typeAliasInfo.typeArguments) {
                        if (
                            (printTypeFlags & PrintTypeFlags.OmitTypeArgumentsIfAny) === 0 ||
                            type.typeAliasInfo.typeArguments.some((typeArg) => !isAnyOrUnknown(typeArg))
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
                                    typeArg.tupleTypeArguments
                                ) {
                                    typeArg.tupleTypeArguments.forEach((tupleTypeArg) => {
                                        argumentStrings!.push(
                                            printType(
                                                tupleTypeArg.type,
                                                printTypeFlags,
                                                returnTypeCallback,
                                                recursionTypes,
                                                recursionCount
                                            )
                                        );
                                    });
                                } else {
                                    argumentStrings!.push(
                                        printType(
                                            typeArg,
                                            printTypeFlags,
                                            returnTypeCallback,
                                            recursionTypes,
                                            recursionCount
                                        )
                                    );
                                }
                            });
                        }
                    } else {
                        if (
                            (printTypeFlags & PrintTypeFlags.OmitTypeArgumentsIfAny) === 0 ||
                            typeParams.some((typeParam) => !isAnyOrUnknown(typeParam))
                        ) {
                            argumentStrings = [];
                            typeParams.forEach((typeParam) => {
                                argumentStrings!.push(
                                    printType(
                                        typeParam,
                                        printTypeFlags,
                                        returnTypeCallback,
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
                return type.typeAliasInfo.name;
            }

            try {
                recursionTypes.push(type);

                return printType(
                    type,
                    printTypeFlags & ~PrintTypeFlags.ExpandTypeAlias,
                    returnTypeCallback,
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
                        return `Literal[${printLiteralValue(type)}]`;
                    }

                    return `${printObjectTypeForClass(
                        type,
                        printTypeFlags,
                        returnTypeCallback,
                        recursionTypes
                    )}${getConditionalIndicator(type)}`;
                } else {
                    let typeToWrap: string;

                    if (type.literalValue !== undefined) {
                        typeToWrap = `Literal[${printLiteralValue(type)}]`;
                    } else {
                        typeToWrap = `${printObjectTypeForClass(
                            type,
                            printTypeFlags,
                            returnTypeCallback,
                            recursionTypes
                        )}`;
                    }

                    return `${_printNestedInstantiable(type, typeToWrap)}${getConditionalIndicator(type)}`;
                }
            }

            case TypeCategory.Function: {
                if (TypeBase.isInstantiable(type)) {
                    const typeString = printFunctionType(
                        TypeBase.cloneTypeAsInstance(type),
                        printTypeFlags,
                        returnTypeCallback,
                        recursionTypes,
                        recursionCount
                    );
                    return `Type[${typeString}]`;
                }

                return printFunctionType(
                    type,
                    originalPrintTypeFlags,
                    returnTypeCallback,
                    recursionTypes,
                    recursionCount
                );
            }

            case TypeCategory.OverloadedFunction: {
                const overloadedType = type;
                const overloads = overloadedType.overloads.map((overload) =>
                    printType(overload, printTypeFlags, returnTypeCallback, recursionTypes, recursionCount)
                );
                if (printTypeFlags & PrintTypeFlags.PythonSyntax) {
                    return 'Callable[..., Any]';
                }
                return `Overload[${overloads.join(', ')}]`;
            }

            case TypeCategory.Union: {
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

                            for (const unionSubtype of type.subtypes) {
                                if (isTypeSame(sourceSubtype, unionSubtype, { ignoreTypeFlags: true })) {
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
                                printType(
                                    typeAliasSource,
                                    updatedPrintTypeFlags,
                                    returnTypeCallback,
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

                    const optionalType = printType(
                        typeWithoutNone,
                        updatedPrintTypeFlags,
                        returnTypeCallback,
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
                            literalObjectStrings.add(printLiteralValue(subtype));
                        } else if (isInstantiableClass(subtype) && subtype.literalValue !== undefined) {
                            literalClassStrings.add(printLiteralValue(subtype));
                        } else {
                            subtypeStrings.add(
                                printType(
                                    subtype,
                                    updatedPrintTypeFlags,
                                    returnTypeCallback,
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
                    dedupedSubtypeStrings.push(`Type[Literal[${literalStrings.join(', ')}]]`);
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
                            return printType(
                                TypeBase.isInstance(type)
                                    ? convertToInstance(type.details.boundType)
                                    : type.details.boundType,
                                printTypeFlags,
                                returnTypeCallback,
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
                        let boundTypeString = printType(
                            type.details.boundType,
                            printTypeFlags & ~PrintTypeFlags.ExpandTypeAlias,
                            returnTypeCallback,
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
                    if (type.paramSpecAccess) {
                        return `${type.details.name}.${type.paramSpecAccess}`;
                    }
                    return `${_getReadableTypeVarName(type, (printTypeFlags & PrintTypeFlags.PythonSyntax) !== 0)}`;
                }

                let typeVarName = _getReadableTypeVarName(type, (printTypeFlags & PrintTypeFlags.PythonSyntax) !== 0);
                if (type.isVariadicUnpacked) {
                    typeVarName = _printUnpack(typeVarName, printTypeFlags);
                }

                if (type.isVariadicInUnion) {
                    typeVarName = `Union[${typeVarName}]`;
                }

                if (TypeBase.isInstantiable(type)) {
                    return `${_printNestedInstantiable(type, typeVarName)}`;
                }

                return typeVarName;
            }

            case TypeCategory.None: {
                return `${
                    TypeBase.isInstantiable(type) ? `${_printNestedInstantiable(type, 'None')}` : 'None'
                }${getConditionalIndicator(type)}`;
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
    recursionTypes: Type[] = [],
    recursionCount = 0
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
            returnTypeString = printType(
                returnType,
                printTypeFlags,
                returnTypeCallback,
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
                            printType(paramType, printTypeFlags, returnTypeCallback, recursionTypes, recursionCount)
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
        const parts = printFunctionParts(type, printTypeFlags, returnTypeCallback, recursionTypes);
        const paramSignature = `(${parts[0].join(', ')})`;

        if (FunctionType.isParamSpecValue(type)) {
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

export function printLiteralValue(type: ClassType, quotation = "'"): string {
    const literalValue = type.literalValue;
    if (literalValue === undefined) {
        return '';
    }

    let literalStr: string;
    if (typeof literalValue === 'string') {
        let effectiveLiteralValue = literalValue;

        // Limit the length of the string literal.
        const maxLiteralStringLength = 50;
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
                    .replace(singleTickRegEx, "\\'")}'`;
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

export function printObjectTypeForClass(
    type: ClassType,
    printTypeFlags: PrintTypeFlags,
    returnTypeCallback: FunctionReturnTypeCallback,
    recursionTypes: Type[] = [],
    recursionCount = 0
): string {
    let objName = type.aliasName || type.details.name;

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
                let isAllAny = true;

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
                            if (!isAnyOrUnknown(typeArg.type)) {
                                isAllAny = false;
                            }

                            if (index === 0) {
                                typeArgStrings.push(_printUnpack('tuple[()]', printTypeFlags));
                            }
                        } else {
                            typeArgStrings.push(
                                ...typeArg.type.tupleTypeArguments.map((typeArg) => {
                                    if (!isAnyOrUnknown(typeArg.type)) {
                                        isAllAny = false;
                                    }

                                    const typeArgText = printType(
                                        typeArg.type,
                                        printTypeFlags,
                                        returnTypeCallback,
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
                        if (!isAnyOrUnknown(typeArg.type)) {
                            isAllAny = false;
                        }

                        const typeArgTypeText = printType(
                            typeArg.type,
                            printTypeFlags,
                            returnTypeCallback,
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

                if ((printTypeFlags & PrintTypeFlags.OmitTypeArgumentsIfAny) === 0 || !isAllAny) {
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
                    (printTypeFlags & PrintTypeFlags.OmitTypeArgumentsIfAny) === 0 ||
                    typeParams.some((typeParam) => !isAnyOrUnknown(typeParam))
                ) {
                    objName +=
                        '[' +
                        typeParams
                            .map((typeParam) => {
                                return printType(
                                    typeParam,
                                    printTypeFlags,
                                    returnTypeCallback,
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

    return objName;
}

export function printFunctionParts(
    type: FunctionType,
    printTypeFlags: PrintTypeFlags,
    returnTypeCallback: FunctionReturnTypeCallback,
    recursionTypes: Type[] = [],
    recursionCount = 0
): [string[], string] {
    const paramTypeStrings: string[] = [];
    let sawDefinedName = false;

    type.details.parameters.forEach((param, index) => {
        // Handle specialized variadic type parameters specially.
        if (
            index === type.details.parameters.length - 1 &&
            param.category === ParameterCategory.VarArgList &&
            isVariadicTypeVar(param.type)
        ) {
            const specializedParamType = FunctionType.getEffectiveParameterType(type, index);
            if (
                isClassInstance(specializedParamType) &&
                ClassType.isBuiltIn(specializedParamType, 'tuple') &&
                specializedParamType.tupleTypeArguments
            ) {
                specializedParamType.tupleTypeArguments.forEach((paramType) => {
                    const paramString = printType(
                        paramType.type,
                        printTypeFlags,
                        returnTypeCallback,
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
            param.type.details.typedDictEntries!.forEach((v, k) => {
                const valueTypeString = printType(
                    v.valueType,
                    printTypeFlags,
                    returnTypeCallback,
                    recursionTypes,
                    recursionCount
                );
                paramTypeStrings.push(`${k}: ${valueTypeString}`);
            });
            return;
        }

        let paramString = '';
        if (param.category === ParameterCategory.VarArgList) {
            if (!param.name || !param.isNameSynthesized) {
                paramString += '*';
            }
        } else if (param.category === ParameterCategory.VarArgDictionary) {
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
                        ? printType(paramType, printTypeFlags, returnTypeCallback, recursionTypes, recursionCount)
                        : '';

                if (emittedParamName) {
                    paramString += ': ';
                } else if (param.category === ParameterCategory.VarArgList && !isUnpacked(paramType)) {
                    paramString += '*';
                }

                if (param.category === ParameterCategory.VarArgDictionary && isUnpacked(paramType)) {
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
                        param.category === ParameterCategory.VarArgList ||
                        param.category === ParameterCategory.VarArgDictionary
                    ) {
                        isParamSpecArgsKwargsParam = true;
                    }
                }

                // PEP8 indicates that the "=" for the default value should have surrounding
                // spaces when used with a type annotation.
                defaultValueAssignment = ' = ';
            } else if ((printTypeFlags & PrintTypeFlags.OmitTypeArgumentsIfAny) === 0) {
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
            if (param.category === ParameterCategory.VarArgList) {
                paramString = '...';
            } else if (param.category === ParameterCategory.VarArgDictionary) {
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
                `**${printType(
                    type.details.paramSpec,
                    printTypeFlags,
                    returnTypeCallback,
                    recursionTypes,
                    recursionCount
                )}`
            );
        }
    }

    const returnType = returnTypeCallback(type);
    const returnTypeString =
        recursionTypes.length < maxTypeRecursionCount
            ? printType(
                  returnType,
                  printTypeFlags | PrintTypeFlags.ParenthesizeUnion | PrintTypeFlags.ParenthesizeCallable,
                  returnTypeCallback,
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
        textToWrap = `Type[${textToWrap}]`;
    }

    return textToWrap;
}

function _getReadableTypeVarName(type: TypeVarType, usePythonSyntax: boolean) {
    if (usePythonSyntax) {
        return type.details.name;
    }

    return TypeVarType.getReadableName(type);
}
