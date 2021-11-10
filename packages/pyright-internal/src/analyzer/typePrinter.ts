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
    isNone,
    isParamSpec,
    isTypeSame,
    isVariadicTypeVar,
    maxTypeRecursionCount,
    removeNoneFromUnion,
    Type,
    TypeBase,
    TypeCategory,
    TypeVarType,
} from './types';
import { doForEachSubtype, isTupleClass } from './typeUtils';

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
}

export type FunctionReturnTypeCallback = (type: FunctionType) => Type;

export function printType(
    type: Type,
    printTypeFlags: PrintTypeFlags,
    returnTypeCallback: FunctionReturnTypeCallback,
    recursionTypes: Type[] = []
): string {
    const parenthesizeUnion = (printTypeFlags & PrintTypeFlags.ParenthesizeUnion) !== 0;
    printTypeFlags &= ~PrintTypeFlags.ParenthesizeUnion;

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
                                            printType(tupleTypeArg, printTypeFlags, returnTypeCallback, recursionTypes)
                                        );
                                    });
                                } else {
                                    argumentStrings!.push(
                                        printType(typeArg, printTypeFlags, returnTypeCallback, recursionTypes)
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
                                    printType(typeParam, printTypeFlags, returnTypeCallback, recursionTypes)
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

    if (recursionTypes.find((t) => t === type) || recursionTypes.length > maxTypeRecursionCount) {
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
                    if (type.literalValue !== undefined) {
                        return `Type[Literal[${printLiteralValue(type)}]]${getConditionalIndicator(type)}`;
                    }

                    return `Type[${printObjectTypeForClass(
                        type,
                        printTypeFlags,
                        returnTypeCallback,
                        recursionTypes
                    )}]${getConditionalIndicator(type)}`;
                }
            }

            case TypeCategory.Function: {
                // If it's a Callable with a ParamSpec, use the
                // Callable notation.
                const parts = printFunctionParts(type, printTypeFlags, returnTypeCallback, recursionTypes);
                if (type.details.paramSpec) {
                    if (type.details.parameters.length > 0) {
                        // Remove the args and kwargs parameters from the end.
                        const paramTypes = type.details.parameters.map((param) => {
                            if (!param.name) {
                                return param.category === ParameterCategory.Simple ? '/' : '*';
                            }
                            return printType(param.type, printTypeFlags, returnTypeCallback, recursionTypes);
                        });
                        return `Callable[Concatenate[${paramTypes.join(', ')}, ${TypeVarType.getReadableName(
                            type.details.paramSpec
                        )}], ${parts[1]}]`;
                    }
                    return `Callable[${TypeVarType.getReadableName(type.details.paramSpec)}, ${parts[1]}]`;
                }

                const paramSignature = `(${parts[0].join(', ')})`;
                if (FunctionType.isParamSpecValue(type)) {
                    return paramSignature;
                }
                return `${paramSignature} -> ${parts[1]}`;
            }

            case TypeCategory.OverloadedFunction: {
                const overloadedType = type;
                const overloads = overloadedType.overloads.map((overload) =>
                    printType(overload, printTypeFlags, returnTypeCallback, recursionTypes)
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
                                if (
                                    isTypeSame(
                                        sourceSubtype,
                                        unionSubtype,
                                        /* ignorePseudoGeneric */ undefined,
                                        /* ignoreTypeFlags */ true
                                    )
                                ) {
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
                                printType(typeAliasSource, printTypeFlags, returnTypeCallback, recursionTypes)
                            );
                            indicesCoveredByTypeAlias.forEach((index) => subtypeHandledSet.add(index));
                        }
                    }
                }

                const noneIndex = type.subtypes.findIndex((subtype) => isNone(subtype));
                if (noneIndex >= 0 && !subtypeHandledSet.has(noneIndex)) {
                    const typeWithoutNone = removeNoneFromUnion(type);
                    if (isNever(typeWithoutNone)) {
                        return 'None';
                    }

                    const optionalType = printType(typeWithoutNone, printTypeFlags, returnTypeCallback, recursionTypes);

                    if (printTypeFlags & PrintTypeFlags.PEP604) {
                        return optionalType + ' | None';
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
                            subtypeStrings.add(printType(subtype, printTypeFlags, returnTypeCallback, recursionTypes));
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
                                type.details.boundType,
                                printTypeFlags,
                                returnTypeCallback,
                                recursionTypes
                            );
                        }
                        return type.details.recursiveTypeAliasName;
                    }

                    // If it's a synthesized type var used to implement `self` or `cls` types,
                    // print the type with a special character that indicates that the type
                    // is internally represented as a TypeVar.
                    if (type.details.isSynthesizedSelfCls && type.details.boundType) {
                        let boundTypeString = printType(
                            type.details.boundType,
                            printTypeFlags & ~PrintTypeFlags.ExpandTypeAlias,
                            returnTypeCallback,
                            recursionTypes
                        );

                        if (!isAnyOrUnknown(type.details.boundType)) {
                            boundTypeString = `Self@${boundTypeString}`;
                        }

                        if (TypeBase.isInstantiable(type)) {
                            return `Type[${boundTypeString}]`;
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
                    return `Type[${typeVarName}]`;
                }

                return typeVarName;
            }

            case TypeCategory.None: {
                return `${TypeBase.isInstantiable(type) ? 'NoneType' : 'None'}${getConditionalIndicator(type)}`;
            }

            case TypeCategory.Never: {
                return 'Never';
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

        // JSON.stringify will perform proper escaping for " case.
        // So, we only need to do our own escaping for ' case.
        literalStr = JSON.stringify(literalValue).toString();
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
    } else {
        literalStr = literalValue.toString();
    }

    return literalStr;
}

export function printObjectTypeForClass(
    type: ClassType,
    printTypeFlags: PrintTypeFlags,
    returnTypeCallback: FunctionReturnTypeCallback,
    recursionTypes: Type[] = []
): string {
    let objName = type.aliasName || type.details.name;

    // If this is a pseudo-generic class, don't display the type arguments
    // or type parameters because it will confuse users.
    if (!ClassType.isPseudoGenericClass(type)) {
        const typeParams = ClassType.getTypeParameters(type);
        const lastTypeParam = typeParams.length > 0 ? typeParams[typeParams.length - 1] : undefined;
        const isVariadic = lastTypeParam ? lastTypeParam.details.isVariadic : false;

        // If there is a type arguments array, it's a specialized class.
        const typeArgs = type.tupleTypeArguments || type.typeArguments;
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
                        isClassInstance(typeArg) &&
                        ClassType.isBuiltIn(typeArg, 'tuple') &&
                        typeArg.tupleTypeArguments
                    ) {
                        // Expand the tuple type that maps to the variadic type parameter.
                        if (typeArg.tupleTypeArguments.length === 0) {
                            if (!isAnyOrUnknown(typeArg)) {
                                isAllAny = false;
                            }

                            typeArgStrings.push('()');
                        } else {
                            typeArgStrings.push(
                                ...typeArg.tupleTypeArguments.map((typeArg) => {
                                    if (!isAnyOrUnknown(typeArg)) {
                                        isAllAny = false;
                                    }

                                    return printType(typeArg, printTypeFlags, returnTypeCallback, recursionTypes);
                                })
                            );
                        }
                    } else {
                        if (!isAnyOrUnknown(typeArg)) {
                            isAllAny = false;
                        }

                        typeArgStrings.push(printType(typeArg, printTypeFlags, returnTypeCallback, recursionTypes));
                    }
                });

                if ((printTypeFlags & PrintTypeFlags.OmitTypeArgumentsIfAny) === 0 || !isAllAny) {
                    objName += '[' + typeArgStrings.join(', ') + ']';
                }
            } else {
                if (ClassType.isTupleClass(type) || isVariadic) {
                    objName += '[()]';
                }
            }
        } else {
            if (typeParams.length > 0) {
                if (
                    (printTypeFlags & PrintTypeFlags.OmitTypeArgumentsIfAny) === 0 ||
                    typeParams.some((typeParam) => !isAnyOrUnknown(typeParam))
                ) {
                    objName +=
                        '[' +
                        typeParams
                            .map((typeParam) => {
                                return printType(typeParam, printTypeFlags, returnTypeCallback, recursionTypes);
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
    recursionTypes: Type[] = []
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
                specializedParamType.tupleTypeArguments.forEach((paramType, paramIndex) => {
                    const paramString = printType(paramType, printTypeFlags, returnTypeCallback, recursionTypes);
                    paramTypeStrings.push(paramString);
                });
                return;
            }
        }

        let paramString = '';
        if (param.category === ParameterCategory.VarArgList) {
            paramString += '*';
        } else if (param.category === ParameterCategory.VarArgDictionary) {
            paramString += '**';
        }

        if (param.name && !param.isNameSynthesized) {
            paramString += param.name;
            sawDefinedName = true;
        }

        let defaultValueAssignment = '=';
        if (param.name) {
            // Avoid printing type types if parameter have unknown type.
            if (param.hasDeclaredType || param.isTypeInferred) {
                const paramType = FunctionType.getEffectiveParameterType(type, index);
                const paramTypeString =
                    recursionTypes.length < maxTypeRecursionCount
                        ? printType(paramType, printTypeFlags, returnTypeCallback, recursionTypes)
                        : '';
                if (!param.isNameSynthesized) {
                    paramString += ': ';
                }
                paramString += paramTypeString;

                if (isParamSpec(paramType)) {
                    if (param.category === ParameterCategory.VarArgList) {
                        paramString += '.args';
                    } else if (param.category === ParameterCategory.VarArgDictionary) {
                        paramString += '.kwargs';
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

        paramTypeStrings.push(paramString);
    });

    const returnType = returnTypeCallback(type);
    const returnTypeString =
        recursionTypes.length < maxTypeRecursionCount
            ? printType(
                  returnType,
                  printTypeFlags | PrintTypeFlags.ParenthesizeUnion,
                  returnTypeCallback,
                  recursionTypes
              )
            : '';

    return [paramTypeStrings, returnTypeString];
}
