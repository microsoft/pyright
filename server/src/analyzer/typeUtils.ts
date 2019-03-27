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

    // Determines if the source type can be assigned to the dest type.
    // If typeVarMap is provided, type variables within the destType are
    // matched against existing type variables in the map. If a type variable
    // in the dest type is not in the type map already, it is assigned a type
    // and added to the map.
    static canAssignType(destType: Type, srcType: Type, typeVarMap?: TypeVarMap,
            allowSubclasses = true, recursionCount = 0): boolean {

        // Before performing any other checks, see if the dest type is a
        // TypeVar that we are attempting to match.
        if (destType instanceof TypeVarType) {
            // If the dest type includes type variables, it is not yet
            // specialized, so the caller should have provided a typeVarMap.
            if (typeVarMap) {
                const existingTypeVarMapping = typeVarMap.get(destType.getName());
                if (existingTypeVarMapping) {
                    return this.canAssignType(existingTypeVarMapping, srcType,
                        typeVarMap, allowSubclasses, recursionCount + 1);
                }

                typeVarMap.set(destType.getName(), srcType);
            }

            return this._canAssignToTypeVar(destType, srcType);
        }

        if (srcType instanceof TypeVarType) {
            // This should happen only if we have a bug and forgot to specialize
            // the source type or the code being analyzed contains a bug where
            // a return type uses a type var that is not referenced elsewhere
            // in a function.
            return false;
        }

        if (destType.isAny() || srcType.isAny()) {
            return true;
        }

        if (recursionCount > MaxCanAssignTypeRecursion) {
            return true;
        }

        if (srcType instanceof UnionType) {
            // For union sources, all of the types need to be assignable to the dest.
            return srcType.getTypes().find(
                t => !this.canAssignType(destType, t, typeVarMap,
                    allowSubclasses, recursionCount + 1)) === undefined;
        }

        if (destType instanceof UnionType) {
            // For union destinations, we just need to match one of the types.
            return destType.getTypes().find(
                t => this.canAssignType(t, srcType, typeVarMap,
                    allowSubclasses, recursionCount + 1)) !== undefined;
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
                return this._canAssignClass(destClassType, srcType.getClassType(),
                    typeVarMap, allowSubclasses, recursionCount + 1);
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

                    if (destClassName === 'Type') {
                        const destTypeArgs = destClassType.getTypeArguments();
                        if (destTypeArgs && destTypeArgs.length >= 1 && destTypeArgs[0] instanceof Type) {
                            return this.canAssignType(destTypeArgs[0],
                                new ObjectType(srcType), typeVarMap,
                                    allowSubclasses, recursionCount + 1);
                        }
                    }
                }
            }

            if (destType instanceof ClassType) {
                return this._canAssignClass(destType, srcType,
                    typeVarMap, allowSubclasses, recursionCount + 1);
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
                        typeVarMapClone, true, recursionCount + 1);
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
                        typeVarMap, true, recursionCount + 1))) {
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

    // None is always falsy. All other types are generally truthy
    // unless they are objects that support the __nonzero__ or __len__
    // methods.
    static canBeFalsy(type: Type): boolean {
        if (type instanceof NoneType) {
            return true;
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
            if (!this.canAssignType(destParamType, srcParamType, typeVarMap,
                    true, recursionCount + 1)) {
                canAssign = false;
            }
        }

        // Match the return parameter.
        const srcReturnType = srcType.getEffectiveReturnType();
        const destReturnType = destType.getEffectiveReturnType();

        if (!this.canAssignType(destReturnType, srcReturnType, typeVarMap,
                true, recursionCount + 1)) {
            canAssign = false;
        }

        return canAssign;
    }

    private static _canAssignClass(destType: ClassType, srcType: ClassType,
            typeVarMap: TypeVarMap | undefined, allowSubclasses: boolean,
            recursionCount: number): boolean {

        // Is it a structural type (i.e. a protocol)? If so, we need to
        // perform a member-by-member check.
        if (destType.isProtocol()) {
            const destClassFields = destType.getClassFields();

            // Some protocol definitions include recursive references to themselves.
            // We need to protect against infinite recursion, so we'll check for that here.
            if (srcType.isProtocol() && srcType.isSameGenericClass(destType)) {
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
                                typeVarMap, true, recursionCount + 1)) {
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
            return false;
        }

        let inheritanceChain: Type[] = [];
        if (srcType.isDerivedFrom(destType, inheritanceChain)) {
            assert(inheritanceChain.length > 0);

            return this._canAssignClassWithTypeArgs(srcType, inheritanceChain, recursionCount);
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

    // Determines whether the specified type can be assigned to the
    // specified inheritance chain, taking into account its type arguments.
    private static _canAssignClassWithTypeArgs(srcType: ClassType, inheritanceChain: Type[],
            recursionCount: number): boolean {

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
                    curSrcType = this._specializeForBaseClass(curSrcType, ancestorType, recursionCount);
                }

                // If there are no type parameters on this class, we're done.
                const ancestorTypeParams = ancestorType.getTypeParameters();
                if (ancestorTypeParams.length === 0) {
                    continue;
                }

                assert(curSrcType.isSameGenericClass(ancestorType));

                if (ancestorType.isSpecialBuiltIn()) {
                    // TODO - need to add support for special built-in
                    // types that support arbitrary numbers of type parameters
                    // like Tuple. For now, punt and indicate that the type
                    // is assignable.
                    return true;
                }

                const ancestorTypeArgs = ancestorType.getTypeArguments()!;
                // If the dest type isn't specialized, there are no type
                // args to validate.
                if (!ancestorTypeArgs) {
                    return true;
                }

                // Validate that the type arguments match.
                const srcTypeArgs = curSrcType.getTypeArguments();
                if (srcTypeArgs) {
                    assert(srcTypeArgs.length === ancestorTypeArgs.length);

                    for (let srcArgIndex = 0; srcArgIndex < srcTypeArgs.length; srcArgIndex++) {
                        const srcTypeArg = srcTypeArgs[srcArgIndex];
                        const typeParam = ancestorTypeParams[srcArgIndex];
                        const ancestorTypeArg = ancestorTypeArgs[srcArgIndex];

                        if (typeParam.isCovariant()) {
                            if (!this.canAssignType(ancestorTypeArg, srcTypeArg,
                                    undefined, true, recursionCount + 1)) {
                                return false;
                            }
                        } else if (typeParam.isContravariant()) {
                            if (!this.canAssignType(srcTypeArg, ancestorTypeArg,
                                    undefined, true, recursionCount + 1)) {
                                return false;
                            }
                        } else {
                            if (!this.canAssignType(ancestorTypeArg, srcTypeArg,
                                    undefined, false, recursionCount + 1)) {
                                return false;
                            }
                        }
                    }
                } else {
                    // TODO - handle other types like Unions
                    return false;
                }
            }
        }

        return true;
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

    // Validates that the specified source type matches the constraints
    // of the type variable.
    private static _canAssignToTypeVar(destType: TypeVarType, srcType: Type): boolean {
        if (srcType.isAny()) {
            return true;
        }

        // If there's a bound type, make sure it matches.
        const boundType = destType.getBoundType();
        if (boundType) {
            if (srcType.isAny()) {
                return true;
            } else if (srcType instanceof ClassType && boundType instanceof ClassType) {
                return srcType.isDerivedFrom(boundType);
            } else {
                return false;
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
                    typeArgType = UnknownType.create();
                    specializationNeeded = true;
                } else {
                    typeArgType = this.specializeType(oldTypeArgs[index],
                        typeVarMap, recursionLevel + 1);
                    if (typeArgType !== oldTypeArgs[index]) {
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
    // defined by Python. For more details, see this note on method resolution
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

    // Walks the type recursively (in a depth-first manner), finds all
    // type variables that are referenced, and returns an ordered list
    // of unique type variables. For example, if the type is
    // Union[List[Dict[_T1, _T2]], _T1, _T3], the result would be
    // [_T1, _T2, _T3].
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

    // Builds a mapping between type parameters and their specialized
    // types. For example, if the generic type is Dict[_T1, _T2] and the
    // specialized type is Dict[str, int], it returns a map that associates
    // _T1 with str and _T2 with int.
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
