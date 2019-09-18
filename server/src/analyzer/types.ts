/*
* types.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Representation of types used during type analysis within Python.
*/

import * as assert from 'assert';

import StringMap from '../common/stringMap';
import { ParameterCategory } from '../parser/parseNodes';
import { InferredType, TypeSourceId } from './inferredType';
import { SymbolTable } from './symbol';

export const enum TypeCategory {
    // Name is not bound to a value of any type.
    Unbound,

    // Type exists but is not currently known by the
    // type analyzer (e.g. there is no available typings file).
    // Unknown types are treated the same as "Any" at analysis time.
    Unknown,

    // Type can be anything.
    Any,

    // Special "None" type defined in Python.
    None,

    // Used in type constraints to indicate that all possible
    // union types have been filtered, and execution should never
    // get to this point.
    Never,

    // Callable type with typed input parameters and return parameter.
    Function,

    // Functions defined with @overload decorator in stub files that
    // have multiple function declarations for a common implementation.
    OverloadedFunction,

    // Value that has associated getter/setter/deleter function.
    Property,

    // Class definition, including associated instance methods,
    // class methods, static methods, properties, and variables.
    Class,

    // Class instance.
    Object,

    // Module instance.
    Module,

    // Composite type (e.g. Number OR String OR None).
    Union,

    // Type variable (defined with TypeVar)
    TypeVar
}

export type Type = UnboundType | UnknownType | AnyType | NoneType | NeverType |
    FunctionType | OverloadedFunctionType | PropertyType | ClassType |
    ObjectType | ModuleType | UnionType | TypeVarType;

export type LiteralValue = number | boolean | string;

const _maxRecursionCount = 16;

export type InheritanceChain = (ClassType | UnknownType)[];

export class TypeVarMap extends StringMap<Type> {}

interface TypeBase {
    category: TypeCategory;
}

export interface UnboundType extends TypeBase {
    category: TypeCategory.Unbound;
}

export namespace UnboundType {
    const _instance: UnboundType = {
        category: TypeCategory.Unbound
    };

    export function create() {
        // All Unbound objects are the same, so use a shared instance.
        return _instance;
    }
}

export interface UnknownType extends TypeBase {
    category: TypeCategory.Unknown;
}

export namespace UnknownType {
    const _instance: UnknownType = {
        category: TypeCategory.Unknown
    };

    export function create() {
        // All Unknown objects are the same, so use a shared instance.
        return _instance;
    }
}

export interface ModuleType extends TypeBase {
    category: TypeCategory.Module;
    fields: SymbolTable;
    docString?: string;

    // A partial module is one that is not fully initialized
    // but contains only the symbols that have been imported
    // in a multi-part import (e.g. import a.b.c).
    isPartialModule: boolean;
}

export namespace ModuleType {
    export function create(fields: SymbolTable, docString?: string) {
        const newModuleType: ModuleType = {
            category: TypeCategory.Module,
            fields,
            docString,
            isPartialModule: false
        };
        return newModuleType;
    }
}

export const enum ClassTypeFlags {
    None = 0x00,

    // Class is defined in the "builtins" or "typings" file.
    BuiltInClass = 0x01,

    // Class requires special-case handling because it
    // exhibits non-standard behavior or is not defined
    // formally as a class. Examples include 'Optional'
    // and 'Union'.
    SpecialBuiltIn = 0x02,

    // Introduced in Python 3.7 - class either derives directly
    // from NamedTuple or has a @dataclass class decorator.
    DataClass = 0x04,

    // Flags that control whether methods should be
    // synthesized for a dataclass class.
    SkipSynthesizedInit = 0x08

}

export interface BaseClass {
    isMetaclass: boolean;
    type: Type;
}

interface ClassDetails {
    name: string;
    flags: ClassTypeFlags;
    typeSourceId: TypeSourceId;
    baseClasses: BaseClass[];
    aliasClass?: ClassType;
    fields: SymbolTable;
    typeParameters: TypeVarType[];
    isAbstractClass: boolean;
    docString?: string;
    dataClassParameters?: FunctionParameter[];
}

export interface ClassType extends TypeBase {
    category: TypeCategory.Class;

    details: ClassDetails;

    // A generic class that has been completely or partially
    // specialized will have type arguments that correspond to
    // some or all of the type parameters. Unspecified type
    // parameters are undefined.
    typeArguments?: Type[];

    skipAbstractClassTest: boolean;
}

export namespace ClassType {
    export function create(name: string, flags: ClassTypeFlags,
            typeSourceId: TypeSourceId, docString?: string) {

        const newClass: ClassType = {
            category: TypeCategory.Class,
            details: {
                name,
                flags,
                typeSourceId,
                baseClasses: [],
                fields: new SymbolTable(),
                typeParameters: [],
                isAbstractClass: false,
                docString
            },
            skipAbstractClassTest: false
        };

        return newClass;
    }

    export function cloneForSpecialization(classType: ClassType,
            typeArguments: Type[], skipAbstractClassTest = false): ClassType {

        const newClassType = create(classType.details.name,
            classType.details.flags, classType.details.typeSourceId);
        newClassType.details = classType.details;
        newClassType.typeArguments = typeArguments;
        if (skipAbstractClassTest) {
            newClassType.skipAbstractClassTest = true;
        }
        return newClassType;
    }

    // Specifies whether the class type is generic (unspecialized)
    // or specialized.
    export function isGeneric(classType: ClassType) {
        return classType.details.typeParameters.length > 0 &&
            classType.typeArguments === undefined;
    }

    export function isSpecialBuiltIn(classType: ClassType, className?: string) {
        if (!(classType.details.flags & ClassTypeFlags.SpecialBuiltIn)) {
            return false;
        }

        if (className !== undefined) {
            return getClassName(classType) === className;
        }

        return true;
    }

    export function isBuiltIn(classType: ClassType, className?: string) {
        if (!(classType.details.flags & ClassTypeFlags.BuiltInClass)) {
            return false;
        }

        if (className !== undefined) {
            return getClassName(classType) === className;
        }

        return true;
    }

    export function isProtocol(classType: ClassType) {
        // Does the class directly 'derive' from "Protocol"?
        return classType.details.baseClasses.find(bc => {
            if (bc.type.category === TypeCategory.Class) {
                if (isBuiltIn(bc.type, 'Protocol')) {
                    return true;
                }
            }
            return false;
        }) !== undefined;
    }

    export function setIsAbstractClass(classType: ClassType) {
        classType.details.isAbstractClass = true;
    }

    export function isAbstractClass(classType: ClassType) {
        return classType.details.isAbstractClass &&
            !classType.skipAbstractClassTest;
    }

    export function getClassName(classType: ClassType) {
        return classType.details.name;
    }

    export function setIsDataClass(classType: ClassType, skipInit: boolean) {
        classType.details.flags |= ClassTypeFlags.DataClass;
        if (skipInit) {
            classType.details.flags |= ClassTypeFlags.SkipSynthesizedInit;
        }
    }

    export function isDataClass(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.DataClass);
    }

    export function isSkipSynthesizedInit(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.SkipSynthesizedInit);
    }

    export function getBaseClasses(classType: ClassType): BaseClass[] {
        return classType.details.baseClasses;
    }

    export function setAliasClass(classType: ClassType, aliasType: ClassType) {
        classType.details.aliasClass = aliasType;
    }

    export function getAliasClass(classType: ClassType) {
        return classType.details.aliasClass;
    }

    export function getDocString(classType: ClassType) {
        return classType.details.docString;
    }

    export function getTypeSourceId(classType: ClassType) {
        return classType.details.typeSourceId;
    }

    export function addBaseClass(classType: ClassType, baseClassType: Type, isMetaclass: boolean) {
        classType.details.baseClasses.push({ isMetaclass, type: baseClassType });
    }

    export function updateBaseClassType(classType: ClassType, index: number, type: Type) {
        const didChange = !isTypeSame(type, classType.details.baseClasses[index].type);
        classType.details.baseClasses[index].type = type;
        return didChange;
    }

    export function updateDataClassParameters(classType: ClassType, params: FunctionParameter[]) {
        let didChange = false;
        const oldParams = classType.details.dataClassParameters;
        if (!oldParams) {
            didChange = true;
        } else if (oldParams.length !== params.length) {
            didChange = true;
        } else {
            didChange = params.some((param, index) => {
                return param.name !== params[index].name ||
                    !isTypeSame(param.type, params[index].type);
            });
        }

        classType.details.dataClassParameters = params;
        return didChange;
    }

    export function getDataClassParameters(classType: ClassType): FunctionParameter[] {
        return classType.details.dataClassParameters || [];
    }

    export function getFields(classType: ClassType): SymbolTable {
        return classType.details.fields;
    }

    export function setFields(classType: ClassType, fields: SymbolTable) {
        classType.details.fields = fields;
    }

    export function setTypeArguments(classType: ClassType, typeArgs: Type[]) {
        // Special built-in types can have a variable number of type parameters, so
        // ignore those. For all others, verify that we have enough type arguments
        // to match all of the type parameters. It's possible in early phases of
        // analysis for there to be more type args than parameters because the parameters
        // have not yet been filled in for forward-declared classes.
        if (!isSpecialBuiltIn(classType)) {
            if (typeArgs.length < getTypeParameters(classType).length) {
                while (typeArgs.length < getTypeParameters(classType).length) {
                    // Fill in any remaining type parameters with Any.
                    typeArgs.push(AnyType.create());
                }
            }
        }

        classType.typeArguments = typeArgs;
    }

    export function getTypeArguments(classType: ClassType) {
        return classType.typeArguments;
    }

    export function getTypeParameters(classType: ClassType) {
        // If this is a special class, use the alias class' type
        // parameters instead.
        if (classType.details.aliasClass) {
            return classType.details.aliasClass.details.typeParameters;
        }
        return classType.details.typeParameters;
    }

    export function setTypeParameters(classType: ClassType, params: TypeVarType[]): boolean {
        let didParametersChange = false;

        if (classType.details.typeParameters.length !== params.length) {
            didParametersChange = true;
        } else {
            for (let i = 0; i < params.length; i++) {
                if (!isTypeSame(params[i], classType.details.typeParameters[i])) {
                    didParametersChange = true;
                }
            }
        }

        classType.details.typeParameters = params;

        return didParametersChange;
    }

    // Same as isSame except that it doesn't compare type arguments.
    export function isSameGenericClass(classType: ClassType, type2: ClassType) {
        // If the class details match, it's definitely the same class.
        if (classType.details === type2.details) {
            return true;
        }

        // Special built-in classes generate new class details for
        // each instance, so we need to rely on a name comparison.
        if (isSpecialBuiltIn(classType) && isSpecialBuiltIn(type2) &&
                getClassName(classType) === getClassName(type2)) {
            return true;
        }

        if (isAliasOf(classType, type2) || isAliasOf(type2, classType)) {
            return true;
        }

        return false;
    }

    export function isAliasOf(classType: ClassType, type2: ClassType): boolean {
        return type2.details.aliasClass !== undefined &&
            type2.details.aliasClass.details === classType.details;
    }

    // Determines whether this is a subclass (derived class)
    // of the specified class. If the caller passes an empty
    // array to inheritanceChain, it will be filled in by
    // the call to include the chain of inherited classes starting
    // with type2 and ending with this type.
    export function isDerivedFrom(classType: ClassType,
            type2: ClassType, inheritanceChain?: InheritanceChain): boolean {

        // Is it the exact same class?
        if (isSameGenericClass(classType, type2)) {
            if (inheritanceChain) {
                inheritanceChain.push(type2);
            }
            return true;
        }

        // Handle built-in types like 'dict' and 'list', which are all
        // subclasses of object even though they are not explicitly declared
        // that way.
        if (isBuiltIn(classType) && isBuiltIn(type2, 'object')) {
            if (inheritanceChain) {
                inheritanceChain.push(type2);
            }
            return true;
        }

        for (const baseClass of getBaseClasses(classType)) {
            if (baseClass.type.category === TypeCategory.Class) {
                if (isDerivedFrom(baseClass.type, type2, inheritanceChain)) {
                    if (inheritanceChain) {
                        inheritanceChain.push(classType);
                    }
                    return true;
                }
            } else if (isAnyOrUnknown(baseClass.type)) {
                if (inheritanceChain) {
                    inheritanceChain.push(classType);
                }
                return true;
            }
        }

        return false;
    }
}

export interface ObjectType extends TypeBase {
    category: TypeCategory.Object;

    classType: ClassType;

    // Some types can be further constrained to have
    // literal types (e.g. true or 'string' or 3).
    literalValue?: LiteralValue;
}

export namespace ObjectType {
    export function create(classType: ClassType) {
        const newObjectType: ObjectType = {
            category: TypeCategory.Object,
            classType
        };
        return newObjectType;
    }

    export function cloneWithLiteral(objType: ObjectType, value: LiteralValue): ObjectType {
        const newType = create(objType.classType);
        newType.literalValue = value;
        return newType;
    }
}

export interface FunctionParameter {
    category: ParameterCategory;
    name?: string;
    hasDefault?: boolean;
    type: Type;
}

export const enum FunctionTypeFlags {
    None = 0,
    InstanceMethod = 1,
    ConstructorMethod = 2,
    ClassMethod = 4,
    StaticMethod = 8,
    AbstractMethod = 16,
    DisableDefaultChecks = 32,
    SynthesizedMethod = 64
}

interface FunctionDetails {
    flags: FunctionTypeFlags;
    parameters: FunctionParameter[];
    declaredReturnType?: Type;
    inferredReturnType: InferredType;
    inferredYieldType: InferredType;
    builtInName?: string;
    docString?: string;
}

export interface SpecializedFunctionTypes {
    parameterTypes: Type[];
    returnType: Type;
}

export interface FunctionType extends TypeBase {
    category: TypeCategory.Function;

    details: FunctionDetails;

    // A function type can be specialized (i.e. generic type
    // variables replaced by a concrete type).
    specializedTypes?: SpecializedFunctionTypes;
}

export namespace FunctionType {
    export function create(flags: FunctionTypeFlags, docString?: string) {
        const newFunctionType: FunctionType = {
            category: TypeCategory.Function,
            details: {
                flags,
                parameters: [],
                inferredReturnType: new InferredType(),
                inferredYieldType: new InferredType(),
                docString
            }
        };
        return newFunctionType;
    }

    // Creates a deep copy of the function type, including a fresh
    // version of _functionDetails.
    export function clone(type: FunctionType, deleteFirstParam = false): FunctionType {
        const newFunction = create(type.details.flags, type.details.docString);
        const startParam = deleteFirstParam ? 1 : 0;

        newFunction.details = {
            flags: type.details.flags,
            parameters: type.details.parameters.slice(startParam),
            declaredReturnType: type.details.declaredReturnType,
            inferredReturnType: type.details.inferredReturnType,
            inferredYieldType: type.details.inferredYieldType,
            builtInName: type.details.builtInName,
            docString: type.details.docString
        };

        // If we strip off the first parameter, this is no longer an
        // instance method or class method.
        if (deleteFirstParam) {
            newFunction.details.flags &= ~(FunctionTypeFlags.InstanceMethod |
                FunctionTypeFlags.ClassMethod);
        }

        if (type.specializedTypes) {
            newFunction.specializedTypes = {
                parameterTypes: type.specializedTypes.parameterTypes.slice(startParam),
                returnType: type.specializedTypes.returnType
            };
        }

        return newFunction;
    }

    // Creates a shallow copy of the function type with new
    // specialized types. The clone shares the _functionDetails
    // with the object being cloned.
    export function cloneForSpecialization(type: FunctionType,
            specializedTypes: SpecializedFunctionTypes): FunctionType {

        const newFunction = create(type.details.flags, type.details.docString);
        newFunction.details = type.details;

        assert(specializedTypes.parameterTypes.length === type.details.parameters.length);
        newFunction.specializedTypes = specializedTypes;

        return newFunction;
    }

    export function isInstanceMethod(type: FunctionType): boolean {
        return (type.details.flags & FunctionTypeFlags.InstanceMethod) !== 0;
    }

    export function setIsInstanceMethod(type: FunctionType) {
        type.details.flags |= FunctionTypeFlags.InstanceMethod;
    }

    export function isConstructorMethod(type: FunctionType): boolean {
        return (type.details.flags & FunctionTypeFlags.ConstructorMethod) !== 0;
    }

    export function isStaticMethod(type: FunctionType): boolean {
        return (type.details.flags & FunctionTypeFlags.StaticMethod) !== 0;
    }

    export function setIsStaticMethod(type: FunctionType) {
        type.details.flags |= FunctionTypeFlags.StaticMethod;
    }

    export function isClassMethod(type: FunctionType): boolean {
        return (type.details.flags & FunctionTypeFlags.ClassMethod) !== 0;
    }

    export function setIsClassMethod(type: FunctionType) {
        type.details.flags |= FunctionTypeFlags.ClassMethod;
    }

    export function isAbstractMethod(type: FunctionType): boolean {
        return (type.details.flags & FunctionTypeFlags.AbstractMethod) !== 0;
    }

    export function setIsAbstractMethod(type: FunctionType) {
        type.details.flags |= FunctionTypeFlags.AbstractMethod;
    }

    export function isSynthesizedMethod(type: FunctionType): boolean {
        return (type.details.flags & FunctionTypeFlags.SynthesizedMethod) !== 0;
    }

    export function getBuiltInName(type: FunctionType) {
        return type.details.builtInName;
    }

    export function setBuiltInName(type: FunctionType, name: string) {
        type.details.builtInName = name;
    }

    export function getDocString(type: FunctionType) {
        return type.details.docString;
    }

    export function getParameters(type: FunctionType) {
        return type.details.parameters;
    }

    export function getParameterCount(type: FunctionType) {
        return type.details.parameters.length;
    }

    export function isDefaultParameterCheckDisabled(type: FunctionType) {
        return (type.details.flags & FunctionTypeFlags.DisableDefaultChecks) !== 0;
    }

    export function setDefaultParameterCheckDisabled(type: FunctionType) {
        type.details.flags |= FunctionTypeFlags.DisableDefaultChecks;
    }

    export function setParameterType(type: FunctionType, index: number, paramType: Type): boolean {
        assert(index < type.details.parameters.length);
        const typeChanged = !isTypeSame(paramType, type.details.parameters[index].type);
        type.details.parameters[index].type = paramType;
        return typeChanged;
    }

    export function getEffectiveParameterType(type: FunctionType, index: number): Type {
        assert(index < type.details.parameters.length);
        if (type.specializedTypes) {
            return type.specializedTypes.parameterTypes[index];
        }

        return type.details.parameters[index].type;
    }

    export function addParameter(type: FunctionType, param: FunctionParameter) {
        type.details.parameters.push(param);
    }

    export function getDeclaredReturnType(type: FunctionType) {
        return type.details.declaredReturnType;
    }

    export function getSpecializedReturnType(type: FunctionType) {
        return type.specializedTypes ? type.specializedTypes.returnType :
            type.details.declaredReturnType;
    }

    export function setDeclaredReturnType(type: FunctionType, returnType?: Type): boolean {
        const typeChanged = !type.details.declaredReturnType || !returnType ||
            !isTypeSame(type.details.declaredReturnType, returnType);
        type.details.declaredReturnType = returnType;

        return typeChanged;
    }

    export function getInferredReturnType(type: FunctionType) {
        return type.details.inferredReturnType;
    }

    export function getInferredYieldType(type: FunctionType) {
        return type.details.inferredYieldType;
    }

    export function getEffectiveReturnType(type: FunctionType) {
        const specializedReturnType = getSpecializedReturnType(type);
        if (specializedReturnType) {
            return specializedReturnType;
        }

        if (isGenerator(type)) {
            // Wrap this in an Iterator type.
            return type.details.inferredYieldType.getType();
        }

        return type.details.inferredReturnType.getType();
    }

    export function isGenerator(type: FunctionType) {
        return type.details.inferredYieldType.getSourceCount() > 0;
    }
}

export interface OverloadedFunctionEntry {
    type: FunctionType;
    typeSourceId: TypeSourceId;
}

export interface OverloadedFunctionType extends TypeBase {
    category: TypeCategory.OverloadedFunction;
    overloads: OverloadedFunctionEntry[];
}

export namespace OverloadedFunctionType {
    export function create() {
        const newType: OverloadedFunctionType = {
            category: TypeCategory.OverloadedFunction,
            overloads: []
        };
        return newType;
    }

    export function addOverload(type: OverloadedFunctionType, typeSourceId: TypeSourceId,
            functionType: FunctionType) {

        // Was this entry already added? If so, replace the type.
        const index = type.overloads.findIndex(entry => entry.typeSourceId === typeSourceId);
        if (index >= 0) {
            type.overloads[index].type = functionType;
        } else {
            type.overloads.push({ typeSourceId, type: functionType });
        }
    }
}

export interface PropertyType extends TypeBase {
    category: TypeCategory.Property;

    getter: FunctionType;
    setter?: FunctionType;
    deleter?: FunctionType;
}

export namespace PropertyType {
    export function create(getter: FunctionType) {
        const newPropertyType: PropertyType = {
            category: TypeCategory.Property,
            getter
        };
        return newPropertyType;
    }
}

export interface NoneType extends TypeBase {
    category: TypeCategory.None;
}

export namespace NoneType {
    const _noneInstance: NoneType = {
        category: TypeCategory.None
    };

    export function create() {
        return _noneInstance;
    }
}

export interface NeverType extends TypeBase {
    category: TypeCategory.Never;
}

export namespace NeverType {
    const _neverInstance: NeverType = {
        category: TypeCategory.Never
    };

    export function create() {
        return _neverInstance;
    }
}

export interface AnyType extends TypeBase {
    category: TypeCategory.Any;
    isEllipsis: boolean;
}

export namespace AnyType {
    const _anyInstance: AnyType = {
        category: TypeCategory.Any,
        isEllipsis: false
    };
    const _ellipsisInstance: AnyType = {
        category: TypeCategory.Any,
        isEllipsis: true
    };

    export function create(isEllipsis = false) {
        return isEllipsis ? _ellipsisInstance : _anyInstance;
    }
}

export interface UnionType extends TypeBase {
    category: TypeCategory.Union;
    subtypes: Type[];
}

export namespace UnionType {
    export function create() {
        const newUnionType: UnionType = {
            category: TypeCategory.Union,
            subtypes: []
        };

        return newUnionType;
    }

    export function addTypes(unionType: UnionType, subtypes: Type[]) {
        for (const newType of subtypes) {
            assert(newType.category !== TypeCategory.Union);
            assert(newType.category !== TypeCategory.Never);
            unionType.subtypes.push(newType);
        }
    }

    export function containsType(unionType: UnionType, subtype: Type, recursionCount = 0): boolean {
        return unionType.subtypes.find(t => isTypeSame(t, subtype, recursionCount + 1)) !== undefined;
    }
}

export interface TypeVarType extends TypeBase {
    category: TypeCategory.TypeVar;

    name: string;
    constraints: Type[];
    boundType?: Type;
    isCovariant: boolean;
    isContravariant: boolean;
}

export namespace TypeVarType {
    export function create(name: string) {
        const newTypeVarType: TypeVarType = {
            category: TypeCategory.TypeVar,
            name,
            constraints: [],
            isCovariant: false,
            isContravariant: false
        };
        return newTypeVarType;
    }

    export function addConstraint(typeVarType: TypeVarType, constraintType: Type) {
        typeVarType.constraints.push(constraintType);
    }
}

export function isNoneOrNever(type: Type): boolean {
    return type.category === TypeCategory.None ||
        type.category === TypeCategory.Never;
}

export function isAnyOrUnknown(type: Type): boolean {
    if (type.category === TypeCategory.Any ||
            type.category === TypeCategory.Unknown) {
        return true;
    }

    if (type.category === TypeCategory.Union) {
        return type.subtypes.find(t => !isAnyOrUnknown(t)) === undefined;
    }

    return false;
}

export function isUnbound(type: Type): boolean {
    return type.category === TypeCategory.Unbound;
}

export function isPossiblyUnbound(type: Type): boolean {
    if (type.category === TypeCategory.Unbound) {
        return true;
    }

    if (type.category === TypeCategory.Union) {
        return type.subtypes.find(t => isPossiblyUnbound(t)) !== undefined;
    }

    return false;
}

export function requiresSpecialization(type: Type, recursionCount = 0): boolean {
    switch (type.category) {
        case TypeCategory.Class: {
            const typeArgs = ClassType.getTypeArguments(type);
            if (typeArgs) {
                if (recursionCount > _maxRecursionCount) {
                    return false;
                }

                return typeArgs.find(
                    typeArg => requiresSpecialization(typeArg, recursionCount + 1)
                ) !== undefined;
            }

            if (ClassType.getTypeParameters(type).length === 0) {
                return false;
            }

            return true;
        }

        case TypeCategory.Object: {
            if (recursionCount > _maxRecursionCount) {
                return false;
            }

            return requiresSpecialization(type.classType, recursionCount + 1);
        }

        case TypeCategory.Function: {
            if (recursionCount > _maxRecursionCount) {
                return false;
            }

            for (let i = 0; i < FunctionType.getParameters(type).length; i ++) {
                if (requiresSpecialization(FunctionType.getEffectiveParameterType(type, i), recursionCount + 1)) {
                    return true;
                }
            }

            if (requiresSpecialization(FunctionType.getEffectiveReturnType(type), recursionCount + 1)) {
                return true;
            }

            return false;
        }

        case TypeCategory.OverloadedFunction: {
            return type.overloads.find(
                overload => requiresSpecialization(overload.type, recursionCount + 1)) !== undefined;
        }

        case TypeCategory.Property: {
            if (requiresSpecialization(type.getter, recursionCount + 1)) {
                return true;
            }

            if (type.setter && requiresSpecialization(type.setter, recursionCount + 1)) {
                return true;
            }

            if (type.deleter && requiresSpecialization(type.deleter, recursionCount + 1)) {
                return true;
            }

            return false;
        }

        case TypeCategory.Union: {
            return type.subtypes.find(
                type => requiresSpecialization(type, recursionCount + 1)) !== undefined;
        }

        case TypeCategory.TypeVar: {
            return true;
        }
    }

    return false;
}

export function isTypeSame(type1: Type, type2: Type, recursionCount = 0): boolean {
    if (type1.category !== type2.category) {
        return false;
    }

    if (recursionCount > _maxRecursionCount) {
        return true;
    }

    switch (type1.category) {
        case TypeCategory.Class: {
            const classType2 = type2 as ClassType;

            // If the class details are common, it's the same class.
            // In a few cases (e.g. with NamedTuple classes) we allocate a
            // new class type for every type analysis pass. To detect this
            // case, we will use the typeSourceId field.
            if (ClassType.getTypeSourceId(type1) !== ClassType.getTypeSourceId(classType2)) {
                return false;
            }

            // If neither of the classes have type arguments, they're the same.
            const type1TypeArgs = ClassType.getTypeArguments(type1);
            const type2TypeArgs = ClassType.getTypeArguments(classType2);
            if (!type1TypeArgs && !type2TypeArgs) {
                return true;
            }

            // If one of them is missing type arguments, they're not the same.
            if (!type1TypeArgs || !type2TypeArgs) {
                return false;
            }

            const typeArgCount = Math.max(type1TypeArgs.length, type2TypeArgs.length);

            // Make sure the type args match.
            for (let i = 0; i < typeArgCount; i++) {
                const typeArg1 = i < type1TypeArgs.length ?
                    type1TypeArgs[i] : AnyType.create();
                const typeArg2 = i < type2TypeArgs.length ?
                    type2TypeArgs[i] : AnyType.create();

                if (!isTypeSame(typeArg1, typeArg2, recursionCount + 1)) {
                    return false;
                }
            }

            return true;
        }

        case TypeCategory.Object: {
            const objType2 = type2 as ObjectType;

            if (type1.literalValue !== objType2.literalValue) {
                return false;
            }

            return isTypeSame(type1.classType, objType2.classType, recursionCount + 1);
        }

        case TypeCategory.Function: {
            // Make sure the parameter counts match.
            const functionType2 = type2 as FunctionType;
            const params1 = FunctionType.getParameters(type1);
            const params2 = FunctionType.getParameters(functionType2);

            if (params1.length !== params2.length) {
                return false;
            }

            // Make sure the parameter details match.
            for (let i = 0; i < params1.length; i++) {
                const param1 = params1[i];
                const param2 = params2[i];

                if (param1.category !== param2.category) {
                    return false;
                }

                if (param1.name !== param2.name) {
                    return false;
                }

                const param1Type = FunctionType.getEffectiveParameterType(type1, i);
                const param2Type = FunctionType.getEffectiveParameterType(functionType2, i);
                if (!isTypeSame(param1Type, param2Type, recursionCount + 1)) {
                    return false;
                }
            }

            // Make sure the return types match.
            const return1Type = FunctionType.getEffectiveReturnType(type1);
            const return2Type = FunctionType.getEffectiveReturnType(functionType2);
            if (!isTypeSame(return1Type, return2Type, recursionCount + 1)) {
                return false;
            }

            return true;
        }

        case TypeCategory.Union: {
            const unionType2 = type2 as UnionType;
            const subtypes1 = type1.subtypes;
            const subtypes2 = unionType2.subtypes;

            if (subtypes1.length !== subtypes2.length) {
                return false;
            }

            // The types do not have a particular order, so we need to
            // do the comparison in an order-independent manner.
            return subtypes1.find(t => !UnionType.containsType(unionType2, t, recursionCount + 1)) === undefined;
        }

        case TypeCategory.TypeVar: {
            const type2TypeVar = type2 as TypeVarType;

            if (type1.name !== type2TypeVar.name) {
                return false;
            }

            const boundType1 = type1.boundType;
            const boundType2 = type2TypeVar.boundType;
            if (boundType1) {
                if (!boundType2 || !isTypeSame(boundType1, boundType2, recursionCount + 1)) {
                    return false;
                }
            } else {
                if (boundType2) {
                    return false;
                }
            }

            if (type1.isContravariant !== type2TypeVar.isContravariant) {
                return false;
            }

            if (type1.isCovariant !== type2TypeVar.isCovariant) {
                return false;
            }

            const constraints1 = type1.constraints;
            const constraints2 = type2TypeVar.constraints;
            if (constraints1.length !== constraints2.length) {
                return false;
            }

            for (let i = 0; i < constraints1.length; i++) {
                if (!isTypeSame(constraints1[i], constraints2[i], recursionCount + 1)) {
                    return false;
                }
            }

            return true;
        }
    }

    return true;
}

export function printObjectTypeForClass(type: ClassType, recursionCount = 0): string {
    let objName = ClassType.getClassName(type);

    // If there is a type arguments array, it's a specialized class.
    const typeArgs = ClassType.getTypeArguments(type);

    if (typeArgs) {
        if (typeArgs.length > 0) {
            objName += '[' + typeArgs.map(typeArg => {
                return printType(typeArg, recursionCount + 1);
            }).join(', ') + ']';
        }
    } else {
        const typeParams = ClassType.getTypeParameters(type);

        if (typeParams.length > 0) {
            objName += '[' + typeParams.map(typeArg => {
                return printType(typeArg, recursionCount + 1);
            }).join(', ') + ']';
        }
    }

    return objName;
}

export function printLiteralValue(type: ObjectType): string {
    const literalValue = type.literalValue;
    if (literalValue === undefined) {
        return '';
    }

    let literalStr: string;
    if (typeof(literalValue) === 'string') {
        const prefix = (type.classType.details.name === 'bytes') ? 'b' : '';
        literalStr = `${ prefix }'${ literalValue.toString() }'`;
    } else if (typeof(literalValue) === 'boolean') {
        literalStr = literalValue ? 'True' : 'False';
    } else {
        literalStr = literalValue.toString();
    }

    return `Literal[${ literalStr }]`;
}

export function printFunctionParts(type: FunctionType, recursionCount = 0): [string[], string] {
    const paramTypeStrings = FunctionType.getParameters(type).map((param, index) => {
        let paramString = '';
        if (param.category === ParameterCategory.VarArgList) {
            paramString += '*';
        } else if (param.category === ParameterCategory.VarArgDictionary) {
            paramString += '**';
        }

        if (param.name) {
            paramString += param.name;
        }

        if (param.category === ParameterCategory.Simple) {
            const paramType = FunctionType.getEffectiveParameterType(type, index);
            const paramTypeString = recursionCount < _maxRecursionCount ?
                printType(paramType, recursionCount + 1) : '';
            paramString += ': ' + paramTypeString;
        }
        return paramString;
    });

    const returnType = FunctionType.getEffectiveReturnType(type);
    const returnTypeString = recursionCount < _maxRecursionCount ?
        printType(returnType, recursionCount + 1) : '';
    return [paramTypeStrings, returnTypeString];
}

export function printType(type: Type, recursionCount = 0): string {
    switch (type.category) {
        case TypeCategory.Unbound: {
            return 'Unbound';
        }

        case TypeCategory.Unknown: {
            return 'Unknown';
        }

        case TypeCategory.Module: {
            return 'Module';
        }

        case TypeCategory.Class: {
            return 'Type[' + printObjectTypeForClass(type,
                recursionCount + 1) + ']';
        }

        case TypeCategory.Object: {
            const objType = type;
            if (objType.literalValue !== undefined) {
                return printLiteralValue(objType);
            }

            return printObjectTypeForClass(objType.classType,
                recursionCount + 1);
        }

        case TypeCategory.Function: {
            const parts = printFunctionParts(type, recursionCount);
            return `(${ parts[0].join(', ') }) -> ${ parts[1] }`;
        }

        case TypeCategory.OverloadedFunction: {
            const overloadedType = type;
            const overloads = overloadedType.overloads.map(overload =>
                printType(overload.type, recursionCount + 1));
            return `Overload[${ overloads.join(', ') }]`;
        }

        case TypeCategory.Property: {
            const propertyType = type;
            const returnType = FunctionType.getEffectiveReturnType(propertyType.getter);
            const returnTypeString = recursionCount < _maxRecursionCount ?
                printType(returnType, recursionCount + 1) : '';
            return returnTypeString;
        }

        case TypeCategory.Union: {
            const unionType = type;
            const subtypes = unionType.subtypes;

            if (subtypes.find(t => t.category === TypeCategory.None) !== undefined) {
                const optionalType = recursionCount < _maxRecursionCount ?
                    printType(removeNoneFromUnion(unionType), recursionCount + 1) : '';
                return 'Optional[' + optionalType + ']';
            }

            const unionTypeString = recursionCount < _maxRecursionCount ?
                subtypes.map(t => printType(t, recursionCount + 1)).join(', ') : '';

            return 'Union[' + unionTypeString + ']';
        }

        case TypeCategory.TypeVar: {
            const typeVarType = type;
            const typeName = typeVarType.name;

            // Print the name in a simplified form if it's embedded
            // inside another type string.
            if (recursionCount > 0) {
                return typeName;
            }
            const params: string[] = [`'${ typeName }'`];
            if (recursionCount < _maxRecursionCount) {
                for (const constraint of typeVarType.constraints) {
                    params.push(printType(constraint, recursionCount + 1));
                }
            }
            return 'TypeVar[' + params.join(', ') + ']';
        }

        case TypeCategory.None: {
            return 'None';
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

// If the type is a union, remove any "unknown" or "any" type
// from the union, returning only the known types.
export function removeAnyFromUnion(type: Type): Type {
    return removeFromUnion(type, (t: Type) => isAnyOrUnknown(t));
}

// If the type is a union, remove an "unknown" type from the union,
// returning only the known types.
export function removeUnknownFromUnion(type: Type): Type {
    return removeFromUnion(type, (t: Type) => t.category === TypeCategory.Unknown);
}

// If the type is a union, remove an "unbound" type from the union,
// returning only the known types.
export function removeUnboundFromUnion(type: Type): Type {
    return removeFromUnion(type, (t: Type) => t.category === TypeCategory.Unbound);
}

// If the type is a union, remove an "None" type from the union,
// returning only the known types.
export function removeNoneFromUnion(type: Type): Type {
    return removeFromUnion(type, (t: Type) => t.category === TypeCategory.None);
}

export function removeFromUnion(type: Type, removeFilter: (type: Type) => boolean) {
    if (type.category === TypeCategory.Union) {
        const remainingTypes = type.subtypes.filter(t => !removeFilter(t));
        if (remainingTypes.length < type.subtypes.length) {
            return combineTypes(remainingTypes);
        }
    }

    return type;
}

// Combines multiple types into a single type. If the types are
// the same, only one is returned. If they differ, they
// are combined into a UnionType. NeverTypes are filtered out.
// If no types remain in the end, a NeverType is returned.
export function combineTypes(types: Type[]): Type {
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
        if (type.category === TypeCategory.Union) {
            expandedTypes = expandedTypes.concat(type.subtypes);
        } else {
            expandedTypes.push(type);
        }
    }

    // Sort all of the literal types to the end.
    expandedTypes = expandedTypes.sort((type1, type2) => {
        if (type1.category === TypeCategory.Object && type1.literalValue !== undefined) {
            return 1;
        } else if (type2.category === TypeCategory.Object && type2.literalValue !== undefined) {
            return -1;
        }
        return 0;
    });

    const resultingTypes = [expandedTypes[0]];
    expandedTypes.forEach((t, index) => {
        if (index > 0) {
            _addTypeIfUnique(resultingTypes, t);
        }
    });

    if (resultingTypes.length === 1) {
        return resultingTypes[0];
    }

    const unionType = UnionType.create();
    UnionType.addTypes(unionType, resultingTypes);

    return unionType;
}

// Determines whether the dest type is the same as the source type with
// the possible exception that the source type has a literal value when
// the dest does not.
export function isSameWithoutLiteralValue(destType: Type, srcType: Type): boolean {
    // If it's the same with literals, great.
    if (isTypeSame(destType, srcType)) {
        return true;
    }

    if (srcType.category === TypeCategory.Object && srcType.literalValue !== undefined) {
        // Strip the literal.
        srcType = ObjectType.create(srcType.classType);
        return isTypeSame(destType, srcType);
    }

    return false;
}

function _addTypeIfUnique(types: Type[], typeToAdd: Type) {
    for (const type of types) {
        // Does this type already exist in the types array?
        if (isTypeSame(type, typeToAdd)) {
            return;
        }

        // If the typeToAdd is a literal value and there's already
        // a non-literal type that matches, don't add the literal value.
        if (type.category === TypeCategory.Object && typeToAdd.category === TypeCategory.Object) {
            if (isSameWithoutLiteralValue(type, typeToAdd)) {
                if (type.literalValue === undefined) {
                    return;
                }
            }
        }
    }

    types.push(typeToAdd);
}
