/*
 * typePrinter.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Converts a type into a string representation.
 */

import { ParameterCategory } from '../parser/parseNodes';
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
}

export type FunctionReturnTypeCallback = (type: FunctionType) => Type;

export function printType(
    type: Type,
    printTypeFlags: PrintTypeFlags,
    returnTypeCallback: FunctionReturnTypeCallback,
    recursionTypes: Type[] = [],
    recursionCount = 0
): string {
    const parenthesizeUnion = (printTypeFlags & PrintTypeFlags.ParenthesizeUnion) !== 0;
    const parenthesizeCallable = (printTypeFlags & PrintTypeFlags.ParenthesizeCallable) !== 0;
    printTypeFlags &= ~(PrintTypeFlags.ParenthesizeUnion | PrintTypeFlags.ParenthesizeCallable);

    if (recursionCount > maxTypeRecursionCount) {
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

        const includeConditionalIndicator = (printTypeFlags & PrintTypeFlags.OmitConditionalConstraint) === 0;
        const getConditionalIndicator = (subtype: Type) => {
            return subtype.condition !== undefined && includeConditionalIndicator ? '*' : '';
        };

        switch (type.category) {
            case TypeCategory.Unbound: {
                return 'Unbound';
            }

            case TypeCategory.Unknown: {
                return (printTypeFlags & PrintTypeFlags.PrintUnknownWithAny) !== 0 ? 'Any' : 'Unknown';
            }

            case TypeCategory.Module: {
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
                // If it's a Callable with a ParamSpec, use the
                // Callable notation.
                const parts = printFunctionParts(type, printTypeFlags, returnTypeCallback, recursionTypes);
                const paramSignature = `(${parts[0].join(', ')})`;
                if (FunctionType.isParamSpecValue(type)) {
                    return paramSignature;
                }
                const fullSignature = `${paramSignature} -> ${parts[1]}`;

                if (parenthesizeCallable) {
                    return `(${fullSignature})`;
                }

                return fullSignature;
            }

            case TypeCategory.OverloadedFunction: {
                const overloadedType = type;
                const overloads = overloadedType.overloads.map((overload) =>
                    printType(overload, printTypeFlags, returnTypeCallback, recursionTypes, recursionCount)
                );
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
                            boundTypeString = `Self@${boundTypeString}`;
                        }

                        if (TypeBase.isInstantiable(type)) {
                            return `${_printNestedInstantiable(type, boundTypeString)}`;
                        }

                        return boundTypeString;
                    }

                    return (printTypeFlags & PrintTypeFlags.PrintUnknownWithAny) !== 0 ? 'Any' : 'Unknown';
                }

                if (type.details.isParamSpec) {
                    if (type.paramSpecAccess) {
                        return `${type.details.name}.${type.paramSpecAccess}`;
                    }
                    return `${TypeVarType.getReadableName(type)}`;
                }

                let typeVarName = TypeVarType.getReadableName(type);

                if (type.isVariadicUnpacked) {
                    typeVarName = `*${typeVarName}`;
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

export function printLiteralValue(type: ClassType, quotation = "'"): string {
    const literalValue = type.literalValue;
    if (literalValue === undefined) {
        return '';
    }

    let literalStr: string;
    if (typeof literalValue === 'string') {
        const prefix = type.details.name === 'bytes' ? 'b' : '';

        // Limit the length of the string literal.
        let effectiveLiteralValue = literalValue;
        const maxLiteralStringLength = 50;
        if (literalValue.length > maxLiteralStringLength) {
            effectiveLiteralValue = literalValue.substring(0, maxLiteralStringLength) + '…';
        }

        // JSON.stringify will perform proper escaping for " case.
        // So, we only need to do our own escaping for ' case.
        literalStr = JSON.stringify(effectiveLiteralValue).toString();
        if (quotation !== '"') {
            literalStr = `'${literalStr
                .substring(1, literalStr.length - 1)
                .replace(escapedDoubleQuoteRegEx, '"')
                .replace(singleTickRegEx, "\\'")}'`;
        }

        if (prefix) {
            literalStr = `${prefix}${literalStr}`;
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
                                typeArgStrings.push('*tuple[()]');
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
                                        return `*tuple[${typeArgText}, ...]`;
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
                                typeArgStrings.push(`*tuple[${typeArgTypeText}, ...]`);
                            }
                        } else {
                            typeArgStrings.push(typeArgTypeText);
                        }
                    }
                });

                if (type.isUnpacked) {
                    objName = '*' + objName;
                }

                if ((printTypeFlags & PrintTypeFlags.OmitTypeArgumentsIfAny) === 0 || !isAllAny) {
                    objName += '[' + typeArgStrings.join(', ') + ']';
                }
            } else {
                if (type.isUnpacked) {
                    objName = '*' + objName;
                }

                if (ClassType.isTupleClass(type) || isVariadic) {
                    objName += '[()]';
                }
            }
        } else {
            if (type.isUnpacked) {
                objName = '*' + objName;
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

        let paramString = '';
        if (param.category === ParameterCategory.VarArgList) {
            if (!param.name || !param.isNameSynthesized) {
                paramString += '*';
            }
        } else if (param.category === ParameterCategory.VarArgDictionary) {
            paramString += '**';
        }

        if (param.name && !param.isNameSynthesized) {
            paramString += param.name;
            sawDefinedName = true;
        }

        let defaultValueAssignment = '=';
        let isParamSpecArgsKwargsParam = false;

        if (param.name) {
            // Avoid printing type types if parameter have unknown type.
            if (param.hasDeclaredType || param.isTypeInferred) {
                const paramType = FunctionType.getEffectiveParameterType(type, index);
                const paramTypeString =
                    recursionTypes.length < maxTypeRecursionCount
                        ? printType(paramType, printTypeFlags, returnTypeCallback, recursionTypes, recursionCount)
                        : '';

                if (!param.isNameSynthesized) {
                    paramString += ': ';
                } else if (param.category === ParameterCategory.VarArgList && !isUnpacked(paramType)) {
                    paramString += '*';
                }

                // If this is an unpacked TypeDict for a **kwargs parameter, add another star.
                if (param.category === ParameterCategory.VarArgDictionary && isUnpacked(paramType)) {
                    paramString += '*';
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
                paramString += 'Unknown';
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
        paramTypeStrings.push(
            `**${printType(type.details.paramSpec, printTypeFlags, returnTypeCallback, recursionTypes, recursionCount)}`
        );
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

// Surrounds a printed type with Type[...] as many times as needed
// for the nested instantiable count.
function _printNestedInstantiable(type: Type, textToWrap: string) {
    const nestedTypes = (type.instantiableNestingLevel ?? 0) + 1;

    for (let nestLevel = 0; nestLevel < nestedTypes; nestLevel++) {
        textToWrap = `Type[${textToWrap}]`;
    }

    return textToWrap;
}
