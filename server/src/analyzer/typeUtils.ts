/*
* typeUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Collection of static methods that operate on Type objects.
*/

import * as assert from 'assert';

import { DiagnosticAddendum } from '../common/diagnostic';
import StringMap from '../common/stringMap';
import { ParameterCategory } from '../parser/parseNodes';
import { Declaration } from './declaration';
import { defaultTypeSourceId } from './inferredType';
import { Symbol, SymbolTable } from './symbol';
import { AnyType, ClassType, FunctionParameter,
    FunctionType, FunctionTypeFlags, InheritanceChain, ModuleType, NeverType,
    NoneType, ObjectType, OverloadedFunctionEntry, OverloadedFunctionType,
    SpecializedFunctionTypes, Type, TypeCategory, TypeVarMap, TypeVarType,
    UnboundType, UnionType, UnknownType } from './types';

const _maxTypeRecursion = 20;

export interface ClassMember {
    // Symbol
    symbol: Symbol;

    // Partially-specialized class that contains the class member
    classType: Type;

    // Partially-specialized type of symbol
    symbolType: Type;

    // True if instance member, false if class member
    isInstanceMember: boolean;
}

export enum ClassMemberLookupFlags {
    Default = 0,

    // By default, the original (derived) class is searched along
    // with its base classes. If this flag is set, the original
    // class is skipped and only the base classes are searched.
    SkipOriginalClass = 0x01,

    // By default, base classes are searched as well as the
    // original (derived) class. If this flag is set, no recursion
    // is performed.
    SkipBaseClasses = 0x02,

    // Skip the 'object' base class in particular.
    SkipObjectBaseClass = 0x04,

    // By default, both class and instance variables are searched.
    // If this flag is set, the instance variables are skipped.
    SkipInstanceVariables = 0x08,

    // By default, the first symbol is returned even if it has only
    // an inferred type associated with it. If this flag is set,
    // the search looks only for symbols with declared types.
    DeclaredTypesOnly = 0x10
}

export interface SymbolWithClass {
    class: ClassType;
    symbol: Symbol;
}

export class TypeUtils {
    static isOptionalType(type: Type): boolean {
        if (type instanceof UnionType) {
            return type.getTypes().some(t => t instanceof NoneType);
        }

        return false;
    }

    // When a variable with a declared type is assigned and the declared
    // type is a union, we may be able to further constrain the type.
    static constrainDeclaredTypeBasedOnAssignedType(declaredType: Type, assignedType: Type): Type {
        if (declaredType instanceof UnionType) {
            const diagAddendum = new DiagnosticAddendum();

            return this.doForSubtypes(declaredType, subtype => {
                if (assignedType instanceof UnionType) {
                    if (!assignedType.getTypes().some(t => this.canAssignType(subtype, t, diagAddendum))) {
                        return undefined;
                    } else {
                        return subtype;
                    }
                } else if (!this.canAssignType(subtype, assignedType, diagAddendum)) {
                    return undefined;
                } else {
                    return subtype;
                }
            });
        }

        return declaredType;
    }

    // Calls a callback for each subtype and combines the results
    // into a final type.
    static doForSubtypes(type: Type, callback: (type: Type) => (Type | undefined)): Type {
        if (type instanceof UnionType) {
            const newTypes: Type[] = [];

            type.getTypes().forEach(typeEntry => {
                const transformedType = callback(typeEntry);
                if (transformedType) {
                    newTypes.push(transformedType);
                }
            });

            return this.combineTypes(newTypes);
        }

        return callback(type) || NeverType.create();
    }

    // Combines multiple types into a single type. If the types are
    // the same, only one is returned. If they differ, they
    // are combined into a UnionType. NeverTypes are filtered out.
    // If no types remain in the end, a NeverType is returned.
    static combineTypes(types: Type[]): Type {
        // Filter out any "Never" types.
        types = types.filter(type => type.category !== TypeCategory.Never);
        if (types.length === 0) {
            return NeverType.create();
        }

        // Handle the common case where there is only one type.
        if (types.length === 1) {
            return types[0];
        }

        // Expand all union types.
        let expandedTypes: Type[] = [];
        for (const type of types) {
            if (type instanceof UnionType) {
                expandedTypes = expandedTypes.concat(type.getTypes());
            } else {
                expandedTypes.push(type);
            }
        }

        // Sort all of the literal types to the end.
        expandedTypes = expandedTypes.sort((type1, type2) => {
            if (type1 instanceof ObjectType && type1.getLiteralValue() !== undefined) {
                return 1;
            } else if (type2 instanceof ObjectType && type2.getLiteralValue() !== undefined) {
                return -1;
            }
            return 0;
        });

        const resultingTypes = [expandedTypes[0]];
        expandedTypes.forEach((t, index) => {
            if (index > 0) {
                this._addTypeIfUnique(resultingTypes, t);
            }
        });

        if (resultingTypes.length === 1) {
            return resultingTypes[0];
        }

        const unionType = new UnionType();
        unionType.addTypes(resultingTypes);

        return unionType;
    }

    // Determines if all of the types in the array are the same.
    static areTypesSame(types: Type[]): boolean {
        if (types.length < 2) {
            return true;
        }

        for (let i = 1; i < types.length; i++) {
            if (!types[0].isSame(types[i])) {
                return false;
            }
        }

        return true;
    }

    // Determines whether the dest type is the same as the source type with
    // the possible exception that the source type has a literal value when
    // the dest does not.
    static isSameWithoutLiteralValue(destType: Type, srcType: Type): boolean {
        // If it's the same with literals, great.
        if (destType.isSame(srcType)) {
            return true;
        }

        if (srcType instanceof ObjectType && srcType.getLiteralValue() !== undefined) {
            // Strip the literal.
            srcType = new ObjectType(srcType.getClassType());
            return destType.isSame(srcType);
        }

        return false;
    }

    static stripLiteralValue(type: Type): Type {
        if (type instanceof ObjectType) {
            if (type.getLiteralValue() !== undefined) {
                return new ObjectType(type.getClassType());
            }
        } else if (type instanceof UnionType) {
            return this.doForSubtypes(type, subtype => {
                return this.stripLiteralValue(subtype);
            });
        }

        return type;
    }

    static canOverrideMethod(baseMethod: Type, overrideMethod: FunctionType,
            diag: DiagnosticAddendum): boolean {

        // If we're overriding a non-method, don't report any error.
        if (!(baseMethod instanceof FunctionType)) {
            return true;
        }

        let canOverride = true;
        const baseParams = baseMethod.getParameters();
        const overrideParams = overrideMethod.getParameters();

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
                const baseParamType = baseMethod.getEffectiveParameterType(i);
                const overrideParamType = overrideMethod.getEffectiveParameterType(i);

                if (!this.canAssignType(baseParamType, overrideParamType,
                    diag.createAddendum())) {

                    diag.addMessage(`Parameter ${ i + 1 } type mismatch: ` +
                        `base method parameter is type '${ baseParamType.asString() }, ` +
                        `override is type '${ overrideParamType.asString() }'`);
                    canOverride = false;
                }
            }
        }

        const baseReturnType = baseMethod.getEffectiveReturnType();
        const overrideReturnType = overrideMethod.getEffectiveReturnType();
        if (!this.canAssignType(baseReturnType, overrideReturnType, diag.createAddendum())) {
            diag.addMessage(`Return type mismatch: ` +
                `base method returns type '${ baseReturnType.asString() }, ` +
                `override is type '${ overrideReturnType.asString() }'`);

            canOverride = false;
        }

        return canOverride;
    }

    // Determines if the source type can be assigned to the dest type.
    // If typeVarMap is provided, type variables within the destType are
    // matched against existing type variables in the map. If a type variable
    // in the dest type is not in the type map already, it is assigned a type
    // and added to the map.
    static canAssignType(destType: Type, srcType: Type, diag: DiagnosticAddendum,
            typeVarMap?: TypeVarMap, allowSubclasses = true, recursionCount = 0): boolean {

        if (recursionCount > _maxTypeRecursion) {
            return true;
        }

        // Before performing any other checks, see if the dest type is a
        // TypeVar that we are attempting to match.
        if (destType instanceof TypeVarType) {
            if (typeVarMap) {
                // Strip any literal value first, since type matching never uses literals.
                const noLiteralSrcType = this.stripLiteralValue(srcType);

                const existingTypeVarMapping = typeVarMap.get(destType.getName());
                if (existingTypeVarMapping) {
                    if (existingTypeVarMapping === noLiteralSrcType) {
                        return true;
                    }

                    return this.canAssignType(existingTypeVarMapping, noLiteralSrcType, diag.createAddendum(),
                        typeVarMap, allowSubclasses, recursionCount + 1);
                }

                // Assign the type to the type var.
                typeVarMap.set(destType.getName(), noLiteralSrcType);
            }

            return this.canAssignToTypeVar(destType, srcType, diag);
        }

        if (destType.isAny() || srcType.isAny()) {
            return true;
        }

        if (srcType instanceof TypeVarType) {
            // This should happen only if we have a bug and forgot to specialize
            // the source type or the code being analyzed contains a bug where
            // a return type uses a type var that is not referenced elsewhere
            // in a function.
            const specializedSrcType = this.specializeTypeVarType(srcType);
            return this.canAssignType(destType, specializedSrcType, diag,
                undefined, undefined, recursionCount + 1);
        }

        if (recursionCount > _maxTypeRecursion) {
            return true;
        }

        if (srcType instanceof UnionType) {
            let isIncompatible = false;

            // For union sources, all of the types need to be assignable to the dest.
            srcType.getTypes().forEach(t => {
                if (!this.canAssignType(destType, t, diag.createAddendum(), typeVarMap,
                        allowSubclasses, recursionCount + 1)) {

                    diag.addMessage(`Type '${ t.asString() }' cannot be assigned to ` +
                        `type '${ destType.asString() }'`);
                    isIncompatible = true;
                }
            });

            if (isIncompatible) {
                return false;
            }

            return true;
        }

        if (destType instanceof UnionType) {
            // For union destinations, we just need to match one of the types.
            const compatibleType = destType.getTypes().find(
                t => this.canAssignType(t, srcType, diag.createAddendum(), typeVarMap,
                    allowSubclasses, recursionCount + 1));
            return (compatibleType !== undefined);
        }

        if (destType.category === TypeCategory.Unbound ||
                srcType.category === TypeCategory.Unbound) {
            diag.addMessage(`Type is unbound.`);
            return false;
        }

        if (destType.category === TypeCategory.None && srcType.category === TypeCategory.None) {
            return true;
        }

        if (srcType instanceof ClassType) {
            // Is the dest a generic "type" object?
            if (destType instanceof ObjectType) {
                const destClassType = destType.getClassType();
                if (destClassType.isBuiltIn()) {
                    const destClassName = destClassType.getClassName();
                    if (destClassName === 'type') {
                        return true;
                    }

                    if (destClassName === 'Type') {
                        const destTypeArgs = destClassType.getTypeArguments();
                        if (destTypeArgs && destTypeArgs.length >= 1 && destTypeArgs[0] instanceof Type) {
                            return this.canAssignType(destTypeArgs[0],
                                new ObjectType(srcType), diag.createAddendum(), typeVarMap,
                                    allowSubclasses, recursionCount + 1);
                        }
                    }
                }
            }

            if (destType instanceof ClassType) {
                return this._canAssignClass(destType, srcType, diag,
                    typeVarMap, allowSubclasses, recursionCount + 1, false);
            }
        }

        if (destType instanceof ObjectType) {
            const destClassType = destType.getClassType();

            if (srcType instanceof ObjectType) {
                const destLiteral = destType.getLiteralValue();
                if (destLiteral !== undefined) {
                    const srcLiteral = srcType.getLiteralValue();
                    if (srcLiteral !== destLiteral) {
                        diag.addMessage(`'${ srcLiteral ? srcType.literalAsString() : srcType.asString() }' ` +
                        `cannot be assigned to '${ destType.literalAsString() }'`);

                        return false;
                    }
                }

                if (!this._canAssignClass(destClassType, srcType.getClassType(),
                        diag, typeVarMap, allowSubclasses, recursionCount + 1, true)) {

                    return false;
                }

                return true;
            } else if (srcType instanceof FunctionType) {
                // Is the destination a callback protocol (defined in PEP 544)?
                const callbackType = this._getCallbackProtocolType(destType);
                if (callbackType) {
                    if (!this._canAssignFunction(callbackType, srcType,
                            diag.createAddendum(), typeVarMap, recursionCount + 1, true)) {
                        return false;
                    }
                    return true;
                }
            } else if (srcType instanceof ModuleType) {
                // Is the destination the built-in "ModuleType"?
                if (destClassType.isBuiltIn() && destClassType.getClassName() === 'ModuleType') {
                    return true;
                }
            }
        }

        if (destType instanceof FunctionType) {
            let srcFunction: FunctionType | undefined;

            if (srcType instanceof OverloadedFunctionType) {
                // Find first overloaded function that matches the parameters.
                // We don't want to pollute the current typeVarMap, so we'll
                // make a copy of the existing one if it's specified.
                const overloads = srcType.getOverloads();
                const overloadIndex = overloads.findIndex(overload => {
                    const typeVarMapClone = typeVarMap ?
                        TypeUtils.cloneTypeVarMap(typeVarMap) : undefined;
                    return this.canAssignType(destType, overload.type, diag.createAddendum(),
                        typeVarMapClone, true, recursionCount + 1);
                });
                if (overloadIndex < 0) {
                    diag.addMessage(`No overloaded function matches type '${ destType.asString() }'.`);
                    return false;
                }
                srcFunction = overloads[overloadIndex].type;
            } else if (srcType instanceof FunctionType) {
                srcFunction = srcType;
            } else if (srcType instanceof ObjectType) {
                const callMember = this.lookUpObjectMember(srcType, '__call__');
                if (callMember) {
                    if (callMember.symbolType instanceof FunctionType) {
                        srcFunction = TypeUtils.stripFirstParameter(callMember.symbolType);
                    }
                }
            } else if (srcType instanceof ClassType) {
                // Synthesize a function that represents the constructor for this class.
                const constructorFunction = new FunctionType(
                    FunctionTypeFlags.StaticMethod | FunctionTypeFlags.ConstructorMethod |
                    FunctionTypeFlags.SynthesizedMethod);
                constructorFunction.setDeclaredReturnType(new ObjectType(srcType));

                const newMemberInfo = TypeUtils.lookUpClassMember(srcType, '__new__',
                    ClassMemberLookupFlags.SkipInstanceVariables | ClassMemberLookupFlags.SkipObjectBaseClass);
                if (newMemberInfo && newMemberInfo.symbolType instanceof FunctionType) {
                    newMemberInfo.symbolType.getParameters().forEach((param, index) => {
                        // Skip the 'cls' parameter.
                        if (index > 0) {
                            constructorFunction.addParameter(param);
                        }
                    });
                } else {
                    const initMemberInfo = TypeUtils.lookUpClassMember(srcType, '__init__',
                        ClassMemberLookupFlags.SkipInstanceVariables | ClassMemberLookupFlags.SkipObjectBaseClass);
                    if (initMemberInfo && initMemberInfo.symbolType instanceof FunctionType) {
                        initMemberInfo.symbolType.getParameters().forEach((param, index) => {
                            // Skip the 'self' parameter.
                            if (index > 0) {
                                constructorFunction.addParameter(param);
                            }
                        });
                    } else {
                        this.addDefaultFunctionParameters(constructorFunction);
                    }
                }

                srcFunction = constructorFunction;
            }

            if (srcFunction) {
                return this._canAssignFunction(destType, srcFunction, diag.createAddendum(),
                    typeVarMap, recursionCount + 1, false);
            }
        }

        // NoneType and ModuleType derive from object.
        if (srcType instanceof NoneType || srcType instanceof ModuleType) {
            if (destType instanceof ObjectType) {
                const destClassType = destType.getClassType();
                if (destClassType.isBuiltIn() && destClassType.getClassName() === 'object') {
                    return true;
                }
            }
        }

        if (destType instanceof NoneType) {
            diag.addMessage(`Cannot assign to 'None'`);
            return false;
        }

        return false;
    }

    static canBeTruthy(type: Type): boolean {
        if (type instanceof NoneType) {
            return false;
        } else if (type instanceof NeverType) {
            return false;
        }

        return true;
    }

    // None is always falsy. All other types are generally truthy
    // unless they are objects that support the __nonzero__ or __len__
    // methods.
    static canBeFalsy(type: Type): boolean {
        if (type instanceof NoneType) {
            return true;
        }

        if (type instanceof NeverType) {
            return false;
        }

        if (type instanceof FunctionType || type instanceof OverloadedFunctionType) {
            return false;
        }

        if (type instanceof ObjectType) {
            const lenMethod = this.lookUpObjectMember(type, '__len__');
            if (lenMethod) {
                return true;
            }

            const nonZeroMethod = this.lookUpObjectMember(type, '__nonzero__');
            if (nonZeroMethod) {
                return true;
            }
        }

        return false;
    }

    // Validates that the specified source type matches the constraints
    // of the type variable.
    static canAssignToTypeVar(destType: TypeVarType, srcType: Type, diag: DiagnosticAddendum,
            recursionCount = 0): boolean {

        if (recursionCount > _maxTypeRecursion) {
            return true;
        }

        if (srcType.isAny()) {
            return true;
        }

        let effectiveSrcType = srcType;

        // If the source type is a type var itself, convert it to a concrete
        // type to see if it is compatible with the dest type.
        if (srcType instanceof TypeVarType) {
            effectiveSrcType = this._getConcreteTypeFromTypeVar(srcType, 1);
        }

        // If there's a bound type, make sure the source is derived from it.
        const boundType = destType.getBoundType();
        if (boundType) {
            if (!TypeUtils.canAssignType(boundType, effectiveSrcType, diag.createAddendum(),
                    undefined, undefined, recursionCount + 1)) {

                diag.addMessage(`Type '${ effectiveSrcType.asString() }' is not compatible with ` +
                    `bound type '${ boundType.asString() }' for TypeVar '${ destType.getName() }'`);
                return false;
            }
        }

        // If there are no constraints, we're done.
        const constraints = destType.getConstraints();
        if (constraints.length === 0) {
            return true;
        }

        // Try to find a match among the constraints.
        for (const constraint of constraints) {
            if (constraint.isAny()) {
                return true;
            } else if (effectiveSrcType instanceof UnionType) {
                // Does it match at least one of the constraints?
                if (effectiveSrcType.getTypes().find(
                        t => TypeUtils.isSameWithoutLiteralValue(constraint, t))) {

                    return true;
                }
            } else if (TypeUtils.isSameWithoutLiteralValue(constraint, effectiveSrcType)) {
                return true;
            }
        }

        diag.addMessage(`Type '${ effectiveSrcType.asString() }' is not compatible with ` +
            `constraints imposed by TypeVar '${ destType.getName() }'`);

        return false;
    }

    // Determines whether the type is a Tuple class or object.
    static getSpecializedTupleType(type: Type): ClassType | undefined {
        let classType: ClassType | undefined;

        if (type instanceof ClassType) {
            classType = type;
        } else if (type instanceof ObjectType) {
            classType = type.getClassType();
        }

        if (classType && classType.isBuiltIn() && classType.getClassName() === 'Tuple') {
            return classType;
        }

        return undefined;
    }

    static isEllipsisType(type: Type): boolean {
        // Ellipses are translated into both a special form of "Any" or
        // a distinct class depending on the context.
        if (type instanceof AnyType && type.isEllipsis()) {
            return true;
        }

        return (type instanceof ClassType &&
            type.isBuiltIn() &&
            type.getClassName() === 'ellipsis');
    }

    static isNoReturnType(type: Type): boolean {
        if (type instanceof ObjectType) {
            const classType = type.getClassType();
            if (classType.isBuiltIn() && classType.getClassName() === 'NoReturn') {
                return true;
            }
        }
        return false;
    }

    // Partially specializes a type within the context of a specified
    // (presumably specialized) class.
    static partiallySpecializeType(type: Type, contextClassType: ClassType): Type {
        // If the context class is not specialized (or doesn't need specialization),
        // then there's no need to do any more work.
        if (contextClassType.isGeneric()) {
            return type;
        }

        // Partially specialize the type using the specialized class type vars.
        const typeVarMap = this.buildTypeVarMapFromSpecializedClass(contextClassType);
        return this.specializeType(type, typeVarMap);
    }

    // Specializes a (potentially generic) type by substituting
    // type variables with specified types. If typeVarMap is provided
    // type variables that are not specified are left as is. If not
    // provided, type variables are replaced with a concrete type derived
    // from the type variable.
    static specializeType(type: Type, typeVarMap: TypeVarMap | undefined,
            recursionLevel = 0): Type {

        // Prevent infinite recursion in case a type refers to itself.
        if (recursionLevel > 100) {
            return AnyType.create();
        }

        // Shortcut the operation if possible.
        if (!type.requiresSpecialization()) {
            return type;
        }

        if (type.isAny()) {
            return type;
        }

        if (type instanceof NoneType) {
            return type;
        }

        if (type instanceof TypeVarType) {
            if (!typeVarMap) {
                return this._getConcreteTypeFromTypeVar(type, recursionLevel);
            }

            const replacementType = typeVarMap.get(type.getName());
            if (replacementType) {
                return replacementType;
            }

            return type;
        }

        if (type instanceof UnionType) {
            const subtypes: Type[] = [];
            type.getTypes().forEach(typeEntry => {
                subtypes.push(this.specializeType(typeEntry, typeVarMap,
                    recursionLevel + 1));
            });

            return TypeUtils.combineTypes(subtypes);
        }

        if (type instanceof ObjectType) {
            const classType = this._specializeClassType(type.getClassType(),
                typeVarMap, recursionLevel + 1);

            // Handle the "Type" special class.
            if (classType.isBuiltIn() && classType.getClassName() === 'Type') {
                const typeArgs = classType.getTypeArguments();
                if (typeArgs && typeArgs.length >= 1) {
                    const firstTypeArg = typeArgs[0];
                    if (firstTypeArg instanceof ObjectType) {
                        return firstTypeArg.getClassType();
                    } else if (firstTypeArg instanceof TypeVarType) {
                        if (typeVarMap) {
                            const replacementType = typeVarMap.get(firstTypeArg.getName());
                            if (replacementType && replacementType instanceof ObjectType) {
                                return replacementType.getClassType();
                            }
                        }
                    }
                }
            }

            // Don't allocate a new ObjectType class if the class
            // didn't need to be specialized.
            if (classType === type.getClassType()) {
                return type;
            }
            return new ObjectType(classType);
        }

        if (type instanceof ClassType) {
            return this._specializeClassType(type, typeVarMap,
                recursionLevel + 1);
        }

        if (type instanceof FunctionType) {
            return this._specializeFunctionType(type, typeVarMap,
                recursionLevel + 1);
        }

        if (type instanceof OverloadedFunctionType) {
            return this._specializeOverloadedFunctionType(type, typeVarMap,
                recursionLevel + 1);
        }

        return type;
    }

    // If the memberType is an instance or class method, creates a new
    // version of the function that has the "self" or "cls" parameter bound
    // to it. If treatAsClassMember is true, the function is treated like a
    // class member even if it's not marked as such. That's needed to
    // special-case the __new__ magic method when it's invoked as a
    // constructor (as opposed to by name).
    static bindFunctionToClassOrObject(baseType: ClassType | ObjectType | undefined,
            memberType: Type, treatAsClassMember = false): Type {

        if (memberType instanceof FunctionType) {
            // If the caller specified no base type, always strip the
            // first parameter. This is used in cases like constructors.
            if (!baseType) {
                return TypeUtils.stripFirstParameter(memberType);
            } else if (memberType.isInstanceMethod() && !treatAsClassMember) {
                if (baseType instanceof ObjectType) {
                    return this._partiallySpecializeFunctionForBoundClassOrObject(
                        baseType, memberType);
                }
            } else if (memberType.isClassMethod() || treatAsClassMember) {
                if (baseType instanceof ClassType) {
                    return this._partiallySpecializeFunctionForBoundClassOrObject(
                        baseType, memberType);
                } else {
                    return this._partiallySpecializeFunctionForBoundClassOrObject(
                        baseType.getClassType(), memberType);
                }
            }
        } else if (memberType instanceof OverloadedFunctionType) {
            const newOverloadType = new OverloadedFunctionType();
            memberType.getOverloads().forEach(overload => {
                newOverloadType.addOverload(overload.typeSourceId,
                    this.bindFunctionToClassOrObject(baseType, overload.type,
                        treatAsClassMember) as FunctionType);
            });

            return newOverloadType;
        }

        return memberType;
    }

    static lookUpObjectMember(objectType: Type, memberName: string,
            flags = ClassMemberLookupFlags.Default): ClassMember | undefined {

        if (objectType instanceof ObjectType) {
            return this.lookUpClassMember(objectType.getClassType(), memberName, flags);
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
    static lookUpClassMember(classType: Type, memberName: string,
            flags = ClassMemberLookupFlags.Default): ClassMember | undefined {

        const declaredTypesOnly = (flags & ClassMemberLookupFlags.DeclaredTypesOnly) !== 0;

        if (classType instanceof ClassType) {
            // Should we ignore members on the 'object' base class?
            if (flags & ClassMemberLookupFlags.SkipObjectBaseClass) {
                if (classType.isBuiltIn() && classType.getClassName() === 'object') {
                    return undefined;
                }
            }

            if ((flags & ClassMemberLookupFlags.SkipOriginalClass) === 0) {
                // Look in the instance fields first if requested.
                if ((flags & ClassMemberLookupFlags.SkipInstanceVariables) === 0) {
                    const instanceFields = classType.getInstanceFields();
                    const instanceFieldEntry = instanceFields.get(memberName);
                    if (instanceFieldEntry) {
                        const symbol = instanceFieldEntry;

                        if (!declaredTypesOnly || this.getDeclaredTypeOfSymbol(symbol)) {
                            return {
                                symbol,
                                isInstanceMember: true,
                                classType,
                                symbolType: this.partiallySpecializeType(
                                    this.getEffectiveTypeOfSymbol(symbol), classType)
                            };
                        }
                    }
                }

                // Next look in the class fields.
                const classFields = classType.getClassFields();
                const classFieldEntry = classFields.get(memberName);
                if (classFieldEntry) {
                    const symbol = classFieldEntry;

                    if (!declaredTypesOnly || this.getDeclaredTypeOfSymbol(symbol)) {
                        return {
                            symbol,
                            isInstanceMember: false,
                            classType,
                            symbolType: this.partiallySpecializeType(
                                this.getEffectiveTypeOfSymbol(symbol), classType)
                        };
                    }
                }
            }

            if ((flags & ClassMemberLookupFlags.SkipBaseClasses) === 0) {
                for (const baseClass of classType.getBaseClasses()) {
                    // Skip metaclasses.
                    if (!baseClass.isMetaclass) {
                        // Recursively perform search.
                        const methodType = this.lookUpClassMember(
                            this.partiallySpecializeType(baseClass.type, classType),
                            memberName, flags & ~ClassMemberLookupFlags.SkipOriginalClass);
                        if (methodType) {
                            return methodType;
                        }
                    }
                }
            }
        } else if (classType.isAny()) {
            // The class derives from an unknown type, so all bets are off
            // when trying to find a member. Return an unknown symbol.
            return {
                symbol: Symbol.createWithType(UnknownType.create(), defaultTypeSourceId),
                isInstanceMember: false,
                classType: UnknownType.create(),
                symbolType: UnknownType.create()
            };
        }

        return undefined;
    }

    static getEffectiveTypeOfSymbol(symbol: Symbol): Type {
        // If there's a declared type, it takes precedence.
        const declaredType = this.getDeclaredTypeOfSymbol(symbol);

        if (declaredType) {
            return declaredType;
        }

        return symbol.getInferredType();
    }

    // Returns the initial type of the symbol within scope in which
    // it is declared. For most symbols, this will be "unbound".
    static getInitialTypeOfSymbol(symbol: Symbol): Type {
        if (symbol.isInitiallyUnbound()) {
            return UnboundType.create();
        }

        return this.getEffectiveTypeOfSymbol(symbol);
    }

    static getDeclaredTypeOfSymbol(symbol: Symbol): Type | undefined {
        const declarations = symbol.getDeclarations();
        if (declarations.length > 0) {
            const declWithDeclaredType = declarations.find(decl => decl.declaredType !== undefined);
            if (declWithDeclaredType) {
                return declWithDeclaredType.declaredType;
            }
        }

        return undefined;
    }

    // Returns the "primary" declarations for a symbol. Explicit declarations are
    // preferred. If no explicit declaration exists, inferred declarations are returned.
    static getPrimaryDeclarationsForSymbol(symbol: Symbol): Declaration[] | undefined {
        const declarations = symbol.getDeclarations();
        if (declarations.length > 0) {
            const declsWithDeclaredType = declarations.filter(decl => decl.declaredType !== undefined);
            if (declsWithDeclaredType.length > 0) {
                return declsWithDeclaredType;
            }

            return declarations;
        }

        return undefined;
    }

    static addDefaultFunctionParameters(functionType: FunctionType) {
        functionType.addParameter({
            category: ParameterCategory.VarArgList,
            name: 'args',
            type: UnknownType.create()
        });
        functionType.addParameter({
            category: ParameterCategory.VarArgDictionary,
            name: 'kwargs',
            type: UnknownType.create()
        });
    }

    static getMetaclass(type: ClassType, recursionCount = 0): ClassType | UnknownType | undefined {
        if (recursionCount > _maxTypeRecursion) {
            return undefined;
        }

        for (const base of type.getBaseClasses()) {
            if (base.isMetaclass) {
                if (base.type instanceof ClassType) {
                    return base.type;
                } else {
                    return UnknownType.create();
                }
            }

            if (base.type instanceof ClassType) {
                const metaclass = this.getMetaclass(base.type, recursionCount + 1);
                if (metaclass) {
                    return metaclass;
                }
            }
        }

        return undefined;
    }

    static addTypeVarToListIfUnique(list: TypeVarType[], type: TypeVarType) {
        if (list.find(t => t === type) === undefined) {
            list.push(type);
        }
    }

    // Combines two lists of type var types, maintaining the combined order
    // but removing any duplicates.
    static addTypeVarsToListIfUnique(list1: TypeVarType[], list2: TypeVarType[]) {
        for (const t of list2) {
            this.addTypeVarToListIfUnique(list1, t);
        }
    }

    // Walks the type recursively (in a depth-first manner), finds all
    // type variables that are referenced, and returns an ordered list
    // of unique type variables. For example, if the type is
    // Union[List[Dict[_T1, _T2]], _T1, _T3], the result would be
    // [_T1, _T2, _T3].
    static getTypeVarArgumentsRecursive(type: Type): TypeVarType[] {
        const getTypeVarsFromClass = (classType: ClassType) => {
            const combinedList: TypeVarType[] = [];
            const typeArgs = classType.getTypeArguments();

            if (typeArgs) {
                typeArgs.forEach(typeArg => {
                    if (typeArg instanceof Type) {
                        this.addTypeVarsToListIfUnique(combinedList,
                            this.getTypeVarArgumentsRecursive(typeArg));
                    }
                });
            }

            return combinedList;
        };

        if (type instanceof TypeVarType) {
            return [type];
        } else if (type instanceof ClassType) {
            return getTypeVarsFromClass(type);
        } else if (type instanceof ObjectType) {
            return getTypeVarsFromClass(type.getClassType());
        } else if (type instanceof UnionType) {
            const combinedList: TypeVarType[] = [];
            for (const subtype of type.getTypes()) {
                this.addTypeVarsToListIfUnique(combinedList,
                    this.getTypeVarArgumentsRecursive(subtype));
            }
        }

        return [];
    }

    // If the class is generic, the type is cloned, and its own
    // type parameters are used as type arguments. This is useful
    // for typing "self" or "cls" within a class's implementation.
    static selfSpecializeClassType(type: ClassType, setSkipAbstractClassTest = false): ClassType {
        if (!type.isGeneric() && !setSkipAbstractClassTest) {
            return type;
        }

        const typeArgs = type.getTypeParameters();
        return type.cloneForSpecialization(typeArgs, setSkipAbstractClassTest);
    }

    // Removes the first parameter of the function and returns a new function.
    static stripFirstParameter(type: FunctionType): FunctionType {
        return type.clone(true);
    }

    // Builds a mapping between type parameters and their specialized
    // types. For example, if the generic type is Dict[_T1, _T2] and the
    // specialized type is Dict[str, int], it returns a map that associates
    // _T1 with str and _T2 with int.
    static buildTypeVarMapFromSpecializedClass(classType: ClassType): TypeVarMap {
        const typeArgMap = new TypeVarMap();

        // Get the type parameters for the class.
        const typeParameters = classType.getTypeParameters();
        const typeArgs = classType.getTypeArguments();

        typeParameters.forEach((typeParam, index) => {
            const typeVarName = typeParam.getName();
            let typeArgType: Type;

            if (typeArgs) {
                if (index >= typeArgs.length) {
                    typeArgType = AnyType.create();
                } else {
                    typeArgType = typeArgs[index];
                }
            } else {
                typeArgType = this.specializeTypeVarType(typeParam);
            }

            typeArgMap.set(typeVarName, typeArgType);
        });

        return typeArgMap;
    }

    // Converts a type var type into the most specific type
    // that fits the specified constraints.
    static specializeTypeVarType(type: TypeVarType): Type {
        const subtypes: Type[] = [];
        type.getConstraints().forEach(constraint => {
            subtypes.push(constraint);
        });

        const boundType = type.getBoundType();
        if (boundType) {
            subtypes.push(boundType);
        }

        if (subtypes.length === 0) {
            return AnyType.create();
        }

        return TypeUtils.combineTypes(subtypes);
    }

    static cloneTypeVarMap(typeVarMap: TypeVarMap): TypeVarMap {
        const newTypeVarMap = new TypeVarMap();
        newTypeVarMap.getKeys().forEach(key => {
            newTypeVarMap.set(key, typeVarMap.get(key)!);
        });
        return newTypeVarMap;
    }

    static derivesFromClassRecursive(classType: ClassType, baseClassToFind: ClassType) {
        if (classType.isSameGenericClass(baseClassToFind)) {
            return true;
        }

        for (const baseClass of classType.getBaseClasses()) {
            if (baseClass.type instanceof ClassType) {
                if (this.derivesFromClassRecursive(baseClass.type, baseClassToFind)) {
                    return true;
                }
            }
        }

        return false;
    }

    // If the type is a union, remove any "unknown" or "any" type
    // from the union, returning only the known types.
    static removeAnyFromUnion(type: Type): Type {
        return this.removeFromUnion(type, (t: Type) => t.isAny());
    }

    // If the type is a union, remvoe an "unknown" type from the union,
    // returning only the known types.
    static removeUnknownFromUnion(type: Type): Type {
        return this.removeFromUnion(type, (t: Type) => t.category === TypeCategory.Unknown);
    }

    // If the type is a union, remvoe an "unbound" type from the union,
    // returning only the known types.
    static removeUnboundFromUnion(type: Type): Type {
        return this.removeFromUnion(type, (t: Type) => t.category === TypeCategory.Unbound);
    }

    // If the type is a union, remvoe an "None" type from the union,
    // returning only the known types.
    static removeNoneFromUnion(type: Type): Type {
        return this.removeFromUnion(type, (t: Type) => t.category === TypeCategory.None);
    }

    static removeFromUnion(type: Type, removeFilter: (type: Type) => boolean) {
        if (type instanceof UnionType) {
            const remainingTypes = type.getTypes().filter(t => !removeFilter(t));
            if (remainingTypes.length < type.getTypes().length) {
                return this.combineTypes(remainingTypes);
            }
        }

        return type;
    }

    // Filters a type such that that it is guaranteed not to
    // be falsy. For example, if a type is a union of None
    // and an "int", this method would strip off the "None"
    // and return only the "int".
    static removeFalsinessFromType(type: Type): Type {
        return this.doForSubtypes(type, subtype => {
            if (subtype instanceof ObjectType) {
                const truthyOrFalsy = subtype.getLiteralValue();
                if (truthyOrFalsy !== undefined) {
                    // If the object is already definitely truthy,
                    // it's fine to include.
                    if (truthyOrFalsy) {
                        return subtype;
                    }
                } else {
                    // If the object is potentially falsy, mark it
                    // as definitely truthy here.
                    if (this.canBeFalsy(subtype)) {
                        return subtype.cloneWithLiteral(true);
                    }
                }
            } else if (this.canBeTruthy(subtype)) {
                return subtype;
            }

            return undefined;
        });
    }

    // Filters a type such that that it is guaranteed not to
    // be truthy. For example, if a type is a union of None
    // and a custom class "Foo" that has no __len__ or __nonzero__
    // method, this method would strip off the "Foo"
    // and return only the "None".
    static removeTruthinessFromType(type: Type): Type {
        return this.doForSubtypes(type, subtype => {
            if (subtype instanceof ObjectType) {
                const truthyOrFalsy = subtype.getLiteralValue();
                if (truthyOrFalsy !== undefined) {
                    // If the object is already definitely falsy,
                    // it's fine to include.
                    if (!truthyOrFalsy) {
                        return subtype;
                    }
                } else {
                    // If the object is potentially truthy, mark it
                    // as definitely falsy here.
                    if (this.canBeTruthy(subtype)) {
                        return subtype.cloneWithLiteral(false);
                    }
                }
            } else if (this.canBeFalsy(subtype)) {
                return subtype;
            }

            return undefined;
        });
    }

    // Looks up the specified symbol name within the base classes
    // of a specified class.
    static getSymbolFromBaseClasses(classType: ClassType, name: string,
            recursionCount = 0): SymbolWithClass | undefined {

        if (recursionCount > _maxTypeRecursion) {
            return undefined;
        }

        for (const baseClass of classType.getBaseClasses()) {
            if (baseClass.type instanceof ClassType) {
                const classFields = baseClass.type.getClassFields();
                const symbol = classFields.get(name);
                if (symbol) {
                    return {
                        class: baseClass.type,
                        symbol
                    };
                }

                const symbolWithClass = this.getSymbolFromBaseClasses(baseClass.type,
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

    static doesClassHaveAbstractMethods(classType: ClassType) {
        const abstractMethods = new StringMap<ClassMember>();
        TypeUtils.getAbstractMethodsRecursive(classType, abstractMethods);

        return abstractMethods.getKeys().length > 0;
    }

    static getAbstractMethodsRecursive(classType: ClassType,
            symbolTable: StringMap<ClassMember>, recursiveCount = 0) {

        // Protect against infinite recursion.
        if (recursiveCount > _maxTypeRecursion) {
            return;
        }

        for (const baseClass of classType.getBaseClasses()) {
            if (baseClass.type instanceof ClassType) {
                if (baseClass.type.isAbstractClass()) {
                    // Recursively get abstract methods for subclasses.
                    this.getAbstractMethodsRecursive(baseClass.type,
                        symbolTable, recursiveCount + 1);
                }
            }
        }

        // Remove any entries that are overridden in this class with
        // non-abstract methods.
        if (symbolTable.getKeys().length > 0 || classType.isAbstractClass()) {
            const classFields = classType.getClassFields();
            for (const symbolName of classFields.getKeys()) {
                const symbol = classFields.get(symbolName)!;
                const symbolType = this.getEffectiveTypeOfSymbol(symbol);

                if (symbolType instanceof FunctionType) {
                    if (symbolType.isAbstractMethod()) {
                        symbolTable.set(symbolName, {
                            symbol,
                            isInstanceMember: false,
                            classType,
                            symbolType: this.getEffectiveTypeOfSymbol(symbol)
                        });
                    } else {
                        symbolTable.delete(symbolName);
                    }
                }
            }
        }
    }

    // Returns the declared yield type if provided, or undefined otherwise.
    static getDeclaredGeneratorYieldType(functionType: FunctionType,
            iteratorType: Type): Type | undefined {

        const returnType = functionType.getSpecializedReturnType();
        if (returnType) {
            const generatorTypeArgs = this._getGeneratorReturnTypeArgs(returnType);

            if (generatorTypeArgs && generatorTypeArgs.length >= 1 &&
                    iteratorType instanceof ClassType) {

                // The yield type is the first type arg. Wrap it in an iterator.
                return new ObjectType(iteratorType.cloneForSpecialization(
                    [generatorTypeArgs[0]]));
            }

            // If the return type isn't a Generator, assume that it's the
            // full return type.
            return returnType;
        }

        return undefined;
    }

    // Returns the declared "send" type (the type returned from the yield
    // statement) if it was delcared, or undefined otherwise.
    static getDeclaredGeneratorSendType(functionType: FunctionType): Type | undefined {
        const returnType = functionType.getSpecializedReturnType();
        if (returnType) {
            const generatorTypeArgs = this._getGeneratorReturnTypeArgs(returnType);

            if (generatorTypeArgs && generatorTypeArgs.length >= 2) {
                // The send type is the second type arg.
                return generatorTypeArgs[1];
            }

            return UnknownType.create();
        }

        return undefined;
    }

    // Returns the declared "return" type (the type returned from a return statement)
    // if it was delcared, or undefined otherwise.
    static getDeclaredGeneratorReturnType(functionType: FunctionType): Type | undefined {
        const returnType = functionType.getSpecializedReturnType();
        if (returnType) {
            const generatorTypeArgs = this._getGeneratorReturnTypeArgs(returnType);

            if (generatorTypeArgs && generatorTypeArgs.length >= 3) {
                // The send type is the third type arg.
                return generatorTypeArgs[2];
            }

            return UnknownType.create();
        }

        return undefined;
    }

    static convertClassToObject(type: Type): Type {
        return TypeUtils.doForSubtypes(type, subtype => {
            if (subtype instanceof ClassType) {
                return new ObjectType(subtype);
            }

            return subtype;
        });
    }

    static getMembersForClass(classType: ClassType, symbolTable: SymbolTable,
            includeInstanceVars: boolean) {

        this._getMembersForClassRecursive(classType, symbolTable, includeInstanceVars);
    }

    static containsUnknown(type: Type, recursionCount = 0): boolean {
        if (recursionCount > _maxTypeRecursion) {
            return false;
        }

        if (type instanceof UnknownType) {
            return true;
        }

        // See if a union contains an unknown type.
        if (type instanceof UnionType) {
            for (const subtype of type.getTypes()) {
                if (this.containsUnknown(subtype, recursionCount + 1)) {
                    return true;
                }
            }

            return false;
        }

        // See if an object or class has an unknown type argument.
        if (type instanceof ObjectType) {
            return this.containsUnknown(type.getClassType(), recursionCount + 1);
        }

        if (type instanceof ClassType) {
            const typeArgs = type.getTypeArguments();
            if (typeArgs) {
                for (const argType of typeArgs) {
                    if (this.containsUnknown(argType, recursionCount + 1)) {
                        return true;
                    }
                }
            }

            return false;
        }

        return false;
    }

    static isEnumClass(classType: ClassType): boolean {
        // Does the class have an "EnumMeta" metaclass?
        const metaclass = TypeUtils.getMetaclass(classType);

        return metaclass instanceof ClassType &&
            metaclass.getClassName() === 'EnumMeta';
    }

    private static _getMembersForClassRecursive(classType: ClassType,
            symbolTable: SymbolTable, includeInstanceVars: boolean,
            recursionCount = 0) {

        if (recursionCount > _maxTypeRecursion) {
            return;
        }

        // Add any new instance variables.
        if (includeInstanceVars) {
            classType.getInstanceFields().forEach((symbol, name) => {
                if (!symbolTable.get(name)) {
                    symbolTable.set(name, symbol);
                }
            });
        }

        // Add any new class variables.
        classType.getClassFields().forEach((symbol, name) => {
            if (!symbolTable.get(name)) {
                symbolTable.set(name, symbol);
            }
        });

        classType.getBaseClasses().forEach(baseClassType => {
            if (!baseClassType.isMetaclass && baseClassType.type instanceof ClassType) {
                this._getMembersForClassRecursive(baseClassType.type,
                    symbolTable, includeInstanceVars, recursionCount + 1);
            }
        });
    }

    private static _partiallySpecializeFunctionForBoundClassOrObject(
            baseType: ClassType | ObjectType, memberType: FunctionType): Type {

        const classType = baseType instanceof ClassType ? baseType : baseType.getClassType();

        // If the class has already been specialized (fully or partially), use its
        // existing type arg mappings. If it hasn't, use a fresh type arg map.
        const typeVarMap = classType.getTypeArguments() ?
            TypeUtils.buildTypeVarMapFromSpecializedClass(classType) :
            new TypeVarMap();

        if (memberType.getParameterCount() > 0) {
            const firstParam = memberType.getParameters()[0];

            // Fill out the typeVarMap.
            TypeUtils.canAssignType(firstParam.type, baseType, new DiagnosticAddendum(), typeVarMap);
        }

        const specializedFunction = TypeUtils.specializeType(
            memberType, typeVarMap) as FunctionType;
        return TypeUtils.stripFirstParameter(specializedFunction);
    }

    private static _canAssignFunction(destType: FunctionType, srcType: FunctionType,
            diag: DiagnosticAddendum, typeVarMap: TypeVarMap | undefined,
            recursionCount: number, checkNamedParams: boolean): boolean {

        let canAssign = true;

        const srcParamCount = srcType.getParameterCount();
        const destParamCount = destType.getParameterCount();
        const minParamCount = Math.min(srcParamCount, destParamCount);

        // Match as many input parameters as we can.
        for (let paramIndex = 0; paramIndex < minParamCount; paramIndex++) {
            const srcParam = srcType.getParameters()[paramIndex];
            const destParam = destType.getParameters()[paramIndex];
            const paramDiag = diag.createAddendum();

            // If the dest or source involve var-args, no need to continue matching.
            if (srcParam.category !== ParameterCategory.Simple ||
                    destParam.category !== ParameterCategory.Simple) {
                break;
            }

            const srcParamType = srcType.getEffectiveParameterType(paramIndex);
            const destParamType = destType.getEffectiveParameterType(paramIndex);

            // Call canAssignType once to perform any typeVarMap population.
            this.canAssignType(destParamType, srcParamType, paramDiag.createAddendum(), typeVarMap,
                    true, recursionCount + 1);

            // Make sure we can assign the specialized dest type to the
            // source type.
            const specializedDestParamType = this.specializeType(
                destParamType, typeVarMap, recursionCount + 1);
            if (!this.canAssignType(srcParamType, specializedDestParamType, paramDiag.createAddendum(),
                    undefined, true, recursionCount + 1)) {
                paramDiag.addMessage(`Parameter ${ paramIndex + 1 } of type ` +
                    `'${ specializedDestParamType.asString() }' cannot be assigned to type ` +
                    `'${ srcParamType.asString() }'`);
                canAssign = false;
            }
        }

        const srcParams = srcType.getParameters();
        const destParams = destType.getParameters();

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
                            const specializedDestParamType = this.specializeType(
                                destParam.type, typeVarMap, recursionCount + 1);
                            if (!this.canAssignType(param.type, specializedDestParamType,
                                    paramDiag.createAddendum(), undefined, true, recursionCount + 1)) {
                                paramDiag.addMessage(`Named parameter '${ param.name }' of type ` +
                                    `'${ specializedDestParamType.asString() }' cannot be assigned to type ` +
                                    `'${ param.type.asString() }'`);
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
        // accept all of the dest argments.
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
        const srcReturnType = srcType.getEffectiveReturnType();
        const destReturnType = destType.getEffectiveReturnType();

        if (!this.canAssignType(destReturnType, srcReturnType, diag.createAddendum(),
                typeVarMap, true, recursionCount + 1)) {
            diag.addMessage(`Function return type '${ srcReturnType.asString() }' ` +
                `is not compatible with type '${ destReturnType.asString() }'.`);
            canAssign = false;
        }

        return canAssign;
    }

    private static _canAssignClass(destType: ClassType, srcType: ClassType,
            diag: DiagnosticAddendum, typeVarMap: TypeVarMap | undefined,
            allowSubclasses: boolean, recursionCount: number,
            reportErrorsUsingObjType: boolean): boolean {

        // Is it a structural type (i.e. a protocol)? If so, we need to
        // perform a member-by-member check.
        if (destType.isProtocol()) {
            const destClassFields = destType.getClassFields();

            // Some protocol definitions include recursive references to themselves.
            // We need to protect against infinite recursion, so we'll check for that here.
            if (srcType.isSame(destType)) {
                return true;
            }

            const missingNames: string[] = [];
            const wrongTypes: string[] = [];
            const destClassTypeVarMap = this.buildTypeVarMapFromSpecializedClass(destType);

            destClassFields.forEach((symbol, name) => {
                const memberInfo = TypeUtils.lookUpClassMember(srcType, name,
                    ClassMemberLookupFlags.SkipInstanceVariables);
                if (!memberInfo) {
                    diag.addMessage(`'${ name }' is not present`);
                    missingNames.push(name);
                } else {
                    const primaryDecls = this.getPrimaryDeclarationsForSymbol(symbol);
                    if (primaryDecls && primaryDecls.length > 0 && primaryDecls[0].declaredType) {
                        let destMemberType = primaryDecls[0].declaredType;
                        destMemberType = this.specializeType(destMemberType, destClassTypeVarMap);
                        const srcMemberType = memberInfo.symbolType;

                        if (!TypeUtils.canAssignType(destMemberType, srcMemberType,
                                diag.createAddendum(), typeVarMap, true, recursionCount + 1)) {
                            diag.addMessage(`'${ name }' is an incompatible type`);
                            wrongTypes.push(name);
                        }
                    }
                }
            });

            if (missingNames.length > 0 || wrongTypes.length > 0) {
                return false;
            }

            return true;
        }

        if (!allowSubclasses && !srcType.isSameGenericClass(destType)) {
            const destErrorType = reportErrorsUsingObjType ? new ObjectType(destType) : destType;
            const srcErrorType = reportErrorsUsingObjType ? new ObjectType(srcType) : srcType;
            diag.addMessage(`'${ srcErrorType.asString() }' is incompatible with ` +
                `'${ destErrorType.asString() }'`);
            return false;
        }

        const inheritanceChain: InheritanceChain = [];
        if (srcType.isDerivedFrom(destType, inheritanceChain)) {
            assert(inheritanceChain.length > 0);

            return this._canAssignClassWithTypeArgs(srcType, inheritanceChain,
                diag, typeVarMap, recursionCount + 1);
        }

        // Special-case int-to-float conversion.
        if (srcType.isBuiltIn() && srcType.getClassName() === 'int' &&
                destType.isBuiltIn() && destType.getClassName() === 'float') {
            return true;
        }

        const destErrorType = reportErrorsUsingObjType ? new ObjectType(destType) : destType;
        const srcErrorType = reportErrorsUsingObjType ? new ObjectType(srcType) : srcType;
        diag.addMessage(`'${ srcErrorType.asString() }' is incompatible with ` +
            `'${ destErrorType.asString() }'`);
        return false;
    }

    // Determines whether the specified type can be assigned to the
    // specified inheritance chain, taking into account its type arguments.
    private static _canAssignClassWithTypeArgs(srcType: ClassType,
            inheritanceChain: InheritanceChain, diag: DiagnosticAddendum,
            typeVarMap: TypeVarMap | undefined, recursionCount: number): boolean {

        let curSrcType = srcType;

        for (let ancestorIndex = inheritanceChain.length - 1; ancestorIndex >= 0; ancestorIndex--) {
            const ancestorType = inheritanceChain[ancestorIndex];

            if (ancestorType.isAny()) {
                return true;
            }

            if (ancestorType instanceof ClassType) {
                // If this isn't the first time through the loop, specialize
                // for the next ancestor in the chain.
                if (ancestorIndex < inheritanceChain.length - 1) {
                    curSrcType = this._specializeForBaseClass(curSrcType,
                        ancestorType, recursionCount + 1);
                }

                if (ancestorType.isSpecialBuiltIn()) {
                    assert(curSrcType.isSameGenericClass(ancestorType));

                    // Handle built-in types that support arbitrary numbers
                    // of type parameters like Tuple.
                    if (ancestorType.getClassName() === 'Tuple') {
                        const ancestorTypeArgs = ancestorType.getTypeArguments() || [];
                        const srcTypeArgs = curSrcType.getTypeArguments() || [];
                        let destArgCount = ancestorTypeArgs.length;
                        const destAllowsMoreArgs = destArgCount &&
                            TypeUtils.isEllipsisType(ancestorTypeArgs[destArgCount - 1]);
                        if (destAllowsMoreArgs) {
                            destArgCount--;
                        }

                        if (srcTypeArgs.length === destArgCount ||
                                (destAllowsMoreArgs && srcTypeArgs.length >= destArgCount)) {
                            for (let i = 0; i < destArgCount; i++) {
                                if (!this.canAssignType(ancestorTypeArgs[i], srcTypeArgs[i],
                                        diag.createAddendum(), typeVarMap, undefined, recursionCount + 1)) {
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
                const ancestorTypeParams = ancestorType.getTypeParameters();
                if (ancestorTypeParams.length === 0) {
                    continue;
                }

                assert(curSrcType.isSameGenericClass(ancestorType));

                const ancestorTypeArgs = ancestorType.getTypeArguments()!;
                // If the dest type isn't specialized, there are no type
                // args to validate.
                if (!ancestorTypeArgs) {
                    return true;
                }

                // Validate that the type arguments match.
                const srcTypeArgs = curSrcType.getTypeArguments();
                if (srcTypeArgs) {
                    if (srcType.isSpecialBuiltIn() || srcTypeArgs.length === ancestorTypeArgs.length) {
                        for (let srcArgIndex = 0; srcArgIndex < srcTypeArgs.length; srcArgIndex++) {
                            const srcTypeArg = srcTypeArgs[srcArgIndex];

                            // In most cases, the ancestor type param count should match, but
                            // there are a few special cases where this isn't true (e.g. assigning
                            // a Tuple[X, Y, Z] to a tuple[W]).
                            const ancestorArgIndex = srcArgIndex >= ancestorTypeParams.length ?
                                    ancestorTypeParams.length - 1 : srcArgIndex;
                            const typeParam = ancestorTypeParams[ancestorArgIndex];
                            const ancestorTypeArg = ancestorTypeArgs[ancestorArgIndex];

                            if (typeParam.isCovariant()) {
                                if (!this.canAssignType(ancestorTypeArg, srcTypeArg,
                                        diag.createAddendum(), typeVarMap, true, recursionCount + 1)) {
                                    return false;
                                }
                            } else if (typeParam.isContravariant()) {
                                if (!this.canAssignType(srcTypeArg, ancestorTypeArg,
                                        diag.createAddendum(), typeVarMap, true, recursionCount + 1)) {
                                    return false;
                                }
                            } else {
                                if (!this.canAssignType(ancestorTypeArg, srcTypeArg,
                                        diag.createAddendum(), typeVarMap, false, recursionCount + 1)) {
                                    return false;
                                }
                            }
                        }
                    }
                }
            }
        }

        return true;
    }

    private static _getCallbackProtocolType(objType: ObjectType): FunctionType | undefined {
        if (!objType.getClassType().isProtocol()) {
            return undefined;
        }

        const callMember = this.lookUpObjectMember(objType, '__call__');
        if (!callMember) {
            return undefined;
        }

        if (callMember.symbolType instanceof FunctionType) {
            return TypeUtils.bindFunctionToClassOrObject(objType,
                callMember.symbolType) as FunctionType;
        }

        return undefined;
    }

    // Determines the specialized base class type that srcType derives from.
    private static _specializeForBaseClass(srcType: ClassType, baseClass: ClassType,
            recursionCount: number): ClassType {

        const typeParams = baseClass.getTypeParameters();

        // If there are no type parameters for the specified base class,
        // no specialization is required.
        if (typeParams.length === 0) {
            return baseClass;
        }

        const typeVarMap = this.buildTypeVarMapFromSpecializedClass(srcType);
        const specializedType = this.specializeType(baseClass, typeVarMap, recursionCount + 1);
        assert(specializedType instanceof ClassType);
        return specializedType as ClassType;
    }

    private static _specializeClassType(classType: ClassType, typeVarMap: TypeVarMap | undefined,
            recursionLevel: number): ClassType {

        // Handle the common case where the class has no type parameters.
        if (classType.getTypeParameters().length === 0) {
            return classType;
        }

        const oldTypeArgs = classType.getTypeArguments();
        let newTypeArgs: Type[] = [];
        let specializationNeeded = false;

        // If type args were previously provided, specialize them.
        if (oldTypeArgs) {
            newTypeArgs = oldTypeArgs.map(oldTypeArgType => {
                const newTypeArgType = this.specializeType(oldTypeArgType,
                    typeVarMap, recursionLevel + 1);
                if (newTypeArgType !== oldTypeArgType) {
                    specializationNeeded = true;
                }
                return newTypeArgType;
            });
        } else {
            classType.getTypeParameters().forEach(typeParam => {
                let typeArgType: Type;

                if (typeVarMap && typeVarMap.get(typeParam.getName())) {
                    // If the type var map already contains this type var, use
                    // the existing type.
                    typeArgType = typeVarMap.get(typeParam.getName())!;
                    specializationNeeded = true;
                } else {
                    // If the type var map wasn't provided or doesn't contain this
                    // type var, specialize the type var.
                    typeArgType = TypeUtils.specializeTypeVarType(typeParam);
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

        return classType.cloneForSpecialization(newTypeArgs);
    }

    private static _getConcreteTypeFromTypeVar(type: TypeVarType, recursionLevel: number): Type {
        const boundType = type.getBoundType();
        if (boundType) {
            return this.specializeType(boundType, undefined, recursionLevel + 1);
        }

        const constraints = type.getConstraints();
        if (constraints.length === 0) {
            return AnyType.create();
        }

        const concreteTypes = constraints.map(constraint =>
            this.specializeType(constraint, undefined, recursionLevel + 1)
        );

        return TypeUtils.combineTypes(concreteTypes);
    }

    private static _specializeOverloadedFunctionType(type: OverloadedFunctionType,
            typeVarMap: TypeVarMap | undefined, recursionLevel: number): OverloadedFunctionType {

        // Specialize each of the functions in the overload.
        const overloads = type.getOverloads().map(entry => {
            const newEntry: OverloadedFunctionEntry = {
                type: this._specializeFunctionType(entry.type, typeVarMap, recursionLevel),
                typeSourceId: entry.typeSourceId
            };

            return newEntry;
        });

        // Construct a new overload with the specialized function types.
        const newOverloadType = new OverloadedFunctionType();
        overloads.forEach(overload => {
            newOverloadType.addOverload(overload.typeSourceId, overload.type);
        });

        return newOverloadType;
    }

    private static _specializeFunctionType(functionType: FunctionType,
            typeVarMap: TypeVarMap | undefined, recursionLevel: number): FunctionType {

        const returnType = functionType.getEffectiveReturnType();
        const specializedReturnType = this.specializeType(returnType,
            typeVarMap, recursionLevel + 1);
        let typesRequiredSpecialization = returnType !== specializedReturnType;

        const specializedParameters: SpecializedFunctionTypes = {
            parameterTypes: [],
            returnType: specializedReturnType
        };

        for (let i = 0; i < functionType.getParameterCount(); i++) {
            const paramType = functionType.getEffectiveParameterType(i);
            const specializedType = this.specializeType(paramType,
                typeVarMap, recursionLevel + 1);
            specializedParameters.parameterTypes.push(specializedType);

            if (paramType !== specializedType) {
                typesRequiredSpecialization = true;
            }
        }

        if (!typesRequiredSpecialization) {
            return functionType;
        }

        return functionType.cloneForSpecialization(specializedParameters);
    }

    // If the declared return type for the function is a Generator or AsyncGenerator,
    // returns the type arguments for the type.
    private static _getGeneratorReturnTypeArgs(returnType: Type): Type[] | undefined {
        if (returnType instanceof ObjectType) {
            const classType = returnType.getClassType();
            if (classType.isBuiltIn()) {
                const className = classType.getClassName();
                if (className === 'Generator' || className === 'AsyncGenerator') {
                    return classType.getTypeArguments();
                }
            }
        }

        return undefined;
    }

    private static _addTypeIfUnique(types: Type[], typeToAdd: Type) {
        for (const type of types) {
            // Does this type already exist in the types array?
            if (type.isSame(typeToAdd)) {
                return;
            }

            // If the typeToAdd is a literal value and there's already
            // a non-literal type that matches, don't add the literal value.
            if (type instanceof ObjectType && typeToAdd instanceof ObjectType) {
                if (this.isSameWithoutLiteralValue(type, typeToAdd)) {
                    if (type.getLiteralValue() === undefined) {
                        return;
                    }
                }
            }
        }

        types.push(typeToAdd);
    }
}
