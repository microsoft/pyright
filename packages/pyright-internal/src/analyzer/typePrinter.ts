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
    combineTypes,
    EnumLiteral,
    FunctionType,
    isAny,
    isAnyOrUnknown,
    isClass,
    isObject,
    isUnion,
    isUnknown,
    maxTypeRecursionCount,
    ObjectType,
    removeNoneFromUnion,
    Type,
    TypeBase,
    TypeCategory,
    TypeVarType,
} from './types';
import { doForEachSubtype, isOptionalType } from './typeUtils';

const singleTickRegEx = /'/g;
const tripleTickRegEx = /'''/g;

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
}

export type FunctionReturnTypeCallback = (type: FunctionType) => Type;

export function printType(
    type: Type,
    printTypeFlags: PrintTypeFlags,
    returnTypeCallback: FunctionReturnTypeCallback,
    expandTypeAlias = false,
    recursionCount = 0
): string {
    if (recursionCount >= maxTypeRecursionCount) {
        return '...';
    }

    // If this is a type alias, use its name rather than the type
    // it represents.
    if (type.typeAliasInfo && !expandTypeAlias) {
        let aliasName = type.typeAliasInfo.name;

        // If there is a type arguments array, it's a specialized type alias.
        if (type.typeAliasInfo.typeArguments) {
            if (
                (printTypeFlags & PrintTypeFlags.OmitTypeArgumentsIfAny) === 0 ||
                type.typeAliasInfo.typeArguments.some((typeArg) => !isAnyOrUnknown(typeArg))
            ) {
                aliasName +=
                    '[' +
                    type.typeAliasInfo.typeArguments
                        .map((typeArg) => {
                            return printType(
                                typeArg,
                                printTypeFlags,
                                returnTypeCallback,
                                /* expandTypeAlias */ false,
                                recursionCount + 1
                            );
                        })
                        .join(', ') +
                    ']';
            }
        } else {
            if (type.typeAliasInfo.typeParameters) {
                if (
                    (printTypeFlags & PrintTypeFlags.OmitTypeArgumentsIfAny) === 0 ||
                    type.typeAliasInfo.typeParameters.some((typeParam) => !isAnyOrUnknown(typeParam))
                ) {
                    aliasName +=
                        '[' +
                        type.typeAliasInfo.typeParameters
                            .map((typeParam) => {
                                return printType(
                                    typeParam,
                                    printTypeFlags,
                                    returnTypeCallback,
                                    /* expandTypeAlias */ false,
                                    recursionCount + 1
                                );
                            })
                            .join(', ') +
                        ']';
                }
            }
        }

        // If it's a TypeVar, don't use the alias name. Instead, use the full
        // name, which may have a scope associated with it.
        if (type.category !== TypeCategory.TypeVar) {
            return aliasName;
        }
    }

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
            if (type.literalValue !== undefined) {
                return `Type[Literal[${printLiteralValue(type)}]]`;
            }

            return `Type[${printObjectTypeForClass(type, printTypeFlags, returnTypeCallback, recursionCount + 1)}]`;
        }

        case TypeCategory.Object: {
            if (type.classType.literalValue !== undefined) {
                return `Literal[${printLiteralValue(type.classType)}]`;
            }

            return printObjectTypeForClass(type.classType, printTypeFlags, returnTypeCallback, recursionCount + 1);
        }

        case TypeCategory.Function: {
            // If it's a Callable with a ParamSpec, use the
            // Callable notation.
            const parts = printFunctionParts(type, printTypeFlags, returnTypeCallback, recursionCount);
            if (type.details.paramSpec) {
                if (type.details.parameters.length > 0) {
                    // Remove the args and kwargs parameters from the end.
                    const paramTypes = type.details.parameters.map((param) =>
                        printType(param.type, printTypeFlags, returnTypeCallback)
                    );
                    return `Callable[Concatenate[${paramTypes.join(', ')}, ${type.details.paramSpec.details.name}], ${
                        parts[1]
                    }]`;
                }
                return `Callable[${type.details.paramSpec.details.name}, ${parts[1]}]`;
            }
            return `(${parts[0].join(', ')}) -> ${parts[1]}`;
        }

        case TypeCategory.OverloadedFunction: {
            const overloadedType = type;
            const overloads = overloadedType.overloads.map((overload) =>
                printType(overload, printTypeFlags, returnTypeCallback, /* expandTypeAlias */ false, recursionCount + 1)
            );
            return `Overload[${overloads.join(', ')}]`;
        }

        case TypeCategory.Union: {
            // If the union has constraints, throw them out to avoid duplicate
            // types (e.g. "float | float | float | int").
            if (type.constraints) {
                type = combineTypes(type.subtypes);
            }

            if (isOptionalType(type)) {
                const optionalType = printType(
                    removeNoneFromUnion(type),
                    printTypeFlags,
                    returnTypeCallback,
                    /* expandTypeAlias */ false,
                    recursionCount + 1
                );

                if (printTypeFlags & PrintTypeFlags.PEP604) {
                    return optionalType + ' | None';
                }

                return 'Optional[' + optionalType + ']';
            }

            let subtypes: Type[] = [];
            doForEachSubtype(type, (subtype) => {
                subtypes.push(subtype);
            });

            // If we're printing "Unknown" as "Any", remove redundant
            // unknowns so we don't see two Any's appear in the union.
            if ((printTypeFlags & PrintTypeFlags.PrintUnknownWithAny) !== 0) {
                if (subtypes.some((t) => isAny(t))) {
                    subtypes = subtypes.filter((t) => !isUnknown(t));
                }
            }

            // If one or more subtypes are pseudo-generic, remove any other pseudo-generics
            // of the same type because we don't print type arguments for pseudo-generic
            // types, and we'll end up displaying seemingly-duplicated types.
            const isPseudoGeneric = (type: Type) =>
                (isClass(type) && ClassType.isPseudoGenericClass(type)) ||
                (isObject(type) && ClassType.isPseudoGenericClass(type.classType));
            if (subtypes.some((t) => isPseudoGeneric(t))) {
                const filteredSubtypes: Type[] = [];
                subtypes.forEach((type) => {
                    if (!isPseudoGeneric(type)) {
                        filteredSubtypes.push(type);
                    } else if (isClass(type)) {
                        if (!filteredSubtypes.some((t) => isClass(t) && ClassType.isSameGenericClass(t, type))) {
                            filteredSubtypes.push(type);
                        }
                    } else if (isObject(type)) {
                        if (
                            !filteredSubtypes.some(
                                (t) => isObject(t) && ClassType.isSameGenericClass(t.classType, type.classType)
                            )
                        ) {
                            filteredSubtypes.push(type);
                        }
                    }
                });
                subtypes = filteredSubtypes;
            }

            const isLiteralObject = (type: Type) => isObject(type) && type.classType.literalValue !== undefined;
            const isLiteralClass = (type: Type) => isClass(type) && type.literalValue !== undefined;

            const subtypeStrings: string[] = [];
            while (subtypes.length > 0) {
                const subtype = subtypes.shift()!;
                if (isLiteralObject(subtype)) {
                    // Combine all literal objects. Rather than printing Union[Literal[1],
                    // Literal[2]], print Literal[1, 2].
                    const literals = subtypes.filter((t) => isLiteralObject(t));
                    literals.unshift(subtype);
                    const literalValues = literals.map((t) => printLiteralValue((t as ObjectType).classType));
                    subtypeStrings.push(`Literal[${literalValues.join(', ')}]`);

                    // Remove the items we've handled.
                    if (literals.length > 1) {
                        subtypes = subtypes.filter((t) => !isLiteralObject(t));
                    }
                } else if (isLiteralClass(subtype)) {
                    // Combine all literal classes.
                    const literals = subtypes.filter((t) => isLiteralClass(t));
                    literals.unshift(subtype);
                    const literalValues = literals.map((t) => printLiteralValue(t as ClassType));
                    subtypeStrings.push(`Type[Literal[${literalValues.join(', ')}]]`);

                    // Remove the items we've handled.
                    if (literals.length > 1) {
                        subtypes = subtypes.filter((t) => !isLiteralClass(t));
                    }
                } else {
                    subtypeStrings.push(
                        printType(
                            subtype,
                            printTypeFlags,
                            returnTypeCallback,
                            /* expandTypeAlias */ false,
                            recursionCount + 1
                        )
                    );
                }
            }

            if (subtypeStrings.length === 1) {
                return subtypeStrings[0];
            }

            if (printTypeFlags & PrintTypeFlags.PEP604) {
                return subtypeStrings.join(' | ');
            }

            return `Union[${subtypeStrings.join(', ')}]`;
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
                    if (expandTypeAlias && type.details.boundType) {
                        return printType(
                            type.details.boundType,
                            printTypeFlags,
                            returnTypeCallback,
                            expandTypeAlias,
                            recursionCount + 1
                        );
                    }
                    return type.details.recursiveTypeAliasName;
                }

                if (type.details.boundType) {
                    return printType(
                        type.details.boundType,
                        printTypeFlags,
                        returnTypeCallback,
                        /* expandTypeAlias */ false,
                        recursionCount + 1
                    );
                }

                return (printTypeFlags & PrintTypeFlags.PrintUnknownWithAny) !== 0 ? 'Any' : 'Unknown';
            }

            if (type.details.isParamSpec) {
                return `${TypeVarType.getReadableName(type)}`;
            }

            const typeVarName = TypeVarType.getReadableName(type);
            if (TypeBase.isInstantiable(type)) {
                return `Type[${typeVarName}]`;
            }

            return typeVarName;
        }

        case TypeCategory.None: {
            return TypeBase.isInstantiable(type) ? 'NoneType' : 'None';
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
}

export function printLiteralValue(type: ClassType): string {
    const literalValue = type.literalValue;
    if (literalValue === undefined) {
        return '';
    }

    let literalStr: string;
    if (typeof literalValue === 'string') {
        const prefix = type.details.name === 'bytes' ? 'b' : '';
        literalStr = literalValue.toString();
        if (literalStr.indexOf('\n') >= 0) {
            literalStr = `${prefix}'''${literalStr.replace(tripleTickRegEx, "\\'\\'\\'")}'''`;
        } else {
            literalStr = `${prefix}'${literalStr.replace(singleTickRegEx, "\\'")}'`;
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
    recursionCount = 0
): string {
    let objName = type.aliasName || type.details.name;

    // If this is a pseudo-generic class, don't display the type arguments
    // or type parameters because it will confuse users.
    if (!ClassType.isPseudoGenericClass(type)) {
        // If there is a type arguments array, it's a specialized class.
        const typeArgs = type.variadicTypeArguments || type.typeArguments;
        if (typeArgs) {
            // Handle Tuple[()] as a special case.
            if (typeArgs.length > 0) {
                if (
                    (printTypeFlags & PrintTypeFlags.OmitTypeArgumentsIfAny) === 0 ||
                    typeArgs.some((typeArg) => !isAnyOrUnknown(typeArg))
                ) {
                    objName +=
                        '[' +
                        typeArgs
                            .map((typeArg) => {
                                return printType(
                                    typeArg,
                                    printTypeFlags,
                                    returnTypeCallback,
                                    /* expandTypeAlias */ false,
                                    recursionCount + 1
                                );
                            })
                            .join(', ') +
                        ']';
                }
            } else {
                if (ClassType.isPseudoVariadicTypeParam(type)) {
                    objName += '[()]';
                }
            }
        } else {
            const typeParams = ClassType.getTypeParameters(type);

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
                                    /* expandTypeAlias */ false,
                                    recursionCount + 1
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

    recursionCount = 0
): [string[], string] {
    const paramTypeStrings = type.details.parameters.map((param, index) => {
        let paramString = '';
        if (param.category === ParameterCategory.VarArgList) {
            paramString += '*';
        } else if (param.category === ParameterCategory.VarArgDictionary) {
            paramString += '**';
        }

        if (param.name) {
            paramString += param.name;
        }

        let defaultValueAssignment = '=';
        if (param.name) {
            // Avoid printing type types if parameter have unknown type.
            if (param.hasDeclaredType || param.isTypeInferred) {
                const paramType = FunctionType.getEffectiveParameterType(type, index);
                const paramTypeString =
                    recursionCount < maxTypeRecursionCount
                        ? printType(
                              paramType,
                              printTypeFlags,
                              returnTypeCallback,
                              /* expandTypeAlias */ false,
                              recursionCount + 1
                          )
                        : '';
                paramString += ': ' + paramTypeString;

                // PEP8 indicates that the "=" for the default value should have surrounding
                // spaces when used with a type annotation.
                defaultValueAssignment = ' = ';
            } else if ((printTypeFlags & PrintTypeFlags.OmitTypeArgumentsIfAny) === 0) {
                paramString += ': Unknown';
                defaultValueAssignment = ' = ';
            }
        } else if (param.category === ParameterCategory.Simple) {
            paramString += '/';
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

        return paramString;
    });

    const returnType = returnTypeCallback(type);
    let returnTypeString =
        recursionCount < maxTypeRecursionCount
            ? printType(returnType, printTypeFlags, returnTypeCallback, /* expandTypeAlias */ false, recursionCount + 1)
            : '';

    if (printTypeFlags & PrintTypeFlags.PEP604 && isUnion(returnType) && recursionCount > 0) {
        returnTypeString = `(${returnTypeString})`;
    }

    return [paramTypeStrings, returnTypeString];
}
