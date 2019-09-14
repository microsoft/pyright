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

export type LiteralValue = number | boolean | string;

const _maxRecursionCount = 16;

export type InheritanceChain = (ClassType | UnknownType)[];

export class TypeVarMap extends StringMap<Type> {}

export abstract class Type {
    abstract category: TypeCategory;
}

export class UnboundType extends Type {
    category = TypeCategory.Unbound;
}

export namespace UnboundType {
    const _instance: UnboundType = new UnboundType();

    export function create() {
        // All Unbound objects are the same, so use a shared instance.
        return _instance;
    }
}

export class UnknownType extends Type {
    category = TypeCategory.Unknown;
}

export namespace UnknownType {
    const _instance: UnknownType = new UnknownType();

    export function create() {
        // All Unknown objects are the same, so use a shared instance.
        return _instance;
    }
}

export class ModuleType extends Type {
    category = TypeCategory.Module;
    fields: SymbolTable;
    docString?: string;

    // A partial module is one that is not fully initialized
    // but contains only the symbols that have been imported
    // in a multi-part import (e.g. import a.b.c).
    isPartialModule = false;
}

export namespace ModuleType {
    export function create(fields: SymbolTable, docString?: string) {
        const newModuleType = new ModuleType();
        newModuleType.fields = fields;
        newModuleType.docString = docString;
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
    classFields: SymbolTable;
    instanceFields: SymbolTable;
    typeParameters: TypeVarType[];
    isAbstractClass: boolean;
    docString?: string;
}

export class ClassType extends Type {
    category = TypeCategory.Class;

    details: ClassDetails;

    // A generic class that has been completely or partially
    // specialized will have type arguments that correspond to
    // some or all of the type parameters. Unspecified type
    // parameters are undefined.
    typeArguments?: Type[];

    skipAbstractClassTest: boolean;
}

export namespace ClassType {
    export function create(name: string, flags: ClassTypeFlags, typeSourceId: TypeSourceId, docString?: string) {
        const newClass = new ClassType();

        newClass.details = {
            name,
            flags,
            typeSourceId,
            baseClasses: [],
            classFields: new SymbolTable(),
            instanceFields: new SymbolTable(),
            typeParameters: [],
            isAbstractClass: false,
            docString
        };

        newClass.skipAbstractClassTest = false;
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

    export function isSpecialBuiltIn(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.SpecialBuiltIn);
    }

    export function isBuiltIn(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.BuiltInClass);
    }

    export function isProtocol(classType: ClassType) {
        // Does the class directly 'derive' from "Protocol"?
        return classType.details.baseClasses.find(bc => {
            if (bc.type instanceof ClassType) {
                if (isBuiltIn(bc.type) && getClassName(bc.type) === 'Protocol') {
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

    export function getClassFields(classType: ClassType): SymbolTable {
        return classType.details.classFields;
    }

    export function setClassFields(classType: ClassType, nameMap: SymbolTable) {
        classType.details.classFields = nameMap;
    }

    export function getInstanceFields(classType: ClassType): SymbolTable {
        return classType.details.instanceFields;
    }

    export function setInstanceFields(classType: ClassType, nameMap: SymbolTable) {
        classType.details.instanceFields = nameMap;
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
        if (isBuiltIn(classType) && isBuiltIn(type2) && type2.details.name === 'object') {
            if (inheritanceChain) {
                inheritanceChain.push(type2);
            }
            return true;
        }

        for (const baseClass of getBaseClasses(classType)) {
            if (baseClass.type instanceof ClassType) {
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

export class ObjectType extends Type {
    category = TypeCategory.Object;

    classType: ClassType;

    // Some types can be further constrained to have
    // literal types (e.g. true or 'string' or 3).
    literalValue?: LiteralValue;
}

export namespace ObjectType {
    export function create(classType: ClassType) {
        const newObjectType = new ObjectType();
        newObjectType.classType = classType;
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

export class FunctionType extends Type {
    category = TypeCategory.Function;

    private _functionDetails: FunctionDetails;

    // A function type can be specialized (i.e. generic type
    // variables replaced by a concrete type).
    private _specializedTypes?: SpecializedFunctionTypes;

    constructor(flags: FunctionTypeFlags, docString?: string) {
        super();
        this._functionDetails = {
            flags,
            parameters: [],
            inferredReturnType: new InferredType(),
            inferredYieldType: new InferredType(),
            docString
        };
    }

    // Creates a deep copy of the function type, including a fresh
    // version of _functionDetails.
    clone(deleteFirstParam = false): FunctionType {
        const newFunction = new FunctionType(this._functionDetails.flags,
            this._functionDetails.docString);
        const startParam = deleteFirstParam ? 1 : 0;

        newFunction._functionDetails = {
            flags: this._functionDetails.flags,
            parameters: this._functionDetails.parameters.slice(startParam),
            declaredReturnType: this._functionDetails.declaredReturnType,
            inferredReturnType: this._functionDetails.inferredReturnType,
            inferredYieldType: this._functionDetails.inferredYieldType,
            builtInName: this._functionDetails.builtInName,
            docString: this._functionDetails.docString
        };

        // If we strip off the first parameter, this is no longer an
        // instance method or class method.
        if (deleteFirstParam) {
            newFunction._functionDetails.flags &= ~(FunctionTypeFlags.InstanceMethod |
                FunctionTypeFlags.ClassMethod);
        }

        if (this._specializedTypes) {
            newFunction._specializedTypes = {
                parameterTypes: this._specializedTypes.parameterTypes.slice(startParam),
                returnType: this._specializedTypes.returnType
            };
        }

        return newFunction;
    }

    // Creates a shallow copy of the function type with new
    // specialized types. The clone shares the _functionDetails
    // with the object being cloned.
    cloneForSpecialization(specializedTypes: SpecializedFunctionTypes): FunctionType {
        const newFunction = new FunctionType(this._functionDetails.flags,
            this._functionDetails.docString);
        newFunction._functionDetails = this._functionDetails;

        assert(specializedTypes.parameterTypes.length === this._functionDetails.parameters.length);
        newFunction._specializedTypes = specializedTypes;

        return newFunction;
    }

    isInstanceMethod(): boolean {
        return (this._functionDetails.flags & FunctionTypeFlags.InstanceMethod) !== 0;
    }

    setIsInstanceMethod() {
        this._functionDetails.flags |= FunctionTypeFlags.InstanceMethod;
    }

    isConstructorMethod(): boolean {
        return (this._functionDetails.flags & FunctionTypeFlags.ConstructorMethod) !== 0;
    }

    isStaticMethod(): boolean {
        return (this._functionDetails.flags & FunctionTypeFlags.StaticMethod) !== 0;
    }

    setIsStaticMethod() {
        this._functionDetails.flags |= FunctionTypeFlags.StaticMethod;
    }

    isClassMethod(): boolean {
        return (this._functionDetails.flags & FunctionTypeFlags.ClassMethod) !== 0;
    }

    setIsClassMethod() {
        this._functionDetails.flags |= FunctionTypeFlags.ClassMethod;
    }

    isAbstractMethod(): boolean {
        return (this._functionDetails.flags & FunctionTypeFlags.AbstractMethod) !== 0;
    }

    setIsAbstractMethod() {
        this._functionDetails.flags |= FunctionTypeFlags.AbstractMethod;
    }

    isSynthesizedMethod(): boolean {
        return (this._functionDetails.flags & FunctionTypeFlags.SynthesizedMethod) !== 0;
    }

    getBuiltInName() {
        return this._functionDetails.builtInName;
    }

    setBuiltInName(name: string) {
        this._functionDetails.builtInName = name;
    }

    getDocString() {
        return this._functionDetails.docString;
    }

    getParameters() {
        return this._functionDetails.parameters;
    }

    getParameterCount() {
        return this._functionDetails.parameters.length;
    }

    isDefaultParameterCheckDisabled() {
        return (this._functionDetails.flags & FunctionTypeFlags.DisableDefaultChecks) !== 0;
    }

    setDefaultParameterCheckDisabled() {
        this._functionDetails.flags |= FunctionTypeFlags.DisableDefaultChecks;
    }

    setParameterType(index: number, type: Type): boolean {
        assert(index < this._functionDetails.parameters.length);
        const typeChanged = !isTypeSame(type, this._functionDetails.parameters[index].type);
        this._functionDetails.parameters[index].type = type;
        return typeChanged;
    }

    getEffectiveParameterType(index: number): Type {
        assert(index < this._functionDetails.parameters.length);
        if (this._specializedTypes) {
            return this._specializedTypes.parameterTypes[index];
        }

        return this._functionDetails.parameters[index].type;
    }

    addParameter(param: FunctionParameter) {
        this._functionDetails.parameters.push(param);
    }

    getDeclaredReturnType() {
        return this._functionDetails.declaredReturnType;
    }

    getSpecializedReturnType() {
        return this._specializedTypes ? this._specializedTypes.returnType :
            this._functionDetails.declaredReturnType;
    }

    setDeclaredReturnType(type?: Type): boolean {
        const typeChanged = !this._functionDetails.declaredReturnType || !type ||
            !isTypeSame(this._functionDetails.declaredReturnType, type);
        this._functionDetails.declaredReturnType = type;

        return typeChanged;
    }

    getInferredReturnType() {
        return this._functionDetails.inferredReturnType;
    }

    getInferredYieldType() {
        return this._functionDetails.inferredYieldType;
    }

    getEffectiveReturnType() {
        const specializedReturnType = this.getSpecializedReturnType();
        if (specializedReturnType) {
            return specializedReturnType;
        }

        if (this.isGenerator()) {
            // Wrap this in an Iterator type.
            return this._functionDetails.inferredYieldType.getType();
        }

        return this._functionDetails.inferredReturnType.getType();
    }

    isGenerator() {
        return this._functionDetails.inferredYieldType.getSourceCount() > 0;
    }
}

export interface OverloadedFunctionEntry {
    type: FunctionType;
    typeSourceId: TypeSourceId;
}

export class OverloadedFunctionType extends Type {
    category = TypeCategory.OverloadedFunction;

    private _overloads: OverloadedFunctionEntry[] = [];

    constructor() {
        super();
    }

    getOverloads() {
        return this._overloads;
    }

    addOverload(typeSourceId: TypeSourceId, type: FunctionType) {
        // Was this entry already added? If so, replace the type.
        const index = this._overloads.findIndex(entry => entry.typeSourceId === typeSourceId);
        if (index >= 0) {
            this._overloads[index].type = type;
        } else {
            this._overloads.push({ typeSourceId, type});
        }
    }
}

export class PropertyType extends Type {
    category = TypeCategory.Property;

    private _getter: FunctionType;
    private _setter?: FunctionType;
    private _deleter?: FunctionType;

    constructor(getter: FunctionType) {
        super();
        this._getter = getter;
    }

    getGetter() {
        return this._getter;
    }

    hasSetter() {
        return this._setter !== undefined;
    }

    getSetter() {
        return this._setter;
    }

    setSetter(setter: FunctionType) {
        this._setter = setter;
    }

    hasDeleter() {
        return this._deleter !== undefined;
    }

    getDeleter() {
        return this._deleter;
    }

    setDeleter(deleter: FunctionType) {
        this._deleter = deleter;
    }

    getEffectiveReturnType() {
        return this._getter.getEffectiveReturnType();
    }
}

export class NoneType extends Type {
    category = TypeCategory.None;

    private static _noneInstance = new NoneType();
    static create() {
        // Use a single instance to reduce memory allocation.
        return this._noneInstance;
    }
}

export class NeverType extends NoneType {
    category = TypeCategory.Never;

    private static _neverInstance = new NeverType();
    static create() {
        // Use a single instance to reduce memory allocation.
        return this._neverInstance;
    }
}

export class AnyType extends Type {
    category = TypeCategory.Any;
    private _isEllipsis: boolean;

    private static _anyInstance = new AnyType(false);
    private static _ellipsisInstance = new AnyType(true);
    static create(isEllipsis = false) {
        // Use a single instance to reduce memory allocation.
        return isEllipsis ? this._ellipsisInstance : this._anyInstance;
    }

    private constructor(isEllipsis: boolean) {
        super();
        this._isEllipsis = isEllipsis;
    }

    isEllipsis(): boolean {
        return this._isEllipsis;
    }
}

export class UnionType extends Type {
    category = TypeCategory.Union;

    private _types: Type[] = [];

    constructor() {
        super();
    }

    getTypes() {
        return this._types;
    }

    addTypes(types: Type[]) {
        for (const newType of types) {
            assert(newType.category !== TypeCategory.Union);
            assert(newType.category !== TypeCategory.Never);
            this._types.push(newType);
        }
    }

    containsType(type: Type, recursionCount = 0): boolean {
        return this._types.find(t => isTypeSame(t, type, recursionCount + 1)) !== undefined;
    }
}

export class TypeVarType extends Type {
    category = TypeCategory.TypeVar;

    private _name: string;
    private _constraints: Type[] = [];
    private _boundType?: Type;
    private _isCovariant = false;
    private _isContravariant = false;

    constructor(name: string) {
        super();
        this._name = name;
    }

    getName() {
        return this._name;
    }

    getConstraints() {
        return this._constraints;
    }

    addConstraint(type: Type) {
        this._constraints.push(type);
    }

    getBoundType() {
        return this._boundType;
    }

    setBoundType(type?: Type) {
        this._boundType = type;
    }

    isCovariant() {
        return this._isCovariant;
    }

    setIsCovariant() {
        this._isCovariant = true;
    }

    isContravariant() {
        return this._isContravariant;
    }

    setIsContravariant() {
        this._isContravariant = true;
    }
}

export function isAnyOrUnknown(type: Type): boolean {
    if (type.category === TypeCategory.Any ||
            type.category === TypeCategory.Unknown) {
        return true;
    }

    if (type instanceof UnionType) {
        return type.getTypes().find(t => !isAnyOrUnknown(t)) === undefined;
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

    if (type instanceof UnionType) {
        return type.getTypes().find(t => isPossiblyUnbound(t)) !== undefined;
    }

    return false;
}

export function requiresSpecialization(type: Type, recursionCount = 0): boolean {
    if (type instanceof ClassType) {
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
    } else if (type instanceof ObjectType) {
        if (recursionCount > _maxRecursionCount) {
            return false;
        }

        return requiresSpecialization(type.classType, recursionCount + 1);
    } else if (type instanceof FunctionType) {
        if (recursionCount > _maxRecursionCount) {
            return false;
        }

        for (let i = 0; i < type.getParameters().length; i ++) {
            if (requiresSpecialization(type.getEffectiveParameterType(i), recursionCount + 1)) {
                return true;
            }
        }

        if (requiresSpecialization(type.getEffectiveReturnType(), recursionCount + 1)) {
            return true;
        }

        return false;
    } else if (type instanceof OverloadedFunctionType) {
        return type.getOverloads().find(
            overload => requiresSpecialization(overload.type, recursionCount + 1)) !== undefined;
    } else if (type instanceof PropertyType) {
        if (requiresSpecialization(type.getGetter(), recursionCount + 1)) {
            return true;
        }

        const setter = type.getSetter();
        if (setter && requiresSpecialization(setter, recursionCount + 1)) {
            return true;
        }

        const deleter = type.getDeleter();
        if (deleter && requiresSpecialization(deleter, recursionCount + 1)) {
            return true;
        }

        return false;
    } else if (type instanceof UnionType) {
        return type.getTypes().find(
            type => requiresSpecialization(type, recursionCount + 1)) !== undefined;
    } else if (type instanceof TypeVarType) {
        return true;
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

    if (type1 instanceof ClassType) {
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

            if ((typeArg1 instanceof Type) !== (typeArg2 instanceof Type)) {
                return false;
            }

            if (!isTypeSame(typeArg1, typeArg2, recursionCount + 1)) {
                return false;
            }
        }

        return true;
    } else if (type1 instanceof ObjectType) {
        const objType2 = type2 as ObjectType;

        if (type1.literalValue !== objType2.literalValue) {
            return false;
        }

        return isTypeSame(type1.classType, objType2.classType, recursionCount + 1);
    } else if (type1 instanceof FunctionType) {
        // Make sure the parameter counts match.
        const functionType2 = type2 as FunctionType;
        const params1 = type1.getParameters();
        const params2 = functionType2.getParameters();

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

            const param1Type = type1.getEffectiveParameterType(i);
            const param2Type = functionType2.getEffectiveParameterType(i);
            if (!isTypeSame(param1Type, param2Type, recursionCount + 1)) {
                return false;
            }
        }

        // Make sure the return types match.
        const return1Type = type1.getEffectiveReturnType();
        const return2Type = functionType2.getEffectiveReturnType();
        if (!isTypeSame(return1Type, return2Type, recursionCount + 1)) {
            return false;
        }

        return true;
    } else if (type1 instanceof UnionType) {
        const unionType2 = type2 as UnionType;
        const subtypes1 = type1.getTypes();
        const subtypes2 = unionType2.getTypes();

        if (subtypes1.length !== subtypes2.length) {
            return false;
        }

        // The types do not have a particular order, so we need to
        // do the comparison in an order-independent manner.
        return subtypes1.find(t => !unionType2.containsType(t, recursionCount + 1)) === undefined;
    } else if (type1 instanceof TypeVarType) {
        const type2TypeVar = type2 as TypeVarType;

        if (type1.getName() !== type2TypeVar.getName()) {
            return false;
        }

        const boundType1 = type1.getBoundType();
        const boundType2 = type2TypeVar.getBoundType();
        if (boundType1) {
            if (!boundType2 || !isTypeSame(boundType1, boundType2, recursionCount + 1)) {
                return false;
            }
        } else {
            if (boundType2) {
                return false;
            }
        }

        if (type1.isContravariant() !== type2TypeVar.isContravariant()) {
            return false;
        }

        if (type1.isCovariant() !== type2TypeVar.isCovariant()) {
            return false;
        }

        const constraints1 = type1.getConstraints();
        const constraints2 = type2TypeVar.getConstraints();
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
        literalStr = `'${ literalValue.toString() }'`;
    } else if (typeof(literalValue) === 'boolean') {
        literalStr = literalValue ? 'True' : 'False';
    } else {
        literalStr = literalValue.toString();
    }

    return `Literal[${ literalStr }]`;
}

export function printFunctionParts(type: FunctionType, recursionCount = 0): [string[], string] {
    const paramTypeStrings = type.getParameters().map((param, index) => {
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
            const paramType = type.getEffectiveParameterType(index);
            const paramTypeString = recursionCount < _maxRecursionCount ?
                printType(paramType, recursionCount + 1) : '';
            paramString += ': ' + paramTypeString;
        }
        return paramString;
    });

    const returnType = type.getEffectiveReturnType();
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
            return 'Type[' + printObjectTypeForClass(type as ClassType,
                recursionCount + 1) + ']';
        }

        case TypeCategory.Object: {
            const objType = type as ObjectType;
            if (objType.literalValue !== undefined) {
                return printLiteralValue(objType);
            }

            return printObjectTypeForClass(objType.classType,
                recursionCount + 1);
        }

        case TypeCategory.Function: {
            const parts = printFunctionParts(type as FunctionType, recursionCount);
            return `(${ parts[0].join(', ') }) -> ${ parts[1] }`;
        }

        case TypeCategory.OverloadedFunction: {
            const overloadedType = type as OverloadedFunctionType;
            const overloads = overloadedType.getOverloads().map(overload =>
                printType(overload.type, recursionCount + 1));
            return `Overload[${ overloads.join(', ') }]`;
        }

        case TypeCategory.Property: {
            const propertyType = type as PropertyType;
            const returnType = propertyType.getGetter().getEffectiveReturnType();
            const returnTypeString = recursionCount < _maxRecursionCount ?
                printType(returnType, recursionCount + 1) : '';
            return returnTypeString;
        }

        case TypeCategory.Union: {
            const unionType = type as UnionType;
            const subtypes = unionType.getTypes();

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
            const typeVarType = type as TypeVarType;
            const typeName = typeVarType.getName();

            // Print the name in a simplified form if it's embedded
            // inside another type string.
            if (recursionCount > 0) {
                return typeName;
            }
            const params: string[] = [`'${ typeName }'`];
            if (recursionCount < _maxRecursionCount) {
                for (const constraint of typeVarType.getConstraints()) {
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
            const anyType = type as AnyType;
            return anyType.isEllipsis() ? '...' : 'Any';
        }
    }

    return '';
}

// If the type is a union, remove any "unknown" or "any" type
// from the union, returning only the known types.
export function removeAnyFromUnion(type: Type): Type {
    return removeFromUnion(type, (t: Type) => isAnyOrUnknown(t));
}

// If the type is a union, remvoe an "unknown" type from the union,
// returning only the known types.
export function removeUnknownFromUnion(type: Type): Type {
    return removeFromUnion(type, (t: Type) => t.category === TypeCategory.Unknown);
}

// If the type is a union, remvoe an "unbound" type from the union,
// returning only the known types.
export function removeUnboundFromUnion(type: Type): Type {
    return removeFromUnion(type, (t: Type) => t.category === TypeCategory.Unbound);
}

// If the type is a union, remvoe an "None" type from the union,
// returning only the known types.
export function removeNoneFromUnion(type: Type): Type {
    return removeFromUnion(type, (t: Type) => t.category === TypeCategory.None);
}

export function removeFromUnion(type: Type, removeFilter: (type: Type) => boolean) {
    if (type instanceof UnionType) {
        const remainingTypes = type.getTypes().filter(t => !removeFilter(t));
        if (remainingTypes.length < type.getTypes().length) {
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
        if (type instanceof UnionType) {
            expandedTypes = expandedTypes.concat(type.getTypes());
        } else {
            expandedTypes.push(type);
        }
    }

    // Sort all of the literal types to the end.
    expandedTypes = expandedTypes.sort((type1, type2) => {
        if (type1 instanceof ObjectType && type1.literalValue !== undefined) {
            return 1;
        } else if (type2 instanceof ObjectType && type2.literalValue !== undefined) {
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

    const unionType = new UnionType();
    unionType.addTypes(resultingTypes);

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

    if (srcType instanceof ObjectType && srcType.literalValue !== undefined) {
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
        if (type instanceof ObjectType && typeToAdd instanceof ObjectType) {
            if (isSameWithoutLiteralValue(type, typeToAdd)) {
                if (type.literalValue === undefined) {
                    return;
                }
            }
        }
    }

    types.push(typeToAdd);
}
