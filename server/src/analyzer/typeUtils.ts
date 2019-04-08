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
import { ParameterCategory } from '../parser/parseNodes';
import { Symbol } from './symbol';
import { AnyType, ClassType, FunctionType,
    NeverType, NoneType, ObjectType, OverloadedFunctionType, SpecializedFunctionTypes,
    TupleType, Type, TypeCategory, TypeVarMap, TypeVarType, UnionType, UnknownType } from './types';

const MaxCanAssignTypeRecursion = 20;

export interface ClassMember {
    symbol?: Symbol;
    isInstanceMember: boolean;
    class?: ClassType;
}

export class TypeUtils {
    // Calls a callback for each subtype and combines the results into
    // a final type.
    static doForSubtypes(type: Type, callback: (type: Type) => (Type | undefined)): Type {
        let newTypes: Type[] = [];

        if (type instanceof UnionType) {
            type.getTypes().forEach(typeEntry => {
                const transformedType = callback(typeEntry);
                if (transformedType) {
                    newTypes.push(transformedType);
                }
            });
        } else {
            const transformedType = callback(type);
            if (transformedType) {
                newTypes.push(transformedType);
            }
        }

        return this.combineTypes(newTypes);
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

        let resultingType = types[0];
        types.forEach((t, index) => {
            if (index > 0) {
                resultingType = this._combineTwoTypes(resultingType, t);
            }
        });

        return resultingType;
    }

    // Determines if the source type can be assigned to the dest type.
    // If typeVarMap is provided, type variables within the destType are
    // matched against existing type variables in the map. If a type variable
    // in the dest type is not in the type map already, it is assigned a type
    // and added to the map.
    static canAssignType(destType: Type, srcType: Type, diag: DiagnosticAddendum,
            typeVarMap?: TypeVarMap, allowSubclasses = true, recursionCount = 0): boolean {

        // Before performing any other checks, see if the dest type is a
        // TypeVar that we are attempting to match.
        if (destType instanceof TypeVarType) {
            if (typeVarMap) {
                const existingTypeVarMapping = typeVarMap.get(destType.getName());
                if (existingTypeVarMapping) {
                    return this.canAssignType(existingTypeVarMapping, srcType, diag.createAddendum(),
                        typeVarMap, allowSubclasses, recursionCount + 1);
                }

                typeVarMap.set(destType.getName(), srcType);
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
            diag.addMessage(`Type '${ srcType.asString() }' cannot be assigned to ` +
                `type '${ destType.asString() }'.`);
            return false;
        }

        if (recursionCount > MaxCanAssignTypeRecursion) {
            return true;
        }

        if (srcType instanceof UnionType) {
            // For union sources, all of the types need to be assignable to the dest.
            const incompatibleType = srcType.getTypes().find(
                t => !this.canAssignType(destType, t, diag.createAddendum(), typeVarMap,
                    allowSubclasses, recursionCount + 1));

            if (incompatibleType) {
                diag.addMessage(`Type '${ incompatibleType.asString() }' cannot be assigned to ` +
                    `type '${ destType.asString() }'.`);
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

        if (destType instanceof ObjectType) {
            const destClassType = destType.getClassType();

            // Construct a generic tuple object using the built-in tuple
            // class so we can perform a comparison.
            if (srcType instanceof TupleType) {
                srcType = new ObjectType(srcType.getBaseClass());
            }

            if (srcType instanceof ObjectType) {
                return this._canAssignClass(destClassType, srcType.getClassType(),
                    diag.createAddendum(), typeVarMap, allowSubclasses, recursionCount + 1);
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
                                new ObjectType(srcType), diag.createAddendum(), typeVarMap,
                                    allowSubclasses, recursionCount + 1);
                        }
                    }
                }
            }

            if (destType instanceof ClassType) {
                return this._canAssignClass(destType, srcType, diag.createAddendum(),
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
                    let srcClassTypeVarMap = this.buildTypeVarMapFromSpecializedClass(srcType.getClassType());
                    let callType = TypeUtils.getEffectiveTypeOfMember(callMember);
                    callType = this.specializeType(callType, srcClassTypeVarMap);
                    if (callType instanceof FunctionType) {
                        srcFunction = TypeUtils.stripFirstParameter(callType);
                    }
                }
            } else if (srcType instanceof ClassType) {
                // TODO - need to create function corresponding to constructor for class.
                diag.addMessage(`Constructor is not compatible with type '${ destType.asString() }'.`);
                return false;
            }

            if (srcFunction) {
                return this._canAssignFunction(destType, srcFunction, diag.createAddendum(),
                    typeVarMap, recursionCount + 1);
            }
        }

        if (destType instanceof TupleType && srcType instanceof TupleType) {
            const destEntries = destType.getEntryTypes();
            const srcEntries = srcType.getEntryTypes();

            if (srcEntries.length < destEntries.length  ||
                    (srcEntries.length > destEntries.length && !destType.getAllowMoreEntries())) {

                diag.addMessage(`Tuple entry count mismatch. Expected ${ destEntries.length } ` +
                    `but got ${ srcEntries.length }.`);
                return false;
            }

            const mismatchEntryIndex = srcEntries.findIndex((srcEntry, index) => {
                // If there aren't enough dest entries, it's presumably because
                // "allowMoreEntries" is true -- i.e. it's a "Tuple[Any, ...]".
                if (index >= destEntries.length) {
                    return false;
                }

                return !this.canAssignType(destEntries[index], srcEntry, diag.createAddendum(),
                        typeVarMap, true, recursionCount + 1);
            });

            if (mismatchEntryIndex >= 0) {
                diag.addMessage(`Entry ${ mismatchEntryIndex + 1 }: ` +
                    `Type '${ srcEntries[mismatchEntryIndex].asString() }' ` +
                    `cannot be assigned to type '${ destEntries[mismatchEntryIndex].asString() }'.`);
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
    static canAssignToTypeVar(destType: TypeVarType, srcType: Type, diag: DiagnosticAddendum): boolean {
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
            if (!TypeUtils.canAssignType(boundType, effectiveSrcType, diag.createAddendum())) {
                diag.addMessage(`Type '${ effectiveSrcType.asString() }' is not compatible with ` +
                    `bound type '${ boundType.asString() }' for TypeVar '${ destType.getName() }'`);
                return false;
            }
        }

        // If there are no constraints, we're done.
        let constraints = destType.getConstraints();
        if (constraints.length === 0) {
            return true;
        }

        // Try to find a match among the constraints.
        for (const constraint of constraints) {
            if (constraint.isAny()) {
                return true;
            } else if (effectiveSrcType instanceof UnionType) {
                if (effectiveSrcType.getTypes().find(t => constraint.isSame(t))) {
                    return true;
                }
            } else if (constraint.isSame(effectiveSrcType)) {
                return true;
            }
        }

        diag.addMessage(`Type '${ effectiveSrcType.asString() }' is not compatible with ` +
            `constraints imposed by TypeVar '${ destType.getName() }'`);

        return false;
    }

    private static _canAssignFunction(destType: FunctionType, srcType: FunctionType,
            diag: DiagnosticAddendum, typeVarMap: TypeVarMap | undefined,
            recursionCount: number): boolean {

        let canAssign = true;

        const srcParamCount = srcType.getParameterCount();
        const destParamCount = destType.getParameterCount();
        const minParamCount = Math.min(srcParamCount, destParamCount);

        // Match as many input parameters as we can.
        for (let paramIndex = 0; paramIndex < minParamCount; paramIndex++) {
            const srcParam = srcType.getParameters()[paramIndex];
            const destParam = destType.getParameters()[paramIndex];

            // If the dest or source involve var-args, no need to continue matching.
            if (srcParam.category !== ParameterCategory.Simple ||
                    destParam.category !== ParameterCategory.Simple) {
                break;
            }

            const srcParamType = srcType.getEffectiveParameterType(paramIndex);
            const destParamType = destType.getEffectiveParameterType(paramIndex);

            // Call canAssignType once to perform any typeVarMap population.
            this.canAssignType(destParamType, srcParamType, diag.createAddendum(), typeVarMap,
                    true, recursionCount + 1);

            // Make sure we can assign the specialized dest type to the
            // source type.
            const specializedDestParamType = this.specializeType(
                destParamType, typeVarMap, recursionCount + 1);
            if (!this.canAssignType(srcParamType, specializedDestParamType, diag.createAddendum(),
                    undefined, true, recursionCount + 1)) {
                diag.addMessage(`Parameter ${ paramIndex + 1 } of type ` +
                    `'${ specializedDestParamType }' cannot be assigned to type` +
                    `'${ srcParamType }'.`);
                canAssign = false;
            }
        }

        const srcHasVarArgs = srcType.getParameters().find(
            param => param.category !== ParameterCategory.Simple) !== undefined;
        const destHasVarArgs = destType.getParameters().find(
            param => param.category !== ParameterCategory.Simple) !== undefined;

        // We we didn't find a var-arg parameter, the number of dest params
        // must be enough to provide all of the non-default source params
        // with values. Plus, the number of source params must be enough to
        // accept all of the dest argments.
        if (!srcHasVarArgs && !destHasVarArgs) {
            let nonDefaultSrcParamCount = srcType.getParameters().filter(
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
            allowSubclasses: boolean, recursionCount: number): boolean {

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
                    diag.addMessage(`'${ name }' is not present`);
                    missingNames.push(name);
                } else {
                    if (symbol.declarations && symbol.declarations[0].declaredType) {
                        let destMemberType = symbol.declarations[0].declaredType;
                        destMemberType = this.specializeType(destMemberType, destClassTypeVarMap);
                        let srcMemberType = TypeUtils.getEffectiveTypeOfMember(classMemberInfo);
                        srcMemberType = this.specializeType(srcMemberType, srcClassTypeVarMap);

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
            return false;
        }

        let inheritanceChain: Type[] = [];
        if (srcType.isDerivedFrom(destType, inheritanceChain)) {
            assert(inheritanceChain.length > 0);

            return this._canAssignClassWithTypeArgs(srcType, inheritanceChain,
                diag.createAddendum(), recursionCount + 1);
        }

        // Special-case int-to-float conversion.
        if (srcType.isBuiltIn() && srcType.getClassName() === 'int' &&
                destType.isBuiltIn() && destType.getClassName() === 'float') {
            return true;
        }

        return false;
    }

    // Determines whether the specified type can be assigned to the
    // specified inheritance chain, taking into account its type arguments.
    private static _canAssignClassWithTypeArgs(srcType: ClassType, inheritanceChain: Type[],
            diag: DiagnosticAddendum, recursionCount: number): boolean {

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
                    assert(srcType.isSpecialBuiltIn() || srcTypeArgs.length === ancestorTypeArgs.length);

                    for (let srcArgIndex = 0; srcArgIndex < srcTypeArgs.length; srcArgIndex++) {
                        const srcTypeArg = srcTypeArgs[srcArgIndex];
                        const typeParam = ancestorTypeParams[srcArgIndex];
                        const ancestorTypeArg = ancestorTypeArgs[srcArgIndex];

                        if (typeParam.isCovariant()) {
                            if (!this.canAssignType(ancestorTypeArg, srcTypeArg,
                                    diag.createAddendum(), undefined, true, recursionCount + 1)) {
                                return false;
                            }
                        } else if (typeParam.isContravariant()) {
                            if (!this.canAssignType(srcTypeArg, ancestorTypeArg,
                                    diag.createAddendum(), undefined, true, recursionCount + 1)) {
                                return false;
                            }
                        } else {
                            if (!this.canAssignType(ancestorTypeArg, srcTypeArg,
                                    diag.createAddendum(), undefined, false, recursionCount + 1)) {
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

            return TypeUtils.combineTypes(subtypes);
        }

        if (type instanceof ObjectType) {
            const classType = this._specializeClassType(type.getClassType(),
                typeVarMap, recursionLevel + 1);

            // Handle the "Type" special class.
            if (classType.isBuiltIn() && classType.getClassName() === 'Type') {
                const typeArgs = classType.getTypeArguments();
                if (typeArgs && typeArgs.length >= 1) {
                    return typeArgs[0];
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

        if (type instanceof TupleType) {
            const entryTypes = type.getEntryTypes().map(
                typeEntry => this.specializeType(typeEntry, typeVarMap, recursionLevel + 1));

            return type.cloneForSpecialization(entryTypes);
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
            } else if (typeVarMap && typeVarMap.get(typeParam.getName())) {
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

        return TypeUtils.combineTypes(concreteTypes);
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

        return TypeUtils.combineTypes(subtypes);
    }

    static cloneTypeVarMap(typeVarMap: TypeVarMap): TypeVarMap {
        let newTypeVarMap = new TypeVarMap();
        newTypeVarMap.getKeys().forEach(key => {
            newTypeVarMap.set(key, typeVarMap.get(key)!);
        });
        return newTypeVarMap;
    }

    static derivesFromClassRecursive(classType: ClassType, baseClassToFind: ClassType) {
        if (classType.isSameGenericClass(baseClassToFind)) {
            return true;
        }

        for (let baseClass of classType.getBaseClasses()) {
            if (baseClass instanceof ClassType) {
                if (this.derivesFromClassRecursive(baseClass, baseClassToFind)) {
                    return true;
                }
            }
        }

        return false;
    }

    // Filters a type such that that it is guaranteed not to
    // be falsy. For example, if a type is a union of None
    // and an "int", this method would strip off the "None"
    // and return only the "int".
    static removeFalsinessFromType(type: Type): Type {
        return this.doForSubtypes(type, subtype => {
            if (subtype instanceof ObjectType) {
                const truthyOrFalsy = subtype.getTruthyOrFalsy();
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
                        return subtype.cloneAsTruthy();
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
                const truthyOrFalsy = subtype.getTruthyOrFalsy();
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
                        return subtype.cloneAsFalsy();
                    }
                }
            } else if (this.canBeFalsy(subtype)) {
                return subtype;
            }

            return undefined;
        });
    }

    private static _combineTwoTypes(type1: Type, type2: Type): Type {
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

    static isDataClass(type: ClassType): boolean {
        return (type.getBaseClasses().length === 1 && type.getBaseClasses()[0].type.asString() === 'Type[NamedTuple]');
    }

    static isFunctionType(type: Type): boolean {
        return (type.category === TypeCategory.Function || type.category === TypeCategory.OverloadedFunction);
    }

}
