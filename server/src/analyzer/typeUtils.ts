/*
* typeUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Collection of functions that operate on Type objects.
*/

import * as assert from 'assert';

import { DiagnosticAddendum } from '../common/diagnostic';
import StringMap from '../common/stringMap';
import { ParameterCategory } from '../parser/parseNodes';
import { ImportLookup } from './analyzerFileInfo';
import { DeclarationType } from './declaration';
import { getTypeForDeclaration, hasTypeForDeclaration } from './declarationUtils';
import { Symbol, SymbolFlags, SymbolTable } from './symbol';
import { getDeclaredTypeOfSymbol, getEffectiveTypeOfSymbol,
    isTypedDictMemberAccessedThroughIndex } from './symbolUtils';
import { AnyType, ClassType, combineTypes, FunctionParameter, FunctionType, FunctionTypeFlags,
    InheritanceChain, isAnyOrUnknown, isNoneOrNever, isSameWithoutLiteralValue, isTypeSame,
    maxTypeRecursionCount, ModuleType, NeverType, ObjectType, OverloadedFunctionEntry,
    OverloadedFunctionType, printLiteralValue, printType, requiresSpecialization, SpecializedFunctionTypes,
    Type, TypeCategory, TypeVarMap, TypeVarType, UnknownType } from './types';

export interface ClassMember {
    // Symbol
    symbol: Symbol;

    // Partially-specialized class that contains the class member
    classType: Type;

    // True if instance member, false if class member
    isInstanceMember: boolean;
}

export const enum ClassMemberLookupFlags {
    Default = 0,

    // By default, the original (derived) class is searched along
    // with its base classes. If this flag is set, the original
    // class is skipped and only the base classes are searched.
    SkipOriginalClass = 1 << 0,

    // By default, base classes are searched as well as the
    // original (derived) class. If this flag is set, no recursion
    // is performed.
    SkipBaseClasses = 1 << 1,

    // Skip the 'object' base class in particular.
    SkipObjectBaseClass = 1 << 2,

    // By default, both class and instance variables are searched.
    // If this flag is set, the instance variables are skipped.
    SkipInstanceVariables = 1 << 3,

    // By default, the first symbol is returned even if it has only
    // an inferred type associated with it. If this flag is set,
    // the search looks only for symbols with declared types.
    DeclaredTypesOnly = 1 << 4
}

export const enum CanAssignFlags {
    Default = 0,

    // Require invariance with respect to class matching? Normally
    // subclasses are allowed.
    EnforceInvariance = 1 << 0
}

export interface SymbolWithClass {
    class: ClassType;
    symbol: Symbol;
}

export interface TypedDictEntry {
    valueType: Type;
    isRequired: boolean;
    isProvided: boolean;
}

export function isOptionalType(type: Type): boolean {
    if (type.category === TypeCategory.Union) {
        return type.subtypes.some(t => isNoneOrNever(t));
    }

    return false;
}

// When a variable with a declared type is assigned and the declared
// type is a union, we may be able to further constrain the type.
export function constrainDeclaredTypeBasedOnAssignedType(declaredType: Type,
        assignedType: Type, importLookup: ImportLookup): Type {

    const diagAddendum = new DiagnosticAddendum();

    if (declaredType.category === TypeCategory.Union) {
        return doForSubtypes(declaredType, subtype => {
            if (assignedType.category === TypeCategory.Union) {
                if (!assignedType.subtypes.some(
                        t => canAssignType(subtype, t, diagAddendum, importLookup))) {
                    return undefined;
                } else {
                    return subtype;
                }
            } else if (!canAssignType(subtype, assignedType, diagAddendum, importLookup)) {
                return undefined;
            } else {
                return subtype;
            }
        });
    }

    if (!canAssignType(declaredType, assignedType, diagAddendum, importLookup)) {
        return NeverType.create();
    }

    return declaredType;
}

// Calls a callback for each subtype and combines the results
// into a final type.
export function doForSubtypes(type: Type, callback: (type: Type) => (Type | undefined)): Type {
    if (type.category === TypeCategory.Union) {
        const newTypes: Type[] = [];

        type.subtypes.forEach(typeEntry => {
            const transformedType = callback(typeEntry);
            if (transformedType) {
                newTypes.push(transformedType);
            }
        });

        return combineTypes(newTypes);
    }

    return callback(type) || NeverType.create();
}

// Determines if all of the types in the array are the same.
export function areTypesSame(types: Type[]): boolean {
    if (types.length < 2) {
        return true;
    }

    for (let i = 1; i < types.length; i++) {
        if (!isTypeSame(types[0], types[i])) {
            return false;
        }
    }

    return true;
}

export function stripLiteralValue(type: Type): Type {
    if (type.category === TypeCategory.Object) {
        if (type.literalValue !== undefined) {
            return ObjectType.create(type.classType);
        }
    } else if (type.category === TypeCategory.Union) {
        return doForSubtypes(type, subtype => {
            return stripLiteralValue(subtype);
        });
    }

    return type;
}

export function canOverrideMethod(baseMethod: Type, overrideMethod: FunctionType,
        diag: DiagnosticAddendum, importLookup: ImportLookup): boolean {

    // If we're overriding a non-method, don't report any error.
    if (!(baseMethod.category === TypeCategory.Function)) {
        return true;
    }

    let canOverride = true;
    const baseParams = FunctionType.getParameters(baseMethod);
    const overrideParams = FunctionType.getParameters(overrideMethod);

    if (baseParams.length !== overrideParams.length) {
        diag.addMessage(`Parameter count mismatch: base method has ` +
            `${ baseParams.length }, but override has ${ overrideParams.length }`);
    }

    const paramCount = Math.min(baseParams.length, overrideParams.length);
    for (let i = 0; i < paramCount; i++) {
        const baseParam = baseParams[i];
        const overrideParam = overrideParams[i];

        if (baseParam.name !== overrideParam.name) {
            diag.addMessage(`Parameter ${ i + 1 } name mismatch: ` +
                `base parameter is named '${ baseParam.name || '*' }, ` +
                `override parameter is named '${ overrideParam.name || '*' }'`);
            canOverride = false;
        } else {
            const baseParamType = FunctionType.getEffectiveParameterType(baseMethod, i);
            const overrideParamType = FunctionType.getEffectiveParameterType(overrideMethod, i);

            if (!canAssignType(baseParamType, overrideParamType, diag.createAddendum(), importLookup)) {
                diag.addMessage(`Parameter ${ i + 1 } type mismatch: ` +
                    `base method parameter is type '${ printType(baseParamType) }, ` +
                    `override is type '${ printType(overrideParamType) }'`);
                canOverride = false;
            }
        }
    }

    const baseReturnType = FunctionType.getEffectiveReturnType(baseMethod);
    const overrideReturnType = FunctionType.getEffectiveReturnType(overrideMethod);
    if (!canAssignType(baseReturnType, overrideReturnType, diag.createAddendum(), importLookup)) {
        diag.addMessage(`Return type mismatch: ` +
            `base method returns type '${ printType(baseReturnType) }, ` +
            `override is type '${ printType(overrideReturnType) }'`);

        canOverride = false;
    }

    return canOverride;
}

// Determines if the source type can be assigned to the dest type.
// If typeVarMap is provided, type variables within the destType are
// matched against existing type variables in the map. If a type variable
// in the dest type is not in the type map already, it is assigned a type
// and added to the map.
export function canAssignType(destType: Type, srcType: Type, diag: DiagnosticAddendum,
        importLookup: ImportLookup, typeVarMap?: TypeVarMap, flags = CanAssignFlags.Default,
        recursionCount = 0): boolean {

    if (recursionCount > maxTypeRecursionCount) {
        return true;
    }

    if (destType === srcType) {
        return true;
    }

    // If the source or dest is unbound, allow the assignment. The
    // error will be reported elsewhere.
    if (destType.category === TypeCategory.Unbound ||
            srcType.category === TypeCategory.Unbound) {
        return true;
    }

    // Before performing any other checks, see if the dest type is a
    // TypeVar that we are attempting to match.
    if (destType.category === TypeCategory.TypeVar) {
        if (typeVarMap) {
            // Strip any literal value first, since type matching never uses literals.
            const noLiteralSrcType = stripLiteralValue(srcType);

            const existingTypeVarMapping = typeVarMap.get(destType.name);
            if (existingTypeVarMapping) {
                const diagAddendum = new DiagnosticAddendum();
                if (!canAssignType(existingTypeVarMapping, noLiteralSrcType, diagAddendum,
                        importLookup, typeVarMap, flags, recursionCount + 1)) {

                    if (canAssignType(noLiteralSrcType, existingTypeVarMapping, new DiagnosticAddendum(),
                            importLookup, typeVarMap, flags, recursionCount + 1)) {

                        // Widen the type.
                        typeVarMap.set(destType.name, noLiteralSrcType);
                    } else {
                        // Create a union, widening the type.
                        const combinedType = combineTypes([existingTypeVarMapping, noLiteralSrcType]);
                        typeVarMap.set(destType.name, combinedType);
                    }
                }
            } else {
                // Assign the type to the type var.
                typeVarMap.set(destType.name, noLiteralSrcType);
            }
        }

        return canAssignToTypeVar(destType, srcType, diag, importLookup,
            flags, recursionCount + 1);
    }

    if (isAnyOrUnknown(destType) || isAnyOrUnknown(srcType)) {
        return true;
    }

    if (srcType.category === TypeCategory.TypeVar) {
        // This should happen only if we have a bug and forgot to specialize
        // the source type or the code being analyzed contains a bug where
        // a return type uses a type var that is not referenced elsewhere
        // in a function.
        const specializedSrcType = specializeTypeVarType(srcType);
        return canAssignType(destType, specializedSrcType, diag,
            importLookup, undefined, flags, recursionCount + 1);
    }

    if (recursionCount > maxTypeRecursionCount) {
        return true;
    }

    if (srcType.category === TypeCategory.Union) {
        let isIncompatible = false;

        // For union sources, all of the types need to be assignable to the dest.
        srcType.subtypes.forEach(t => {
            if (!canAssignType(destType, t, diag.createAddendum(), importLookup, typeVarMap,
                    flags, recursionCount + 1)) {

                diag.addMessage(`Type '${ printType(t) }' cannot be assigned to ` +
                    `type '${ printType(destType) }'`);
                isIncompatible = true;
            }
        });

        if (isIncompatible) {
            return false;
        }

        return true;
    }

    if (destType.category === TypeCategory.Union) {
        // For union destinations, we just need to match one of the types.
        const diagAddendum = new DiagnosticAddendum();
        const compatibleType = destType.subtypes.find(
            t => canAssignType(t, srcType, diagAddendum, importLookup, typeVarMap,
                flags, recursionCount + 1));
        if (!compatibleType) {
            diag.addAddendum(diagAddendum);
            return false;
        }
        return true;
    }

    if (destType.category === TypeCategory.None && srcType.category === TypeCategory.None) {
        return true;
    }

    // Is the src a specialized "Type" object?
    if (srcType.category === TypeCategory.Object &&
            ClassType.isBuiltIn(srcType.classType, 'Type')) {

        const srcTypeArgs = ClassType.getTypeArguments(srcType.classType);
        if (srcTypeArgs && srcTypeArgs.length >= 1) {
            if (isAnyOrUnknown(srcTypeArgs[0])) {
                return true;
            } else if (srcTypeArgs[0].category === TypeCategory.Object) {
                return canAssignType(destType,
                    srcTypeArgs[0].classType, diag.createAddendum(), importLookup, typeVarMap,
                        flags, recursionCount + 1);
            }
        }
    }

    if (destType.category === TypeCategory.Class) {
        if (srcType.category === TypeCategory.Class) {
            return _canAssignClass(destType, srcType, diag, importLookup,
                typeVarMap, flags, recursionCount + 1, false);
        }
    }

    if (destType.category === TypeCategory.Object) {
        const destClassType = destType.classType;

        // Is the dest a generic "type" object?
        if (ClassType.isBuiltIn(destClassType, 'type')) {
            if (srcType.category === TypeCategory.Class ||
                    srcType.category === TypeCategory.Function ||
                    srcType.category === TypeCategory.OverloadedFunction) {

                return true;
            }
        }

        // Is the dest a specialized "Type" object?
        if (ClassType.isBuiltIn(destClassType, 'Type')) {
            const destTypeArgs = ClassType.getTypeArguments(destClassType);
            if (destTypeArgs && destTypeArgs.length >= 1) {
                if (isAnyOrUnknown(destTypeArgs[0])) {
                    return true;
                } else if (destTypeArgs[0].category === TypeCategory.Object) {
                    return canAssignType(destTypeArgs[0].classType,
                        srcType, diag.createAddendum(), importLookup, typeVarMap,
                            flags, recursionCount + 1);
                } else if (destTypeArgs[0].category === TypeCategory.TypeVar) {
                    if (srcType.category === TypeCategory.Class) {
                        return canAssignType(destTypeArgs[0],
                            ObjectType.create(srcType), diag.createAddendum(), importLookup, typeVarMap,
                                flags, recursionCount + 1);
                    } else if (srcType.category === TypeCategory.Function ||
                            srcType.category === TypeCategory.OverloadedFunction) {

                        return canAssignType(destTypeArgs[0],
                            srcType, diag.createAddendum(), importLookup, typeVarMap,
                                flags, recursionCount + 1);
                    }
                }
            }
        }

        if (srcType.category === TypeCategory.Object) {
            const destLiteral = destType.literalValue;
            if (destLiteral !== undefined) {
                const srcLiteral = srcType.literalValue;
                if (srcLiteral !== destLiteral) {
                    diag.addMessage(`'${ srcLiteral ? printLiteralValue(srcType) : printType(srcType) }' ` +
                        `cannot be assigned to '${ printLiteralValue(destType) }'`);

                    return false;
                }
            }

            if (!_canAssignClass(destClassType, srcType.classType, diag,
                importLookup, typeVarMap, flags, recursionCount + 1, true)) {

                return false;
            }

            return true;
        } else if (srcType.category === TypeCategory.Function) {
            // Is the destination a callback protocol (defined in PEP 544)?
            const callbackType = _getCallbackProtocolType(destType, importLookup);
            if (callbackType) {
                if (!_canAssignFunction(callbackType, srcType, diag.createAddendum(),
                        importLookup, typeVarMap, recursionCount + 1, true)) {

                    return false;
                }
                return true;
            }

            // All functions are assignable to "object".
            if (ClassType.isBuiltIn(destType.classType) &&
                    ClassType.getClassName(destType.classType) === 'object') {

                return true;
            }
        } else if (srcType.category === TypeCategory.Module) {
            // Is the destination the built-in "ModuleType"?
            if (ClassType.isBuiltIn(destClassType, 'ModuleType')) {
                return true;
            }
        } else if (srcType.category === TypeCategory.Class) {
            // All classes are assignable to "object".
            if (ClassType.isBuiltIn(destType.classType, 'object')) {
                return true;
            }

            // Determine if the metaclass can be assigned to the object.
            const metaclass = getMetaclass(srcType);
            if (metaclass) {
                if (isAnyOrUnknown(metaclass)) {
                    return true;
                } else if (metaclass.category === TypeCategory.Class) {
                    // Handle EnumMeta, which requires special-case handling because
                    // of the way it's defined in enum.pyi. The type var _T must be
                    // manually set to the corresponding enum object type.
                    if (typeVarMap && ClassType.isBuiltIn(metaclass, 'EnumMeta')) {
                        typeVarMap.set('_T', ObjectType.create(srcType));
                    }

                    return _canAssignClass(destClassType, metaclass, diag,
                        importLookup, typeVarMap, flags, recursionCount + 1, false);
                }
            }
        }
    }

    if (destType.category === TypeCategory.Function) {
        let srcFunction: FunctionType | undefined;

        if (srcType.category === TypeCategory.OverloadedFunction) {
            // Find first overloaded function that matches the parameters.
            // We don't want to pollute the current typeVarMap, so we'll
            // make a copy of the existing one if it's specified.
            const overloads = srcType.overloads;
            const overloadIndex = overloads.findIndex(overload => {
                const typeVarMapClone = typeVarMap ?
                    cloneTypeVarMap(typeVarMap) : undefined;
                return canAssignType(destType, overload.type, diag.createAddendum(),
                    importLookup, typeVarMapClone, flags, recursionCount + 1);
            });
            if (overloadIndex < 0) {
                diag.addMessage(`No overloaded function matches type '${ printType(destType) }'.`);
                return false;
            }
            srcFunction = overloads[overloadIndex].type;
        } else if (srcType.category === TypeCategory.Function) {
            srcFunction = srcType;
        } else if (srcType.category === TypeCategory.Object) {
            const callMember = lookUpObjectMember(srcType, '__call__', importLookup);
            if (callMember) {
                const memberType = getTypeOfMember(callMember, importLookup);
                if (memberType.category === TypeCategory.Function) {
                    srcFunction = stripFirstParameter(memberType);
                }
            }
        } else if (srcType.category === TypeCategory.Class) {
            // Synthesize a function that represents the constructor for this class.
            const constructorFunction = FunctionType.create(
                FunctionTypeFlags.StaticMethod | FunctionTypeFlags.ConstructorMethod |
                FunctionTypeFlags.SynthesizedMethod);
            FunctionType.setDeclaredReturnType(constructorFunction, ObjectType.create(srcType));

            const newMemberInfo = lookUpClassMember(srcType, '__new__', importLookup,
                ClassMemberLookupFlags.SkipInstanceVariables | ClassMemberLookupFlags.SkipObjectBaseClass);
            const memberType = newMemberInfo ? getTypeOfMember(newMemberInfo, importLookup) : undefined;
            if (memberType && memberType.category === TypeCategory.Function) {
                FunctionType.getParameters(memberType).forEach((param, index) => {
                    // Skip the 'cls' parameter.
                    if (index > 0) {
                        FunctionType.addParameter(constructorFunction, param);
                    }
                });
            } else {
                const initMemberInfo = lookUpClassMember(srcType, '__init__', importLookup,
                    ClassMemberLookupFlags.SkipInstanceVariables | ClassMemberLookupFlags.SkipObjectBaseClass);
                const initMemberType = initMemberInfo ? getTypeOfMember(initMemberInfo, importLookup) : undefined;
                if (initMemberType && initMemberType.category === TypeCategory.Function) {
                    FunctionType.getParameters(initMemberType).forEach((param, index) => {
                        // Skip the 'self' parameter.
                        if (index > 0) {
                            FunctionType.addParameter(constructorFunction, param);
                        }
                    });
                } else {
                    addDefaultFunctionParameters(constructorFunction);
                }
            }

            srcFunction = constructorFunction;
        }

        if (srcFunction) {
            return _canAssignFunction(destType, srcFunction, diag.createAddendum(),
                importLookup, typeVarMap, recursionCount + 1, false);
        }
    }

    // NoneType and ModuleType derive from object.
    if (isNoneOrNever(srcType) || srcType.category === TypeCategory.Module) {
        if (destType.category === TypeCategory.Object) {
            const destClassType = destType.classType;
            if (ClassType.isBuiltIn(destClassType, 'object')) {
                return true;
            }
        }
    }

    if (isNoneOrNever(destType)) {
        diag.addMessage(`Cannot assign to 'None'`);
        return false;
    }

    diag.addMessage(`'${ printType(srcType) }' ` +
        `cannot be assigned to '${ printType(destType) }'`);
    return false;
}

export function canBeTruthy(type: Type): boolean {
    if (isNoneOrNever(type)) {
        return false;
    } else if (type.category === TypeCategory.Never) {
        return false;
    }

    return true;
}

// If the type is a concrete class X described by the object Type[X],
// returns X. Otherwise returns the original type.
export function transformTypeObjectToClass(type: Type): Type {
    if (type.category !== TypeCategory.Object) {
        return type;
    }

    const classType = type.classType;
    if (!ClassType.isBuiltIn(classType, 'Type')) {
        return type;
    }

    // If it's a generic Type, we can't get the class.
    if (!classType.typeArguments || classType.typeArguments.length < 1) {
        return type;
    }

    const typeArg = classType.typeArguments[0];
    if (typeArg.category !== TypeCategory.Object) {
        return type;
    }

    return typeArg.classType;
}

// None is always falsy. All other types are generally truthy
// unless they are objects that support the __bool__ or __len__
// methods.
export function canBeFalsy(type: Type, importLookup: ImportLookup): boolean {
    if (type.category === TypeCategory.None) {
        return true;
    }

    if (type.category === TypeCategory.Never) {
        return false;
    }

    if (type.category === TypeCategory.Function || type.category === TypeCategory.OverloadedFunction) {
        return false;
    }

    if (type.category === TypeCategory.Object) {
        const lenMethod = lookUpObjectMember(type, '__len__', importLookup);
        if (lenMethod) {
            return true;
        }

        const boolMethod = lookUpObjectMember(type, '__bool__', importLookup);
        if (boolMethod) {
            return true;
        }
    }

    return false;
}

// Validates that the specified source type matches the constraints
// of the type variable.
export function canAssignToTypeVar(destType: TypeVarType, srcType: Type,
        diag: DiagnosticAddendum, importLookup: ImportLookup, flags = CanAssignFlags.Default,
        recursionCount = 0): boolean {

    if (recursionCount > maxTypeRecursionCount) {
        return true;
    }

    if (isAnyOrUnknown(srcType)) {
        return true;
    }

    let effectiveSrcType = srcType;

    // If the source type is a type var itself, convert it to a concrete
    // type to see if it is compatible with the dest type.
    if (srcType.category === TypeCategory.TypeVar) {
        effectiveSrcType = _getConcreteTypeFromTypeVar(srcType, 1);
    }

    // If there's a bound type, make sure the source is derived from it.
    const boundType = destType.boundType;
    if (boundType) {
        if (!canAssignType(boundType, effectiveSrcType, diag.createAddendum(),
                importLookup, undefined, flags, recursionCount + 1)) {

            diag.addMessage(`Type '${ printType(effectiveSrcType) }' is not compatible with ` +
                `bound type '${ printType(boundType) }' for TypeVar '${ destType.name }'`);
            return false;
        }
    }

    // If there are no constraints, we're done.
    const constraints = destType.constraints;
    if (constraints.length === 0) {
        return true;
    }

    // Try to find a match among the constraints.
    for (const constraint of constraints) {
        if (isAnyOrUnknown(constraint)) {
            return true;
        } else if (effectiveSrcType.category === TypeCategory.Union) {
            // Does it match at least one of the constraints?
            if (effectiveSrcType.subtypes.find(
                    t => isSameWithoutLiteralValue(constraint, t))) {

                return true;
            }
        } else if (isSameWithoutLiteralValue(constraint, effectiveSrcType)) {
            return true;
        }
    }

    diag.addMessage(`Type '${ printType(effectiveSrcType) }' is not compatible with ` +
        `constraints imposed by TypeVar '${ destType.name }'`);

    return false;
}

// Determines whether the type is a Tuple class or object.
export function getSpecializedTupleType(type: Type): ClassType | undefined {
    let classType: ClassType | undefined;

    if (type.category === TypeCategory.Class) {
        classType = type;
    } else if (type.category === TypeCategory.Object) {
        classType = type.classType;
    }

    if (classType && ClassType.isBuiltIn(classType, 'Tuple')) {
        return classType;
    }

    return undefined;
}

export function isEllipsisType(type: Type): boolean {
    // Ellipses are translated into both a special form of "Any" or
    // a distinct class depending on the context.
    if (type.category === TypeCategory.Any && type.isEllipsis) {
        return true;
    }

    return (type.category === TypeCategory.Class &&
        ClassType.isBuiltIn(type, 'ellipsis'));
}

export function isNoReturnType(type: Type): boolean {
    if (type.category === TypeCategory.Object) {
        const classType = type.classType;
        if (ClassType.isBuiltIn(classType, 'NoReturn')) {
            return true;
        }
    }
    return false;
}

// Partially specializes a type within the context of a specified
// (presumably specialized) class.
export function partiallySpecializeType(type: Type, contextClassType: ClassType): Type {
    // If the context class is not specialized (or doesn't need specialization),
    // then there's no need to do any more work.
    if (ClassType.isGeneric(contextClassType)) {
        return type;
    }

    // Partially specialize the type using the specialized class type vars.
    const typeVarMap = buildTypeVarMapFromSpecializedClass(contextClassType);
    return specializeType(type, typeVarMap, false);
}

// Specializes a (potentially generic) type by substituting
// type variables with specified types. If typeVarMap is not
// provided or makeConcrete is true, type variables are replaced
// with a concrete type derived from the type variable if there
// is no corresponding definition in the typeVarMap.
export function specializeType(type: Type, typeVarMap: TypeVarMap | undefined,
        makeConcrete = false, recursionLevel = 0): Type {

    // Prevent infinite recursion in case a type refers to itself.
    if (recursionLevel > 100) {
        return AnyType.create();
    }

    // Shortcut the operation if possible.
    if (!requiresSpecialization(type)) {
        return type;
    }

    // Shortcut if there are no type variables defined.
    if (typeVarMap && !makeConcrete && typeVarMap.getKeys().length === 0) {
        return type;
    }

    if (isAnyOrUnknown(type)) {
        return type;
    }

    if (isNoneOrNever(type)) {
        return type;
    }

    if (type.category === TypeCategory.TypeVar) {
        if (typeVarMap) {
            const replacementType = typeVarMap.get(type.name);
            if (replacementType) {
                return replacementType;
            }
        }

        if (!typeVarMap || makeConcrete) {
            return _getConcreteTypeFromTypeVar(type, recursionLevel);
        }

        return type;
    }

    if (type.category === TypeCategory.Union) {
        const subtypes: Type[] = [];
        type.subtypes.forEach(typeEntry => {
            subtypes.push(specializeType(typeEntry, typeVarMap,
                makeConcrete, recursionLevel + 1));
        });

        return combineTypes(subtypes);
    }

    if (type.category === TypeCategory.Object) {
        const classType = _specializeClassType(type.classType,
            typeVarMap, makeConcrete, recursionLevel + 1);

        // Handle the "Type" special class.
        if (ClassType.isBuiltIn(classType, 'Type')) {
            const typeArgs = ClassType.getTypeArguments(classType);
            if (typeArgs && typeArgs.length >= 1) {
                const firstTypeArg = typeArgs[0];
                if (firstTypeArg.category === TypeCategory.Object) {
                    return specializeType(firstTypeArg.classType, typeVarMap,
                        makeConcrete, recursionLevel + 1);
                } else if (firstTypeArg.category === TypeCategory.TypeVar) {
                    if (typeVarMap) {
                        const replacementType = typeVarMap.get(firstTypeArg.name);
                        if (replacementType && replacementType.category === TypeCategory.Object) {
                            return replacementType.classType;
                        }
                    }
                }
            }
        }

        // Don't allocate a new ObjectType class if the class
        // didn't need to be specialized.
        if (classType === type.classType) {
            return type;
        }
        return ObjectType.create(classType);
    }

    if (type.category === TypeCategory.Class) {
        return _specializeClassType(type, typeVarMap,
            makeConcrete, recursionLevel + 1);
    }

    if (type.category === TypeCategory.Function) {
        return _specializeFunctionType(type, typeVarMap,
            makeConcrete, recursionLevel + 1);
    }

    if (type.category === TypeCategory.OverloadedFunction) {
        return _specializeOverloadedFunctionType(type, typeVarMap,
            makeConcrete, recursionLevel + 1);
    }

    return type;
}

// If the memberType is an instance or class method, creates a new
// version of the function that has the "self" or "cls" parameter bound
// to it. If treatAsClassMember is true, the function is treated like a
// class member even if it's not marked as such. That's needed to
// special-case the __new__ magic method when it's invoked as a
// constructor (as opposed to by name).
export function bindFunctionToClassOrObject(baseType: ClassType | ObjectType | undefined,
        memberType: Type, importLookup: ImportLookup, treatAsClassMember = false): Type {

    if (memberType.category === TypeCategory.Function) {
        // If the caller specified no base type, always strip the
        // first parameter. This is used in cases like constructors.
        if (!baseType) {
            return stripFirstParameter(memberType);
        } else if (FunctionType.isInstanceMethod(memberType) && !treatAsClassMember) {
            if (baseType.category === TypeCategory.Object) {
                return _partiallySpecializeFunctionForBoundClassOrObject(
                    baseType, memberType, importLookup);
            }
        } else if (FunctionType.isClassMethod(memberType) || treatAsClassMember) {
            if (baseType.category === TypeCategory.Class) {
                return _partiallySpecializeFunctionForBoundClassOrObject(
                    baseType, memberType, importLookup);
            } else {
                return _partiallySpecializeFunctionForBoundClassOrObject(
                    baseType.classType, memberType, importLookup);
            }
        }
    } else if (memberType.category === TypeCategory.OverloadedFunction) {
        const newOverloadType = OverloadedFunctionType.create();
        memberType.overloads.forEach(overload => {
            OverloadedFunctionType.addOverload(newOverloadType, overload.typeSourceId,
                bindFunctionToClassOrObject(baseType, overload.type,
                    importLookup, treatAsClassMember) as FunctionType);
        });

        return newOverloadType;
    }

    return memberType;
}

export function getTypeOfMember(member: ClassMember, importLookup: ImportLookup) {
    if (member.classType.category === TypeCategory.Class) {
        return partiallySpecializeType(
            getEffectiveTypeOfSymbol(member.symbol, importLookup), member.classType);
    }
    return UnknownType.create();
}

export function lookUpObjectMember(objectType: Type, memberName: string, importLookup: ImportLookup,
        flags = ClassMemberLookupFlags.Default): ClassMember | undefined {

    if (objectType.category === TypeCategory.Object) {
        return lookUpClassMember(objectType.classType, memberName, importLookup, flags);
    }

    return undefined;
}

// Looks up a member in a class using the multiple-inheritance rules
// defined by Python. For more details, see this note on method resolution
// order: https://www.python.org/download/releases/2.3/mro/.
// As it traverses the inheritance tree, it applies partial specialization
// to the the base class and member. For example, if ClassA inherits from
// ClassB[str] which inherits from Dict[_T1, int], a search for '__iter__'
// would return a class type of Dict[str, int] and a symbolType of
// (self) -> Iterator[str].
export function lookUpClassMember(classType: Type, memberName: string, importLookup: ImportLookup,
        flags = ClassMemberLookupFlags.Default): ClassMember | undefined {

    const declaredTypesOnly = (flags & ClassMemberLookupFlags.DeclaredTypesOnly) !== 0;

    if (classType.category === TypeCategory.Class) {
        // Should we ignore members on the 'object' base class?
        if (flags & ClassMemberLookupFlags.SkipObjectBaseClass) {
            if (ClassType.isBuiltIn(classType, 'object')) {
                return undefined;
            }
        }

        if ((flags & ClassMemberLookupFlags.SkipOriginalClass) === 0) {
            const memberFields = ClassType.getFields(classType);

            // Look in the instance members first if requested.
            if ((flags & ClassMemberLookupFlags.SkipInstanceVariables) === 0) {
                const symbol = memberFields.get(memberName);
                if (symbol && symbol.isInstanceMember()) {
                    if (!declaredTypesOnly || symbol.hasTypedDeclarations()) {
                        return {
                            symbol,
                            isInstanceMember: true,
                            classType
                        };
                    }
                }
            }

            // Next look in the class members.
            const symbol = memberFields.get(memberName);
            if (symbol && symbol.isClassMember()) {
                if (!declaredTypesOnly || symbol.hasTypedDeclarations()) {
                    return {
                        symbol,
                        isInstanceMember: false,
                        classType
                    };
                }
            }
        }

        if ((flags & ClassMemberLookupFlags.SkipBaseClasses) === 0) {
            for (const baseClass of ClassType.getBaseClasses(classType)) {
                // Skip metaclass.
                if (!baseClass.isMetaclass) {
                    // Recursively perform search.
                    const methodType = lookUpClassMember(
                        partiallySpecializeType(baseClass.type, classType),
                        memberName, importLookup, flags & ~ClassMemberLookupFlags.SkipOriginalClass);
                    if (methodType) {
                        return methodType;
                    }
                }
            }
        }
    } else if (isAnyOrUnknown(classType)) {
        // The class derives from an unknown type, so all bets are off
        // when trying to find a member. Return an unknown symbol.
        return {
            symbol: Symbol.createWithType(SymbolFlags.None, UnknownType.create()),
            isInstanceMember: false,
            classType: UnknownType.create()
        };
    }

    return undefined;
}

export function addDefaultFunctionParameters(functionType: FunctionType) {
    FunctionType.addParameter(functionType, {
        category: ParameterCategory.VarArgList,
        name: 'args',
        type: UnknownType.create()
    });
    FunctionType.addParameter(functionType, {
        category: ParameterCategory.VarArgDictionary,
        name: 'kwargs',
        type: UnknownType.create()
    });
}

export function getMetaclass(type: ClassType, recursionCount = 0): ClassType | UnknownType | undefined {
    if (recursionCount > maxTypeRecursionCount) {
        return undefined;
    }

    for (const base of ClassType.getBaseClasses(type)) {
        if (base.isMetaclass) {
            if (base.type.category === TypeCategory.Class) {
                return base.type;
            } else {
                return UnknownType.create();
            }
        }

        if (base.type.category === TypeCategory.Class) {
            const metaclass = getMetaclass(base.type, recursionCount + 1);
            if (metaclass) {
                return metaclass;
            }
        }
    }

    return undefined;
}

export function addTypeVarToListIfUnique(list: TypeVarType[], type: TypeVarType) {
    if (list.find(t => t === type) === undefined) {
        list.push(type);
    }
}

// Combines two lists of type var types, maintaining the combined order
// but removing any duplicates.
export function addTypeVarsToListIfUnique(list1: TypeVarType[], list2: TypeVarType[]) {
    for (const t of list2) {
        addTypeVarToListIfUnique(list1, t);
    }
}

// Walks the type recursively (in a depth-first manner), finds all
// type variables that are referenced, and returns an ordered list
// of unique type variables. For example, if the type is
// Union[List[Dict[_T1, _T2]], _T1, _T3], the result would be
// [_T1, _T2, _T3].
export function getTypeVarArgumentsRecursive(type: Type): TypeVarType[] {
    const getTypeVarsFromClass = (classType: ClassType) => {
        const combinedList: TypeVarType[] = [];
        const typeArgs = ClassType.getTypeArguments(classType);

        if (typeArgs) {
            typeArgs.forEach(typeArg => {
                addTypeVarsToListIfUnique(combinedList,
                    getTypeVarArgumentsRecursive(typeArg));
            });
        }

        return combinedList;
    };

    if (type.category === TypeCategory.TypeVar) {
        return [type];
    } else if (type.category === TypeCategory.Class) {
        return getTypeVarsFromClass(type);
    } else if (type.category === TypeCategory.Object) {
        return getTypeVarsFromClass(type.classType);
    } else if (type.category === TypeCategory.Union) {
        const combinedList: TypeVarType[] = [];
        for (const subtype of type.subtypes) {
            addTypeVarsToListIfUnique(combinedList,
                getTypeVarArgumentsRecursive(subtype));
        }
    }

    return [];
}

// If the class is generic, the type is cloned, and its own
// type parameters are used as type arguments. This is useful
// for typing "self" or "cls" within a class's implementation.
export function selfSpecializeClassType(type: ClassType, setSkipAbstractClassTest = false): ClassType {
    if (!ClassType.isGeneric(type) && !setSkipAbstractClassTest) {
        return type;
    }

    const typeArgs = ClassType.getTypeParameters(type);
    return ClassType.cloneForSpecialization(type, typeArgs, setSkipAbstractClassTest);
}

// Removes the first parameter of the function and returns a new function.
export function stripFirstParameter(type: FunctionType): FunctionType {
    return FunctionType.clone(type, true);
}

// Builds a mapping between type parameters and their specialized
// types. For example, if the generic type is Dict[_T1, _T2] and the
// specialized type is Dict[str, int], it returns a map that associates
// _T1 with str and _T2 with int.
export function buildTypeVarMapFromSpecializedClass(classType: ClassType): TypeVarMap {
    const typeParameters = ClassType.getTypeParameters(classType);
    const typeArgs = ClassType.getTypeArguments(classType);

    return buildTypeVarMap(typeParameters, typeArgs);
}

export function buildTypeVarMap(typeParameters: TypeVarType[], typeArgs: Type[] | undefined): TypeVarMap {
    const typeArgMap = new TypeVarMap();
    typeParameters.forEach((typeParam, index) => {
        const typeVarName = typeParam.name;
        let typeArgType: Type;

        if (typeArgs) {
            if (index >= typeArgs.length) {
                typeArgType = AnyType.create();
            } else {
                typeArgType = typeArgs[index];
            }
        } else {
            typeArgType = specializeTypeVarType(typeParam);
        }

        typeArgMap.set(typeVarName, typeArgType);
    });

    return typeArgMap;
}

// Converts a type var type into the most specific type
// that fits the specified constraints.
export function specializeTypeVarType(type: TypeVarType): Type {
    const subtypes: Type[] = [];
    type.constraints.forEach(constraint => {
        subtypes.push(constraint);
    });

    const boundType = type.boundType;
    if (boundType) {
        subtypes.push(boundType);
    }

    if (subtypes.length === 0) {
        return AnyType.create();
    }

    return combineTypes(subtypes);
}

export function cloneTypeVarMap(typeVarMap: TypeVarMap): TypeVarMap {
    const newTypeVarMap = new TypeVarMap();
    newTypeVarMap.getKeys().forEach(key => {
        newTypeVarMap.set(key, typeVarMap.get(key)!);
    });
    return newTypeVarMap;
}

export function derivesFromClassRecursive(classType: ClassType, baseClassToFind: ClassType) {
    if (ClassType.isSameGenericClass(classType, baseClassToFind)) {
        return true;
    }

    for (const baseClass of ClassType.getBaseClasses(classType)) {
        if (baseClass.type.category === TypeCategory.Class) {
            if (derivesFromClassRecursive(baseClass.type, baseClassToFind)) {
                return true;
            }
        }
    }

    return false;
}

// Filters a type such that that no part of it is definitely
// falsy. For example, if a type is a union of None
// and an "int", this method would strip off the "None"
// and return only the "int".
export function removeFalsinessFromType(type: Type): Type {
    return doForSubtypes(type, subtype => {
        if (subtype.category === TypeCategory.Object) {
            if (subtype.literalValue !== undefined) {
                // If the object is already definitely truthy, it's fine to
                // include, otherwise it should be removed.
                return subtype.literalValue ? subtype : undefined;
            }

            // If the object is a bool, make it "true", since
            // "false" is a falsy value.
            if (ClassType.isBuiltIn(subtype.classType, 'bool')) {
                return ObjectType.cloneWithLiteral(subtype, true);
            }
        }

        // If it's possible for the type to be truthy, include it.
        if (canBeTruthy(subtype)) {
            return subtype;
        }

        return undefined;
    });
}

// Filters a type such that that no part of it is definitely
// truthy. For example, if a type is a union of None
// and a custom class "Foo" that has no __len__ or __nonzero__
// method, this method would strip off the "Foo"
// and return only the "None".
export function removeTruthinessFromType(type: Type, importLookup: ImportLookup): Type {
    return doForSubtypes(type, subtype => {
        if (subtype.category === TypeCategory.Object) {
            if (subtype.literalValue !== undefined) {
                // If the object is already definitely falsy, it's fine to
                // include, otherwise it should be removed.
                return !subtype.literalValue ? subtype : undefined;
            }

            // If the object is a bool, make it "false", since
            // "true" is a truthy value.
            if (ClassType.isBuiltIn(subtype.classType, 'bool')) {
                return ObjectType.cloneWithLiteral(subtype, false);
            }
        }

        // If it's possible for the type to be falsy, include it.
        if (canBeFalsy(subtype, importLookup)) {
            return subtype;
        }

        return undefined;
    });
}

// Looks up the specified symbol name within the base classes
// of a specified class.
export function getSymbolFromBaseClasses(classType: ClassType, name: string,
        recursionCount = 0): SymbolWithClass | undefined {

    if (recursionCount > maxTypeRecursionCount) {
        return undefined;
    }

    for (const baseClass of ClassType.getBaseClasses(classType)) {
        if (baseClass.type.category === TypeCategory.Class) {
            const memberFields = ClassType.getFields(baseClass.type);
            const symbol = memberFields.get(name);
            if (symbol && symbol.isClassMember()) {
                return {
                    class: baseClass.type,
                    symbol
                };
            }

            const symbolWithClass = getSymbolFromBaseClasses(baseClass.type,
                name, recursionCount + 1);
            if (symbolWithClass) {
                return symbolWithClass;
            }
        } else {
            return undefined;
        }
    }

    return undefined;
}

export function doesClassHaveAbstractMethods(classType: ClassType, importLookup: ImportLookup) {
    const abstractMethods = new StringMap<ClassMember>();
    getAbstractMethodsRecursive(classType, importLookup, abstractMethods);

    return abstractMethods.getKeys().length > 0;
}

export function getAbstractMethodsRecursive(classType: ClassType, importLookup: ImportLookup,
        symbolTable: StringMap<ClassMember>, recursiveCount = 0) {

    // Protect against infinite recursion.
    if (recursiveCount > maxTypeRecursionCount) {
        return;
    }

    for (const baseClass of ClassType.getBaseClasses(classType)) {
        if (baseClass.type.category === TypeCategory.Class) {
            if (ClassType.isAbstractClass(baseClass.type)) {
                // Recursively get abstract methods for subclasses.
                getAbstractMethodsRecursive(baseClass.type,
                    importLookup, symbolTable, recursiveCount + 1);
            }
        }
    }

    // Remove any entries that are overridden in this class with
    // non-abstract methods.
    if (symbolTable.getKeys().length > 0 || ClassType.isAbstractClass(classType)) {
        const memberFields = ClassType.getFields(classType);
        for (const symbolName of memberFields.getKeys()) {
            const symbol = memberFields.get(symbolName)!;

            if (symbol.isClassMember()) {
                const symbolType = getEffectiveTypeOfSymbol(symbol, importLookup);

                if (symbolType.category === TypeCategory.Function) {
                    if (FunctionType.isAbstractMethod(symbolType)) {
                        symbolTable.set(symbolName, {
                            symbol,
                            isInstanceMember: false,
                            classType
                        });
                    } else {
                        symbolTable.delete(symbolName);
                    }
                }
            }
        }
    }
}

// Returns the declared yield type if provided, or undefined otherwise.
export function getDeclaredGeneratorYieldType(functionType: FunctionType,
        iteratorType: Type): Type | undefined {

    const returnType = FunctionType.getSpecializedReturnType(functionType);
    if (returnType) {
        const generatorTypeArgs = _getGeneratorReturnTypeArgs(returnType);

        if (generatorTypeArgs && generatorTypeArgs.length >= 1 &&
                iteratorType.category === TypeCategory.Class) {

            // The yield type is the first type arg. Wrap it in an iterator.
            return ObjectType.create(ClassType.cloneForSpecialization(
                iteratorType, [generatorTypeArgs[0]]));
        }

        // If the return type isn't a Generator, assume that it's the
        // full return type.
        return returnType;
    }

    return undefined;
}

// Returns the declared "send" type (the type returned from the yield
// statement) if it was declared, or undefined otherwise.
export function getDeclaredGeneratorSendType(functionType: FunctionType): Type | undefined {
    const returnType = FunctionType.getSpecializedReturnType(functionType);
    if (returnType) {
        const generatorTypeArgs = _getGeneratorReturnTypeArgs(returnType);

        if (generatorTypeArgs && generatorTypeArgs.length >= 2) {
            // The send type is the second type arg.
            return generatorTypeArgs[1];
        }

        return UnknownType.create();
    }

    return undefined;
}

// Returns the declared "return" type (the type returned from a return statement)
// if it was declared, or undefined otherwise.
export function getDeclaredGeneratorReturnType(functionType: FunctionType): Type | undefined {
    const returnType = FunctionType.getSpecializedReturnType(functionType);
    if (returnType) {
        const generatorTypeArgs = _getGeneratorReturnTypeArgs(returnType);

        if (generatorTypeArgs && generatorTypeArgs.length >= 3) {
            // The send type is the third type arg.
            return generatorTypeArgs[2];
        }

        return UnknownType.create();
    }

    return undefined;
}

export function convertClassToObject(type: Type): Type {
    return doForSubtypes(type, subtype => {
        if (subtype.category === TypeCategory.Class) {
            return ObjectType.create(subtype);
        }

        return subtype;
    });
}

export function getMembersForClass(classType: ClassType, symbolTable: SymbolTable,
        includeInstanceVars: boolean) {

    _getMembersForClassRecursive(classType, symbolTable, includeInstanceVars);
}

export function getMembersForModule(moduleType: ModuleType, symbolTable: SymbolTable) {
    // Start with the loader fields. If there are any symbols of the
    // same name defined within the module, they will overwrite the
    // loader fields.
    if (moduleType.loaderFields) {
        moduleType.loaderFields.forEach((symbol, name) => {
            symbolTable.set(name, symbol);
        });
    }

    moduleType.fields.forEach((symbol, name) => {
        symbolTable.set(name, symbol);
    });
}

export function containsUnknown(type: Type, recursionCount = 0): boolean {
    if (recursionCount > maxTypeRecursionCount) {
        return false;
    }

    if (type.category === TypeCategory.Unknown) {
        return true;
    }

    // See if a union contains an unknown type.
    if (type.category === TypeCategory.Union) {
        for (const subtype of type.subtypes) {
            if (containsUnknown(subtype, recursionCount + 1)) {
                return true;
            }
        }

        return false;
    }

    // See if an object or class has an unknown type argument.
    if (type.category === TypeCategory.Object) {
        return containsUnknown(type.classType, recursionCount + 1);
    }

    if (type.category === TypeCategory.Class) {
        const typeArgs = ClassType.getTypeArguments(type);
        if (typeArgs) {
            for (const argType of typeArgs) {
                if (containsUnknown(argType, recursionCount + 1)) {
                    return true;
                }
            }
        }

        return false;
    }

    return false;
}

export function isEnumClass(classType: ClassType): boolean {
    // Does the class have an "EnumMeta" metaclass?
    const metaclass = getMetaclass(classType);

    return !!metaclass && metaclass.category === TypeCategory.Class &&
        ClassType.getClassName(metaclass) === 'EnumMeta';
}

// Determines whether the specified keys and values can be assigned to
// a typed dictionary class. The caller should have already validated
// that the class is indeed a typed dict.
export function canAssignToTypedDict(classType: ClassType, importLookup: ImportLookup,
        keyTypes: Type[], valueTypes: Type[]): boolean {

    assert(ClassType.isTypedDictClass(classType));
    assert(keyTypes.length === valueTypes.length);

    let isMatch = true;

    const symbolMap = new StringMap<TypedDictEntry>();
    getTypedDictMembersForClassRecursive(classType, symbolMap);
    const diag = new DiagnosticAddendum();

    keyTypes.forEach((keyType, index) => {
        if (keyType.category !== TypeCategory.Object ||
                !ClassType.isBuiltIn(keyType.classType, 'str') ||
                !keyType.literalValue) {

            isMatch = false;
        } else {
            const keyValue = keyType.literalValue as string;
            const symbolEntry = symbolMap.get(keyValue);

            if (!symbolEntry) {
                // The provided key name doesn't exist.
                isMatch = false;
            } else {
                // Can we assign the value to the declared type?
                if (!canAssignType(symbolEntry.valueType, valueTypes[index], diag, importLookup)) {
                    isMatch = false;
                }
                symbolEntry.isProvided = true;
            }
        }
    });

    if (!isMatch) {
        return false;
    }

    // See if any required keys are missing.
    symbolMap.forEach(entry => {
        if (entry.isRequired && !entry.isProvided) {
            isMatch = false;
        }
    });

    return isMatch;
}

export function getTypedDictMembersForClassRecursive(classType: ClassType,
        keyMap: StringMap<TypedDictEntry>, recursionCount = 0) {

    assert(ClassType.isTypedDictClass(classType));
    if (recursionCount > maxTypeRecursionCount) {
        return;
    }

    ClassType.getBaseClasses(classType).forEach(baseClassType => {
        if (!baseClassType.isMetaclass && baseClassType.type.category === TypeCategory.Class &&
                ClassType.isTypedDictClass(baseClassType.type)) {

            getTypedDictMembersForClassRecursive(baseClassType.type,
                keyMap, recursionCount + 1);
        }
    });

    // Add any new typed dict entries from this class.
    ClassType.getFields(classType).forEach((symbol, name) => {
        const declarations = symbol.getDeclarations();
        if (declarations.length > 0) {
            const firstDecl = declarations[0];
            if (firstDecl.type === DeclarationType.Variable &&
                    firstDecl.node && hasTypeForDeclaration(firstDecl)) {

                keyMap.set(name, {
                    valueType: getTypeForDeclaration(firstDecl) || UnknownType.create(),
                    isRequired: !ClassType.isCanOmitDictValues(classType),
                    isProvided: false
                });
            }
        }
    });
}

function _getMembersForClassRecursive(classType: ClassType,
        symbolTable: SymbolTable, includeInstanceVars: boolean,
        recursionCount = 0) {

    if (recursionCount > maxTypeRecursionCount) {
        return;
    }

    ClassType.getBaseClasses(classType).forEach(baseClassType => {
        if (!baseClassType.isMetaclass && baseClassType.type.category === TypeCategory.Class) {
            _getMembersForClassRecursive(baseClassType.type,
                symbolTable, includeInstanceVars, recursionCount + 1);
        }
    });

    // Add any new member variables from this class.
    const isClassTypedDict = ClassType.isTypedDictClass(classType);
    ClassType.getFields(classType).forEach((symbol, name) => {
        if (symbol.isClassMember() || (includeInstanceVars && symbol.isInstanceMember())) {
            if (!isClassTypedDict || !isTypedDictMemberAccessedThroughIndex(symbol)) {
                if (!symbolTable.get(name)) {
                    symbolTable.set(name, symbol);
                }
            }
        }
    });
}

function _partiallySpecializeFunctionForBoundClassOrObject(
        baseType: ClassType | ObjectType, memberType: FunctionType,
        importLookup: ImportLookup): Type {

    const classType = baseType.category === TypeCategory.Class ? baseType : baseType.classType;

    // If the class has already been specialized (fully or partially), use its
    // existing type arg mappings. If it hasn't, use a fresh type arg map.
    const typeVarMap = ClassType.getTypeArguments(classType) ?
        buildTypeVarMapFromSpecializedClass(classType) :
        new TypeVarMap();

    if (FunctionType.getParameterCount(memberType) > 0) {
        const firstParam = FunctionType.getParameters(memberType)[0];

        // Fill out the typeVarMap.
        canAssignType(firstParam.type, baseType, new DiagnosticAddendum(),
            importLookup, typeVarMap);
    }

    const specializedFunction = specializeType(
        memberType, typeVarMap, false) as FunctionType;
    return stripFirstParameter(specializedFunction);
}

function _canAssignFunction(destType: FunctionType, srcType: FunctionType,
        diag: DiagnosticAddendum, importLookup: ImportLookup,
        typeVarMap: TypeVarMap | undefined, recursionCount: number,
        checkNamedParams: boolean): boolean {

    let canAssign = true;

    const srcParamCount = FunctionType.getParameterCount(srcType);
    const destParamCount = FunctionType.getParameterCount(destType);
    const minParamCount = Math.min(srcParamCount, destParamCount);

    // Match as many input parameters as we can.
    for (let paramIndex = 0; paramIndex < minParamCount; paramIndex++) {
        const srcParam = FunctionType.getParameters(srcType)[paramIndex];
        const destParam = FunctionType.getParameters(destType)[paramIndex];
        const paramDiag = diag.createAddendum();

        // If the dest or source involve var-args, no need to continue matching.
        if (srcParam.category !== ParameterCategory.Simple ||
                destParam.category !== ParameterCategory.Simple) {
            break;
        }

        const srcParamType = FunctionType.getEffectiveParameterType(srcType, paramIndex);
        const destParamType = FunctionType.getEffectiveParameterType(destType, paramIndex);

        // Call canAssignType once to perform any typeVarMap population.
        canAssignType(srcParamType, destParamType, paramDiag.createAddendum(), importLookup,
            typeVarMap, CanAssignFlags.Default, recursionCount + 1);

        // Make sure we can assign the specialized dest type to the
        // source type.
        const specializedDestParamType = specializeType(
            destParamType, typeVarMap, false, recursionCount + 1);

        if (!canAssignType(srcParamType, specializedDestParamType, paramDiag.createAddendum(),
                importLookup, undefined, CanAssignFlags.Default, recursionCount + 1)) {

            paramDiag.addMessage(`Parameter ${ paramIndex + 1 } of type ` +
                `'${ printType(specializedDestParamType) }' cannot be assigned to type ` +
                `'${ printType(srcParamType) }'`);
            canAssign = false;
        }
    }

    const srcParams = FunctionType.getParameters(srcType);
    const destParams = FunctionType.getParameters(destType);

    const srcHasVarArgs = srcParams.find(
        param => param.category !== ParameterCategory.Simple) !== undefined;
    const destHasVarArgs = destParams.find(
        param => param.category !== ParameterCategory.Simple) !== undefined;

    if (checkNamedParams) {
        // Handle matching of named (keyword) parameters.
        // Build a dictionary of named parameters in the dest.
        const destParamMap = new StringMap<FunctionParameter>();
        let destHasNamedParam = false;
        destParams.forEach(param => {
            if (destHasNamedParam) {
                if (param.name && param.category === ParameterCategory.Simple) {
                    destParamMap.set(param.name, param);
                }
            } else if (param.category === ParameterCategory.VarArgList) {
                destHasNamedParam = true;
            }
        });

        let srcHasNamedParam = false;
        srcParams.forEach(param => {
            if (srcHasNamedParam) {
                if (param.name && param.category === ParameterCategory.Simple) {
                    const destParam = destParamMap.get(param.name);
                    const paramDiag = diag.createAddendum();
                    if (!destParam) {
                        paramDiag.addMessage(`Named parameter '${ param.name }' is missing in destination`);
                        canAssign = false;
                    } else {
                        const specializedDestParamType = specializeType(
                            destParam.type, typeVarMap, false, recursionCount + 1);
                        if (!canAssignType(param.type, specializedDestParamType, paramDiag.createAddendum(),
                                importLookup, undefined, CanAssignFlags.Default, recursionCount + 1)) {

                            paramDiag.addMessage(`Named parameter '${ param.name }' of type ` +
                                `'${ printType(specializedDestParamType) }' cannot be assigned to type ` +
                                `'${ printType(param.type) }'`);
                            canAssign = false;
                        }
                        destParamMap.delete(param.name);
                    }
                }
            } else if (param.category === ParameterCategory.VarArgList) {
                srcHasNamedParam = true;
            }
        });

        // See if there are any unmatched named parameters.
        destParamMap.getKeys().forEach(paramName => {
            const paramDiag = diag.createAddendum();
            paramDiag.addMessage(`Named parameter '${ paramName }' is missing in source`);
            canAssign = false;
        });
    }

    // If we didn't find a var-arg parameter, the number of dest params
    // must be enough to provide all of the non-default source params
    // with values. Plus, the number of source params must be enough to
    // accept all of the dest arguments.
    if (!srcHasVarArgs && !destHasVarArgs) {
        const nonDefaultSrcParamCount = srcParams.filter(
            param => !param.hasDefault).length;

        if (destParamCount < nonDefaultSrcParamCount) {
            diag.addMessage(`Function accepts too few parameters. Expected ` +
                `${ nonDefaultSrcParamCount } but got ${ destParamCount }.`);
            canAssign = false;
        }

        if (destParamCount > srcParamCount) {
            diag.addMessage(`Function accepts too many parameters. Expected ` +
                `${ srcParamCount } but got ${ destParamCount }.`);
            canAssign = false;
        }
    }

    // Match the return parameter.
    const srcReturnType = FunctionType.getEffectiveReturnType(srcType);
    const destReturnType = FunctionType.getEffectiveReturnType(destType);

    if (!canAssignType(destReturnType, srcReturnType, diag.createAddendum(),
            importLookup, typeVarMap, CanAssignFlags.Default, recursionCount + 1)) {
        diag.addMessage(`Function return type '${ printType(srcReturnType) }' ` +
            `is not compatible with type '${ printType(destReturnType) }'.`);
        canAssign = false;
    }

    return canAssign;
}

function _canAssignClass(destType: ClassType, srcType: ClassType,
        diag: DiagnosticAddendum, importLookup: ImportLookup,
        typeVarMap: TypeVarMap | undefined,
        flags: CanAssignFlags, recursionCount: number,
        reportErrorsUsingObjType: boolean): boolean {

    // Is it a structural type (i.e. a protocol)? If so, we need to
    // perform a member-by-member check.
    if (ClassType.isProtocol(destType)) {
        const destClassFields = ClassType.getFields(destType);

        // Some protocol definitions include recursive references to themselves.
        // We need to protect against infinite recursion, so we'll check for that here.
        if (isTypeSame(srcType, destType)) {
            return true;
        }

        let typesAreConsistent = true;
        const destClassTypeVarMap = buildTypeVarMapFromSpecializedClass(destType);

        destClassFields.forEach((symbol, name) => {
            if (symbol.isClassMember() && !symbol.isIgnoredForProtocolMatch()) {
                const memberInfo = lookUpClassMember(srcType, name, importLookup,
                    ClassMemberLookupFlags.SkipInstanceVariables);
                if (!memberInfo) {
                    diag.addMessage(`'${ name }' is not present`);
                    typesAreConsistent = false;
                } else {
                    const declaredType = getDeclaredTypeOfSymbol(symbol);
                    if (declaredType) {
                        const destMemberType = specializeType(declaredType,
                            destClassTypeVarMap, false);
                        const srcMemberType = getTypeOfMember(memberInfo, importLookup);

                        if (!canAssignType(destMemberType, srcMemberType,
                                diag.createAddendum(), importLookup, typeVarMap, CanAssignFlags.Default,
                                recursionCount + 1)) {
                            diag.addMessage(`'${ name }' is an incompatible type`);
                            typesAreConsistent = false;
                        }
                    }
                }
            }
        });

        return typesAreConsistent;
    }

    // Handle typed dicts. They also use a form of structural typing for type
    // checking, as defined in PEP 589.
    if (ClassType.isTypedDictClass(destType) && ClassType.isTypedDictClass(srcType)) {
        let typesAreConsistent = true;
        const destEntries = new StringMap<TypedDictEntry>();
        getTypedDictMembersForClassRecursive(destType, destEntries);

        const srcEntries = new StringMap<TypedDictEntry>();
        getTypedDictMembersForClassRecursive(srcType, srcEntries);

        destEntries.forEach((destEntry, name) => {
            const srcEntry = srcEntries.get(name);
            if (!srcEntry) {
                diag.addMessage(`'${ name }' is missing from ${ printType(srcType) }`);
                typesAreConsistent = false;
            } else {
                if (destEntry.isRequired && !srcEntry.isRequired) {
                    diag.addMessage(`'${ name }' is required in ${ printType(destType) }`);
                    typesAreConsistent = false;
                } else if (!destEntry.isRequired && srcEntry.isRequired) {
                    diag.addMessage(`'${ name }' is not required in ${ printType(destType) }`);
                    typesAreConsistent = false;
                }

                if (!isTypeSame(destEntry.valueType, srcEntry.valueType, recursionCount + 1)) {
                    diag.addMessage(`'${ name }' is an incompatible type`);
                    typesAreConsistent = false;
                }
            }
        });

        return typesAreConsistent;
    }

    // Special-case conversion for the "numeric tower".
    if (ClassType.isBuiltIn(destType, 'float')) {
        if (ClassType.isBuiltIn(srcType, 'int')) {
            return true;
        }
    }

    if (ClassType.isBuiltIn(destType, 'complex')) {
        if (ClassType.isBuiltIn(srcType, 'int') || ClassType.isBuiltIn(srcType, 'float')) {
            return true;
        }
    }

    if ((flags & CanAssignFlags.EnforceInvariance) !== 0 && !ClassType.isSameGenericClass(srcType, destType)) {
        const destErrorType = reportErrorsUsingObjType ? ObjectType.create(destType) : destType;
        const srcErrorType = reportErrorsUsingObjType ? ObjectType.create(srcType) : srcType;
        diag.addMessage(`'${ printType(srcErrorType) }' is incompatible with ` +
            `'${ printType(destErrorType) }'`);
        return false;
    }

    const inheritanceChain: InheritanceChain = [];
    if (ClassType.isDerivedFrom(srcType, destType, inheritanceChain)) {
        assert(inheritanceChain.length > 0);

        return _canAssignClassWithTypeArgs(destType, srcType, inheritanceChain,
            diag, importLookup, typeVarMap, recursionCount + 1);
    }

    const destErrorType = reportErrorsUsingObjType ? ObjectType.create(destType) : destType;
    const srcErrorType = reportErrorsUsingObjType ? ObjectType.create(srcType) : srcType;
    diag.addMessage(`'${ printType(srcErrorType) }' is incompatible with ` +
        `'${ printType(destErrorType) }'`);
    return false;
}

// Determines whether the specified type can be assigned to the
// specified inheritance chain, taking into account its type arguments.
function _canAssignClassWithTypeArgs(destType: ClassType, srcType: ClassType,
        inheritanceChain: InheritanceChain, diag: DiagnosticAddendum, importLookup: ImportLookup,
        typeVarMap: TypeVarMap | undefined, recursionCount: number): boolean {

    let curSrcType = srcType;

    for (let ancestorIndex = inheritanceChain.length - 1; ancestorIndex >= 0; ancestorIndex--) {
        const ancestorType = inheritanceChain[ancestorIndex];

        // If we've hit an "unknown", all bets are off, and we need to assume
        // that the type is assignable.
        if (ancestorType.category === TypeCategory.Unknown) {
            return true;
        }

        // If we've hit an 'object', it's assignable.
        if (ClassType.isBuiltIn(ancestorType, 'object')) {
            return true;
        }

        // If this isn't the first time through the loop, specialize
        // for the next ancestor in the chain.
        if (ancestorIndex < inheritanceChain.length - 1) {
            curSrcType = _specializeForBaseClass(curSrcType, ancestorType, recursionCount + 1);
        }

        // Do we need to do special-case processing for various built-in classes?
        if (ancestorIndex === 0 && ClassType.isSpecialBuiltIn(destType)) {
            // Handle built-in types that support arbitrary numbers
            // of type parameters like Tuple.
            if (ClassType.getClassName(destType) === 'Tuple') {
                const destTypeArgs = ClassType.getTypeArguments(destType) || [];
                let destArgCount = destTypeArgs.length;
                const isDestHomogenousTuple = destArgCount === 2 && isEllipsisType(destTypeArgs[1]);
                if (isDestHomogenousTuple) {
                    destArgCount = 1;
                }

                const srcTypeArgs = ClassType.getTypeArguments(curSrcType) || [];
                let srcArgCount = srcTypeArgs.length;
                const isSrcHomogeneousType = srcArgCount === 2 && isEllipsisType(srcTypeArgs[1]);
                if (isSrcHomogeneousType) {
                    srcArgCount = 1;
                }

                if (srcTypeArgs.length === destArgCount || isDestHomogenousTuple || isSrcHomogeneousType) {
                    for (let i = 0; i < Math.min(destArgCount, srcArgCount); i++) {
                        const expectedDestType = isDestHomogenousTuple ? destTypeArgs[0] : destTypeArgs[i];
                        const expectedSrcType = isSrcHomogeneousType ? srcTypeArgs[0] : srcTypeArgs[i];
                        if (!canAssignType(expectedDestType, expectedSrcType,
                                diag.createAddendum(), importLookup, typeVarMap, CanAssignFlags.Default,
                                recursionCount + 1)) {
                            diag.addMessage(`Tuple entry ${ i + 1 } is incorrect type`);
                            return false;
                        }
                    }
                } else {
                    diag.addMessage(
                        `Tuple size mismatch: expected ${ destArgCount }` +
                            ` but got ${ srcTypeArgs.length }`);
                    return false;
                }

                return true;
            }
        }

        // If there are no type parameters on this class, we're done.
        const ancestorTypeParams = ClassType.getTypeParameters(ancestorType);
        if (ancestorTypeParams.length === 0) {
            continue;
        }

        // If the dest type isn't specialized, there are no type args to validate.
        const ancestorTypeArgs = ClassType.getTypeArguments(ancestorType)!;
        if (!ancestorTypeArgs) {
            return true;
        }

        // Validate that the type arguments match.
        if (!_verifyTypeArgumentsAssignable(ancestorType, curSrcType, diag, importLookup,
                typeVarMap, recursionCount)) {

            return false;
        }
    }

    // If the dest type is specialized, make sure the specialized source
    // type arguments are assignable to the dest type arguments.
    if (destType.typeArguments) {
        if (!_verifyTypeArgumentsAssignable(destType, curSrcType, diag, importLookup,
                typeVarMap, recursionCount)) {

            return false;
        }
    }

    return true;
}

function _verifyTypeArgumentsAssignable(destType: ClassType, srcType: ClassType,
        diag: DiagnosticAddendum, importLookup: ImportLookup, typeVarMap: TypeVarMap | undefined,
        recursionCount: number) {

    assert(ClassType.isSameGenericClass(destType, srcType));

    const destTypeParams = ClassType.getTypeParameters(destType);
    const destTypeArgs = ClassType.getTypeArguments(destType)!;
    assert(destTypeArgs !== undefined);
    const srcTypeArgs = ClassType.getTypeArguments(srcType);

    if (srcTypeArgs) {
        if (ClassType.isSpecialBuiltIn(srcType) || srcTypeArgs.length === destTypeParams.length) {
            for (let srcArgIndex = 0; srcArgIndex < srcTypeArgs.length; srcArgIndex++) {
                const srcTypeArg = srcTypeArgs[srcArgIndex];

                // In most cases, the number of type args should match the number
                // of type arguments, but there are a few special cases where this
                // isn't true (e.g. assigning a Tuple[X, Y, Z] to a tuple[W]).
                const destArgIndex = srcArgIndex >= destTypeArgs.length ?
                        destTypeArgs.length - 1 : srcArgIndex;
                const destTypeArg = destTypeArgs[destArgIndex];
                const destTypeParam = destArgIndex < destTypeParams.length ?
                    destTypeParams[destArgIndex] : undefined;

                if (!destTypeParam || destTypeParam.isCovariant) {
                    if (!canAssignType(destTypeArg, srcTypeArg,
                            diag.createAddendum(), importLookup, typeVarMap,
                            CanAssignFlags.Default, recursionCount + 1)) {

                        return false;
                    }
                } else if (destTypeParam.isContravariant) {
                    if (!canAssignType(srcTypeArg, destTypeArg,
                            diag.createAddendum(), importLookup, typeVarMap,
                            CanAssignFlags.Default, recursionCount + 1)) {

                        return false;
                    }
                } else {
                    if (!canAssignType(destTypeArg, srcTypeArg,
                            diag.createAddendum(), importLookup, typeVarMap,
                            CanAssignFlags.EnforceInvariance, recursionCount + 1)) {

                        return false;
                    }
                }
            }
        }
    }

    return true;
}

function _getCallbackProtocolType(objType: ObjectType, importLookup: ImportLookup): FunctionType | undefined {
    if (!ClassType.isProtocol(objType.classType)) {
        return undefined;
    }

    const callMember = lookUpObjectMember(objType, '__call__', importLookup);
    if (!callMember) {
        return undefined;
    }

    const memberType = getTypeOfMember(callMember, importLookup);
    if (memberType.category === TypeCategory.Function) {
        return bindFunctionToClassOrObject(objType,
            memberType, importLookup) as FunctionType;
    }

    return undefined;
}

// Determines the specialized base class type that srcType derives from.
function _specializeForBaseClass(srcType: ClassType, baseClass: ClassType,
        recursionCount: number): ClassType {

    const typeParams = ClassType.getTypeParameters(baseClass);

    // If there are no type parameters for the specified base class,
    // no specialization is required.
    if (typeParams.length === 0) {
        return baseClass;
    }

    const typeVarMap = buildTypeVarMapFromSpecializedClass(srcType);
    const specializedType = specializeType(baseClass, typeVarMap, false, recursionCount + 1);
    assert(specializedType.category === TypeCategory.Class);
    return specializedType as ClassType;
}

function _specializeClassType(classType: ClassType, typeVarMap: TypeVarMap | undefined,
        makeConcrete: boolean, recursionLevel: number): ClassType {

    // Handle the common case where the class has no type parameters.
    if (ClassType.getTypeParameters(classType).length === 0) {
        return classType;
    }

    const oldTypeArgs = ClassType.getTypeArguments(classType);
    let newTypeArgs: Type[] = [];
    let specializationNeeded = false;

    // If type args were previously provided, specialize them.
    if (oldTypeArgs) {
        newTypeArgs = oldTypeArgs.map(oldTypeArgType => {
            const newTypeArgType = specializeType(oldTypeArgType,
                typeVarMap, makeConcrete, recursionLevel + 1);
            if (newTypeArgType !== oldTypeArgType) {
                specializationNeeded = true;
            }
            return newTypeArgType;
        });
    } else {
        ClassType.getTypeParameters(classType).forEach(typeParam => {
            let typeArgType: Type;

            if (typeVarMap && typeVarMap.get(typeParam.name)) {
                // If the type var map already contains this type var, use
                // the existing type.
                typeArgType = typeVarMap.get(typeParam.name)!;
                specializationNeeded = true;
            } else {
                // If the type var map wasn't provided or doesn't contain this
                // type var, specialize the type var.
                typeArgType = specializeTypeVarType(typeParam);
                if (typeArgType !== typeParam) {
                    specializationNeeded = true;
                }
            }

            newTypeArgs.push(typeArgType);
        });
    }

    // If specialization wasn't needed, don't allocate a new class.
    if (!specializationNeeded) {
        return classType;
    }

    return ClassType.cloneForSpecialization(classType, newTypeArgs);
}

function _getConcreteTypeFromTypeVar(type: TypeVarType, recursionLevel: number): Type {
    const boundType = type.boundType;
    if (boundType) {
        return specializeType(boundType, undefined, false, recursionLevel + 1);
    }

    const constraints = type.constraints;
    if (constraints.length === 0) {
        return AnyType.create();
    }

    const concreteTypes = constraints.map(constraint =>
        specializeType(constraint, undefined, false, recursionLevel + 1)
    );

    return combineTypes(concreteTypes);
}

function _specializeOverloadedFunctionType(type: OverloadedFunctionType,
        typeVarMap: TypeVarMap | undefined, makeConcrete: boolean,
        recursionLevel: number): OverloadedFunctionType {

    // Specialize each of the functions in the overload.
    const overloads = type.overloads.map(entry => {
        const newEntry: OverloadedFunctionEntry = {
            type: _specializeFunctionType(entry.type, typeVarMap, makeConcrete, recursionLevel),
            typeSourceId: entry.typeSourceId
        };

        return newEntry;
    });

    // Construct a new overload with the specialized function types.
    const newOverloadType = OverloadedFunctionType.create();
    overloads.forEach(overload => {
        OverloadedFunctionType.addOverload(newOverloadType, overload.typeSourceId, overload.type);
    });

    return newOverloadType;
}

function _specializeFunctionType(functionType: FunctionType,
        typeVarMap: TypeVarMap | undefined, makeConcrete: boolean,
        recursionLevel: number): FunctionType {

    const returnType = FunctionType.getEffectiveReturnType(functionType);
    const specializedReturnType = specializeType(returnType,
        typeVarMap, makeConcrete, recursionLevel + 1);
    let typesRequiredSpecialization = returnType !== specializedReturnType;

    const specializedParameters: SpecializedFunctionTypes = {
        parameterTypes: [],
        returnType: specializedReturnType
    };

    for (let i = 0; i < FunctionType.getParameterCount(functionType); i++) {
        const paramType = FunctionType.getEffectiveParameterType(functionType, i);
        const specializedType = specializeType(paramType,
            typeVarMap, makeConcrete, recursionLevel + 1);
        specializedParameters.parameterTypes.push(specializedType);

        if (paramType !== specializedType) {
            typesRequiredSpecialization = true;
        }
    }

    if (!typesRequiredSpecialization) {
        return functionType;
    }

    return FunctionType.cloneForSpecialization(functionType, specializedParameters);
}

// If the declared return type for the function is a Generator or AsyncGenerator,
// returns the type arguments for the type.
function _getGeneratorReturnTypeArgs(returnType: Type): Type[] | undefined {
    if (returnType.category === TypeCategory.Object) {
        const classType = returnType.classType;
        if (ClassType.isBuiltIn(classType)) {
            const className = ClassType.getClassName(classType);
            if (className === 'Generator' || className === 'AsyncGenerator') {
                return ClassType.getTypeArguments(classType);
            }
        }
    }

    return undefined;
}
