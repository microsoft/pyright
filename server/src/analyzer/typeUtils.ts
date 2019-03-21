/*
* typeUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Collection of static methods that operate on Type objects.
*/

import * as assert from 'assert';

import { ParameterCategory } from '../parser/parseNodes';
import { Symbol } from './symbol';
import { AnyType, ClassType, FunctionType,
    NoneType, ObjectType, OverloadedFunctionType, SpecializedFunctionTypes, TupleType,
    Type, TypeCategory, TypeVarMap, TypeVarType, UnionType, UnknownType } from './types';

const MaxCanAssignTypeRecursion = 20;

export interface ClassMember {
    symbol?: Symbol;
    isInstanceMember: boolean;
    class?: ClassType;
}

export class TypeUtils {
    // Combines two types into a single type. If the types are
    // the same, only one is returned. If they differ, they
    // are combined into a UnionType.
    static combineTypes(type1: Type, type2: Type): Type {
        if (type1.isSame(type2)) {
            return type1;
        }

        let unionType = new UnionType();

        if (type1 instanceof UnionType) {
            unionType.addTypes(type1.getTypes());
        } else {
            unionType.addTypes([type1]);
        }

        if (type2 instanceof UnionType) {
            unionType.addTypes(type2.getTypes());
        } else {
            unionType.addTypes([type2]);
        }

        return unionType;
    }

    static combineTypesArray(types: Type[]): Type {
        assert(types.length > 0);

        let resultingType = types[0];
        types.forEach((t, index) => {
            if (index > 0) {
                resultingType = this.combineTypes(resultingType, t);
            }
        });

        return resultingType;
    }

    static isInstanceOf(objectType: ObjectType, classType: ClassType): boolean {
        return objectType.getClassType().isDerivedFrom(classType);
    }

    // Determines if the source type can be assigned to the dest type.
    // If typeVarMap is provided, type variables within the destType are
    // matched against existing type variables in the map. If a type variable
    // in the dest type is not in the type map already, it is assigned a type
    // and added to the map.
    static canAssignType(destType: Type, srcType: Type, typeVarMap?: TypeVarMap,
            recursionCount = 0): boolean {

        if (destType.isAny() || srcType.isAny()) {
            return true;
        }

        if (srcType instanceof TypeVarType) {
            // This should happen only if we have a bug and forgot to specialize
            // the source type or the code being analyzed contains a bug where
            // a return type uses a type var that is not referenced elswhere
            // in a function.
            return false;
        }

        if (destType instanceof TypeVarType) {
            // If the dest type includes type variables, it is not yet
            // specialized, so the caller should have provided a typeVarMap.
            assert(typeVarMap);

            const existingTypeVarMapping = typeVarMap!.get(destType.getName());
            if (existingTypeVarMapping) {
                return this.canAssignType(existingTypeVarMapping, srcType,
                    typeVarMap, recursionCount + 1);
            }

            typeVarMap!.set(destType.getName(), srcType);
            return this._canAssignToTypeVar(destType, srcType);
        }

        if (recursionCount > MaxCanAssignTypeRecursion) {
            return true;
        }

        if (srcType instanceof UnionType) {
            // For union sources, all of the types need to be assignable to the dest.
            return srcType.getTypes().find(
                t => !this.canAssignType(destType, t, typeVarMap, recursionCount + 1)) === undefined;
        }

        if (destType instanceof UnionType) {
            // For union destinations, we just need to match one of the types.
            return destType.getTypes().find(
                t => this.canAssignType(t, srcType, typeVarMap, recursionCount + 1)) !== undefined;
        }

        if (destType.category === TypeCategory.Unbound ||
                srcType.category === TypeCategory.Unbound) {
            return false;
        }

        if (destType.category === TypeCategory.None && srcType.category === TypeCategory.None) {
            return true;
        }

        if (destType instanceof ObjectType) {
            const destClassType = destType.getClassType();

            // Construct a generic tuple object using the built-in tuple
            // class so we can perform a comparison.
            if (srcType instanceof TupleType) {
                srcType = new ObjectType(srcType.getBaseClass());
            }

            if (srcType instanceof ObjectType) {
                return this._canAssignClassType(destClassType, srcType.getClassType(),
                    typeVarMap, recursionCount + 1);
            }
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
                }
            }

            if (destType instanceof ClassType) {
                return this._canAssignClassType(destType, srcType,
                    typeVarMap, recursionCount + 1);
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
                    const typeVarMapClone = typeVarMap ? TypeUtils.cloneTypeVarMap(typeVarMap) : undefined;
                    return this.canAssignType(destType, overload.type,
                        typeVarMapClone, recursionCount + 1);
                });
                if (overloadIndex < 0) {
                    return false;
                }
                srcFunction = overloads[overloadIndex].type;
            } else if (srcType instanceof FunctionType) {
                srcFunction = srcType;
            } else if (srcType instanceof ObjectType) {
                const callMember = this.lookUpObjectMember(srcType, '__call__');
                if (callMember) {
                    let srcClassTypeVarMap = this.buildTypeVarMapFromSpecializedClass(srcType.getClassType());
                    let callType = TypeUtils.getEffectiveTypeOfMember(callMember);
                    callType = this.specializeType(callType, srcClassTypeVarMap);
                    if (callType instanceof FunctionType) {
                        srcFunction = TypeUtils.stripFirstParameter(callType);
                    }
                }
            } else if (srcType instanceof ClassType) {
                // TODO - need to create function corresponding to constructor for class.
                return false;
            }

            if (srcFunction) {
                return this._canAssignFunction(destType, srcFunction,
                    typeVarMap, recursionCount + 1);
            }
        }

        if (destType instanceof TupleType && srcType instanceof TupleType) {
            const destEntries = destType.getEntryTypes();
            const srcEntries = srcType.getEntryTypes();

            if (destEntries.length !== srcEntries.length) {
                return false;
            }

            if (srcEntries.find((srcEntry, index) =>
                    !this.canAssignType(destEntries[index], srcEntry,
                        typeVarMap, recursionCount + 1))) {
                return false;
            }

            return true;
        }

        // None derives from object.
        if (srcType instanceof NoneType) {
            if (destType instanceof ObjectType) {
                let destClassType = destType.getClassType();
                if (destClassType.isBuiltIn() && destClassType.getClassName() === 'object') {
                    return true;
                }
            }
        }

        return false;
    }

    private static _canAssignFunction(destType: FunctionType, srcType: FunctionType,
            typeVarMap: TypeVarMap | undefined, recursionCount: number): boolean {

        let canAssign = true;

        // TODO - handle the case where either the source or dest have custom decorators

        const srcParamCount = srcType.getParameterCount();
        const destParamCount = destType.getParameterCount();
        const minParmaCount = Math.min(srcParamCount, destParamCount);

        // TODO - need to add more logic here
        // if (srcParamCount !== destParamCount) {
        //     canAssign = false;
        // }

        // Match as many input parameters as we can.
        for (let paramIndex = 0; paramIndex < minParmaCount; paramIndex++) {
            const srcParam = srcType.getParameters()[paramIndex];
            const destParam = destType.getParameters()[paramIndex];

            if (srcParam.category !== ParameterCategory.Simple) {
                // TODO - properly handle var-args
                break;
            }

            if (destParam.category !== ParameterCategory.Simple) {
                // TODO - properly handle var-args
                break;
            }

            const srcParamType = srcType.getEffectiveParameterType(paramIndex);
            const destParamType = destType.getEffectiveParameterType(paramIndex);
            if (!this.canAssignType(destParamType, srcParamType, typeVarMap, recursionCount + 1)) {
                canAssign = false;
            }
        }

        // Match the return parameter.
        const srcReturnType = srcType.getEffectiveReturnType();
        const destReturnType = destType.getEffectiveReturnType();

        if (!this.canAssignType(destReturnType, srcReturnType, typeVarMap, recursionCount + 1)) {
            canAssign = false;
        }

        return canAssign;
    }

    private static _canAssignClassType(destType: ClassType, srcType: ClassType,
            typeVarMap: TypeVarMap | undefined, recursionCount: number): boolean {

        // Is it a structural type (i.e. a protocol)? If so, we need to
        // perform a member-by-member check.
        if (destType.isProtocol()) {
            const destClassFields = destType.getClassFields();

            // Some protocol definitions include recursive references to themselves.
            // We need to protect against infinite recursion, so we'll check for that here.
            if (srcType.isProtocol() && srcType.isSameProtocol(destType)) {
                return true;
            }

            let missingNames: string[] = [];
            let wrongTypes: string[] = [];
            let srcClassTypeVarMap = this.buildTypeVarMapFromSpecializedClass(srcType);
            let destClassTypeVarMap = this.buildTypeVarMapFromSpecializedClass(destType);

            destClassFields.forEach((symbol, name) => {
                const classMemberInfo = TypeUtils.lookUpClassMember(srcType, name, false);
                if (!classMemberInfo) {
                    missingNames.push(name);
                } else {
                    if (symbol.declarations && symbol.declarations[0].declaredType) {
                        let destMemberType = symbol.declarations[0].declaredType;
                        destMemberType = this.specializeType(destMemberType, destClassTypeVarMap);
                        let srcMemberType = TypeUtils.getEffectiveTypeOfMember(classMemberInfo);
                        srcMemberType = this.specializeType(srcMemberType, srcClassTypeVarMap);

                        if (!TypeUtils.canAssignType(srcMemberType, destMemberType,
                                typeVarMap, recursionCount + 1)) {
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

        if (srcType.isDerivedFrom(destType)) {
            // TODO - need to validate type parameter matches
            return true;
        }

        if (srcType.isBuiltIn()) {
            if (srcType.getClassName() === 'int') {
                if (this.lookUpClassMember(destType, '__int__')) {
                    return true;
                }
            }

            if (srcType.getClassName() === 'float') {
                if (this.lookUpClassMember(destType, '__float__')) {
                    return true;
                }
            }
        }

        return false;
    }

    // Validates that the specified source type matches the constraints
    // of the type variable.
    private static _canAssignToTypeVar(destType: TypeVarType, srcType: Type): boolean {
        if (srcType.isAny()) {
            return true;
        }

        // If there's a bound type, make sure it matches.
        const boundType = destType.getBoundType();
        if (boundType) {
            if (destType.isCovariant()) {
                if (srcType.isAny()) {
                    return true;
                } else if (srcType instanceof ClassType && boundType instanceof ClassType) {
                    return srcType.isDerivedFrom(boundType);
                } else {
                    return false;
                }
            } else if (destType.isContravariant()) {
                if (srcType.isAny()) {
                    return true;
                } else if (srcType instanceof ClassType && boundType instanceof ClassType) {
                    return boundType.isDerivedFrom(srcType);
                } else {
                    return false;
                }
            } else {
                if (srcType.isAny()) {
                    return true;
                } else if (srcType instanceof ClassType && boundType instanceof ClassType) {
                    return srcType.isSame(boundType);
                } else {
                    return false;
                }
            }
        }

        // If there are no constraints, we're done.
        let constraints = destType.getConstraints();
        if (constraints.length === 0) {
            return true;
        }

        for (const constraint of constraints) {
            if (constraint.isAny()) {
                return true;
            }

            if (srcType instanceof UnionType) {
                return srcType.getTypes().find(t => constraint.isSame(t)) !== undefined;
            }

            if (constraint.isSame(srcType)) {
                return true;
            }
        }

        return false;
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
            let subtypes: Type[] = [];
            type.getTypes().forEach(typeEntry => {
                subtypes.push(this.specializeType(typeEntry, typeVarMap,
                    recursionLevel + 1));
            });

            return TypeUtils.combineTypesArray(subtypes);
        }

        if (type instanceof ObjectType) {
            const classType = this._specializeClassType(type.getClassType(),
                typeVarMap, recursionLevel + 1);
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

        if (type instanceof TupleType) {
            // TODO - need to implement
            return type;
        }

        if (type instanceof FunctionType) {
            return this._specializeFunctionType(type, typeVarMap,
                recursionLevel + 1);
        }

        // TODO - need to implement
        return type;
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

        classType.getTypeParameters().forEach((typeParam, index) => {
            let typeArgType: Type;

            // If type args were previously provided, specialize them.
            // Otherwise use the specialized type parameter.
            if (oldTypeArgs) {
                if (index >= oldTypeArgs.length) {
                    typeArgType = AnyType.create();
                    specializationNeeded = true;
                } else {
                    typeArgType = this.specializeType(oldTypeArgs[index] as Type,
                        typeVarMap, recursionLevel + 1);
                    if (typeArgType !== oldTypeArgs[index] as Type) {
                        specializationNeeded = true;
                    }
                }
            } else {
                typeArgType = TypeUtils.specializeTypeVarType(typeParam);
                if (typeArgType !== typeParam) {
                    specializationNeeded = true;
                }
            }

            newTypeArgs.push(typeArgType);
        });

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

        let concreteTypes = constraints.map(constraint =>
            this.specializeType(constraint, undefined, recursionLevel + 1)
        );

        return TypeUtils.combineTypesArray(concreteTypes);
    }

    private static _specializeFunctionType(functionType: FunctionType,
            typeVarMap: TypeVarMap | undefined, recursionLevel: number): FunctionType {

        const returnType = functionType.getEffectiveReturnType();
        const specializedReturnType = this.specializeType(returnType,
            typeVarMap, recursionLevel + 1);
        let typesRequiredSpecialization = returnType !== specializedReturnType;

        let specializedParameters: SpecializedFunctionTypes = {
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

    // Looks up a member in a class using the multiple-inheritance rules
    // defined by Python. For more detials, see this note on method resolution
    // order: https://www.python.org/download/releases/2.3/mro/.
    static lookUpClassMember(classType: Type, memberName: string,
            includeInstanceFields = true, searchBaseClasses = true): ClassMember | undefined {

        if (classType instanceof ClassType) {
            // TODO - for now, use naive depth-first search.

            // Look in the instance fields first if requested.
            if (includeInstanceFields) {
                const instanceFields = classType.getInstanceFields();
                const instanceFieldEntry = instanceFields.get(memberName);
                if (instanceFieldEntry) {
                    let symbol = instanceFieldEntry;

                    return {
                        symbol,
                        isInstanceMember: true,
                        class: classType
                    };
                }
            }

            // Next look in the class fields.
            const classFields = classType.getClassFields();
            const classFieldEntry = classFields.get(memberName);
            if (classFieldEntry) {
                let symbol = classFieldEntry;

                return {
                    symbol,
                    isInstanceMember: false,
                    class: classType
                };
            }

            if (searchBaseClasses) {
                for (let baseClass of classType.getBaseClasses()) {
                    let methodType = this.lookUpClassMember(baseClass.type,
                        memberName, searchBaseClasses);
                    if (methodType) {
                        return methodType;
                    }
                }
            }
        } else if (classType.isAny()) {
            return {
                isInstanceMember: false
            };
        }

        return undefined;
    }

    static getEffectiveTypeOfMember(member: ClassMember): Type {
        if (!member.symbol) {
            return UnknownType.create();
        }

        if (member.symbol.declarations) {
            if (member.symbol.declarations[0].declaredType) {
                return member.symbol.declarations[0].declaredType;
            }
        }

        return member.symbol.inferredType.getType();
    }

    static lookUpObjectMember(objectType: Type, memberName: string): ClassMember | undefined {
        if (objectType instanceof ObjectType) {
            return this.lookUpClassMember(objectType.getClassType(), memberName);
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

    static getMetaclass(type: ClassType): ClassType | UnknownType | undefined {
        for (let base of type.getBaseClasses()) {
            if (base.isMetaclass) {
                if (base.type instanceof ClassType) {
                    return base.type;
                } else {
                    return UnknownType.create();
                }
            }

            if (base.type instanceof ClassType) {
                // TODO - add protection for infinite recursion
                let metaclass = this.getMetaclass(base.type);
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
        for (let t of list2) {
            this.addTypeVarToListIfUnique(list1, t);
        }
    }

    static getTypeVarArgumentsRecursive(type: Type): TypeVarType[] {
        let getTypeVarsFromClass = (classType: ClassType) => {
            let combinedList: TypeVarType[] = [];
            let typeArgs = classType.getTypeArguments();

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
            let combinedList: TypeVarType[] = [];
            for (let subtype of type.getTypes()) {
                this.addTypeVarsToListIfUnique(combinedList,
                    this.getTypeVarArgumentsRecursive(subtype));
            }
        }

        return [];
    }

    // If the class is generic, the type is cloned, and its own
    // type parameters are used as type arguments. This is useful
    // for typing "self" or "cls" within a class's implementation.
    static selfSpecializeClassType(type: ClassType): ClassType {
        if (!type.isGeneric()) {
            return type;
        }

        let typeArgs = type.getTypeParameters();
        return type.cloneForSpecialization(typeArgs);
    }

    // Removes the first parameter of the function and returns a new function.
    static stripFirstParameter(type: FunctionType): FunctionType {
        return type.clone(true);
    }

    static buildTypeVarMapFromSpecializedClass(classType: ClassType): TypeVarMap {
        let typeArgMap = new TypeVarMap();

        // Get the type parameters for the class.
        let typeParameters = classType.getTypeParameters();
        let typeArgs = classType.getTypeArguments();

        typeParameters.forEach((typeParam, index) => {
            const typeVarName = typeParam.getName();
            let typeArgType: Type;

            if (typeArgs) {
                if (index >= typeArgs.length) {
                    typeArgType = AnyType.create();
                } else {
                    typeArgType = typeArgs[index] as Type;
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
        let subtypes: Type[] = [];
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

        return TypeUtils.combineTypesArray(subtypes);
    }

    static cloneTypeVarMap(typeVarMap: TypeVarMap): TypeVarMap {
        let newTypeVarMap = new TypeVarMap();
        newTypeVarMap.getKeys().forEach(key => {
            newTypeVarMap.set(key, typeVarMap.get(key)!);
        });
        return newTypeVarMap;
    }
}
