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

export enum TypeCategory {
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

    // Immutable sequence of typed values.
    Tuple,

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

const MaxRecursionCount = 20;

export class TypeVarMap extends StringMap<Type> {}

export abstract class Type {
    abstract category: TypeCategory;

    protected constructor() {
    }

    isUnbound(): boolean {
        return false;
    }

    isAny(): boolean {
        return false;
    }

    isPossiblyUnbound(): boolean {
        return false;
    }

    isSame(type2: Type, recursionCount = 0): boolean {
        return this.category === type2.category;
    }

    asString(): string {
        return this.asStringInternal(0);
    }

    abstract asStringInternal(recursionCount: number): string;

    requiresSpecialization(recursionCount = 0): boolean {
        return false;
    }
}

export class UnboundType extends Type {
    category = TypeCategory.Unbound;

    private static _instance = new UnboundType();
    static create() {
        // Use a single instance to reduce memory allocation.
        return this._instance;
    }

    protected constructor() {
        super();
    }

    isUnbound(): boolean {
        return true;
    }

    isAny(): boolean {
        return false;
    }

    isPossiblyUnbound(): boolean {
        return true;
    }

    asStringInternal(recursionCount = 0): string {
        return 'Unbound';
    }
}

export class UnknownType extends Type {
    category = TypeCategory.Unknown;

    private static _instance = new UnknownType();
    static create() {
        // Use a single instance to reduce memory allocation.
        return this._instance;
    }

    isAny(): boolean {
        return true;
    }

    asStringInternal(recursionCount = 0): string {
        return 'Unknown';
    }
}

export class ModuleType extends Type {
    category = TypeCategory.Module;
    private _fields: SymbolTable;

    // A partial module is one that is not fully initialized
    // but contains only the symbols that have been imported
    // in a multi-part import (e.g. import a.b.c).
    private _isPartialModule = false;

    constructor(symbolTable: SymbolTable) {
        super();

        this._fields = symbolTable;
    }

    getFields() {
        return this._fields;
    }

    setIsPartialModule() {
        this._isPartialModule = true;
    }

    isPartialModule() {
        return this._isPartialModule;
    }

    asStringInternal(recursionCount = 0): string {
        return 'Module';
    }
}

export enum ClassTypeFlags {
    None = 0x00,

    // The class has one or more decorators.
    HasDecorators = 0x01,

    // Class is defined in the "builtins" or "typings" file.
    BuiltInClass = 0x02,

    // Class requires special-case handling because it
    // exhibits non-standard behavior or is not defined
    // formally as a class. Examples include 'Optional'
    // and 'Union'.
    SpecialBuiltIn = 0x04,

    // Introduced in Python 3.7 - class either derives directly
    // from NamedTuple or has a @dataclass class decorator.
    DataClass = 0x08
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
    dataFields: SymbolTable;
    instanceFields: SymbolTable;
    typeParameters: TypeVarType[];
    isAbstractClass: boolean;
}

export class ClassType extends Type {
    category = TypeCategory.Class;

    private _classDetails: ClassDetails;

    // A generic class that has been completely or partially
    // specialized will have type arguments that correspond to
    // some or all of the type parameters. Unspecified type
    // parameters are undefined.
    private _typeArguments?: Type[];

    private _skipAbstractClassTest = false;

    constructor(name: string, flags: ClassTypeFlags, typeSourceId: TypeSourceId) {
        super();

        this._classDetails = {
            name,
            flags,
            typeSourceId,
            baseClasses: [],
            classFields: new SymbolTable(),
            instanceFields: new SymbolTable(),
            dataFields: new SymbolTable(),
            typeParameters: [],
            isAbstractClass: false
        };
    }

    cloneForSpecialization(typeArguments: Type[], skipAbstractClassTest = false): ClassType {
        let newClassType = new ClassType(this._classDetails.name,
            this._classDetails.flags, this._classDetails.typeSourceId);
        newClassType._classDetails = this._classDetails;
        newClassType.setTypeArguments(typeArguments);
        if (skipAbstractClassTest) {
            newClassType._setSkipAbstracClassTest();
        }
        return newClassType;
    }

    // Specifies whether the class type is generic (unspecialized)
    // or specialized.
    isGeneric() {
        return this._classDetails.typeParameters.length > 0 &&
            this._typeArguments === undefined;
    }

    requiresSpecialization(recursionCount = 0) {
        if (this._typeArguments) {
            if (recursionCount > MaxRecursionCount) {
                return false;
            }

            return this._typeArguments.find(
                typeArg => typeArg.requiresSpecialization(recursionCount + 1)
            ) !== undefined;
        }

        if (this._classDetails.typeParameters.length === 0) {
            return false;
        }

        return true;
    }

    isSpecialBuiltIn() {
        return !!(this._classDetails.flags & ClassTypeFlags.SpecialBuiltIn);
    }

    isBuiltIn() {
        return !!(this._classDetails.flags & ClassTypeFlags.BuiltInClass);
    }

    isProtocol() {
        // Does the class directly 'derive' from "Protocol"?
        return this._classDetails.baseClasses.find(bc => {
            if (bc.type instanceof ClassType) {
                if (bc.type.isBuiltIn() && bc.type.getClassName() === 'Protocol') {
                    return true;
                }
            }
            return false;
        }) !== undefined;
    }

    setIsAbstractClass() {
        this._classDetails.isAbstractClass = true;
    }

    isAbstractClass() {
        return this._classDetails.isAbstractClass &&
            !this._skipAbstractClassTest;
    }

    getClassName() {
        return this._classDetails.name;
    }

    setIsDataClass() {
        this._classDetails.flags |= ClassTypeFlags.DataClass;
    }

    isDataClass() {
        return !!(this._classDetails.flags & ClassTypeFlags.DataClass);
    }

    hasDecorators() {
        return !!(this._classDetails.flags & ClassTypeFlags.HasDecorators);
    }

    getBaseClasses(): BaseClass[] {
        return this._classDetails.baseClasses;
    }

    setAliasClass(type: ClassType) {
        this._classDetails.aliasClass = type;
    }

    getAliasClass() {
        return this._classDetails.aliasClass;
    }

    addBaseClass(type: Type, isMetaclass: boolean) {
        this._classDetails.baseClasses.push({ isMetaclass, type });
    }

    updateBaseClassType(index: number, type: Type) {
        const didChange = !type.isSame(this._classDetails.baseClasses[index].type);
        this._classDetails.baseClasses[index].type = type;
        return didChange;
    }

    getClassFields(): SymbolTable {
        return this._classDetails.classFields;
    }

    setClassFields(nameMap: SymbolTable) {
        this._classDetails.classFields = nameMap;
    }

    getDataFields(): SymbolTable {
        return this._classDetails.dataFields;
    }

    setDataFields(nameMap: SymbolTable) {
        this._classDetails.dataFields = nameMap;
    }

    getInstanceFields(): SymbolTable {
        return this._classDetails.instanceFields;
    }

    setInstanceFields(nameMap: SymbolTable) {
        this._classDetails.instanceFields = nameMap;
    }

    setTypeArguments(typeArgs: Type[]) {
        // Special built-in types can have a variable number of type parameters, so
        // ignore those. For all others, verify that we have enough type arguments
        // to match all of the type parameters. It's possible in early phases of
        // analysis for there to be more type args than parameters because the parameters
        // have not yet been filled in for forward-declared classes.
        assert(this.isSpecialBuiltIn() || typeArgs.length >= this.getTypeParameters().length);

        this._typeArguments = typeArgs;
    }

    getTypeArguments() {
        return this._typeArguments;
    }

    getTypeParameters() {
        // If this is a special class, use the alias class' type
        // parameters instead.
        if (this._classDetails.aliasClass) {
            return this._classDetails.aliasClass._classDetails.typeParameters;
        }
        return this._classDetails.typeParameters;
    }

    setTypeParameters(params: TypeVarType[]): boolean {
        let didParametersChange = false;

        if (this._classDetails.typeParameters.length !== params.length) {
            didParametersChange = true;
        } else {
            for (let i = 0; i < params.length; i++) {
                if (!params[i].isSame(this._classDetails.typeParameters[i])) {
                    didParametersChange = true;
                }
            }
        }

        this._classDetails.typeParameters = params;

        return didParametersChange;
    }

    // Same as isSame except that it doesn't compare type arguments.
    isSameGenericClass(type2: ClassType) {
        // If the class details match, it's definitely the same class.
        if (this._classDetails === type2._classDetails) {
            return true;
        }

        // Special built-in classes generate new class details for
        // each instance, so we need to rely on a name comparison.
        if (this.isSpecialBuiltIn() && type2.isSpecialBuiltIn() &&
                this.getClassName() === type2.getClassName()) {
            return true;
        }

        if (this.isAliasOf(type2) || type2.isAliasOf(this)) {
            return true;
        }

        return false;
    }

    isSame(type2: Type, recursionCount = 0): boolean {
        if (recursionCount > MaxRecursionCount) {
            return true;
        }

        if (!super.isSame(type2, recursionCount + 1)) {
            return false;
        }

        let classType2 = type2 as ClassType;

        // If the class details are common, it's the same class.
        // In a few cases (e.g. with NamedTuple classes) we allocate a
        // new class type for every type analysis pass. To detect this
        // case, we will use the typeSourceId field.
        if (this._classDetails.typeSourceId !== classType2._classDetails.typeSourceId) {
            return false;
        }

        // If neither of the classes have type arguments, they're the same.
        if (!this._typeArguments && !classType2._typeArguments) {
            return true;
        }

        // If one of them is missing type arguments, they're not the same.
        if (!this._typeArguments || !classType2._typeArguments) {
            return false;
        }

        let typeArgCount = Math.max(this._typeArguments.length,
            classType2._typeArguments.length);

        // Make sure the type args match.
        for (let i = 0; i < typeArgCount; i++) {
            let typeArg1 = i < this._typeArguments.length ?
                this._typeArguments[i] : AnyType.create();
            let typeArg2 = i < classType2._typeArguments.length ?
                classType2._typeArguments[i] : AnyType.create();

            if ((typeArg1 instanceof Type) !== (typeArg2 instanceof Type)) {
                return false;
            }

            if (!typeArg1.isSame(typeArg2, recursionCount + 1)) {
                return false;
            }
        }

        return true;
    }

    getObjectName(recursionCount = 0): string {
        let objName = this._classDetails.name;

        // If there is a type arguments array, it's a specialized class.
        if (this._typeArguments) {
            if (this._typeArguments.length > 0) {
                objName += '[' + this._typeArguments.map(typeArg => {
                    return typeArg.asStringInternal(recursionCount + 1);
                }).join(', ') + ']';
            }
        } else if (this._classDetails.typeParameters.length > 0) {
            objName += '[' + this._classDetails.typeParameters.map(typeArg => {
                return typeArg.asStringInternal(recursionCount + 1);
            }).join(', ') + ']';
        }

        return objName;
    }

    asStringInternal(recursionCount = 0): string {
        // Return the same string that we'd use for an instance
        // of the class.
        return 'Type[' + this.getObjectName(recursionCount + 1) + ']';
    }

    isAliasOf(type2: ClassType): boolean {
        return type2._classDetails.aliasClass !== undefined &&
            type2._classDetails.aliasClass._classDetails === this._classDetails;
    }

    // Determines whether this is a subclass (derived class)
    // of the specified class. If the caller passes an empty
    // array to inheritanceChain, it will be filled in by
    // the call to include the chain inherited classes starting
    // with type2 and ending with this type.
    isDerivedFrom(type2: ClassType, inheritanceChain?: Type[]): boolean {
        // Is it the exact same class?
        if (this.isSameGenericClass(type2)) {
            if (inheritanceChain) {
                inheritanceChain.push(type2);
            }
            return true;
        }

        // Handle built-in types like 'dict' and 'list', which are all
        // subclasses of object even though they are not explicitly declared
        // that way.
        if (this.isBuiltIn() && type2.isBuiltIn() && type2._classDetails.name === 'object') {
            if (inheritanceChain) {
                inheritanceChain.push(type2);
            }
            return true;
        }

        for (let baseClass of this.getBaseClasses()) {
            if (baseClass.type instanceof ClassType) {
                if (baseClass.type.isDerivedFrom(type2, inheritanceChain)) {
                    if (inheritanceChain) {
                        inheritanceChain.push(this);
                    }
                    return true;
                }
            } else if (baseClass.type.isAny()) {
                if (inheritanceChain) {
                    inheritanceChain.push(this);
                }
                return true;
            }
        }

        return false;
    }

    private _setSkipAbstracClassTest() {
        this._skipAbstractClassTest = true;
    }
}

export class ObjectType extends Type {
    category = TypeCategory.Object;

    private _classType: ClassType;

    // Some objects (e.g. "bool") can be truthy or falsy.
    // During analysis, we may determine that a type is explicitly
    // truthy or explicitly falsy. If unknown, this field is
    // undefined. If known, it is set.
    private _truthyOrFalsy?: boolean;

    constructor(classType: ClassType) {
        super();

        assert(classType instanceof ClassType);
        this._classType = classType;
    }

    cloneAsTruthy(): ObjectType {
        let newType = new ObjectType(this._classType);
        newType._truthyOrFalsy = true;
        return newType;
    }

    cloneAsFalsy(): ObjectType {
        let newType = new ObjectType(this._classType);
        newType._truthyOrFalsy = false;
        return newType;
    }

    getClassType() {
        return this._classType;
    }

    getTruthyOrFalsy(): boolean | undefined {
        return this._truthyOrFalsy;
    }

    isSame(type2: Type, recursionCount = 0): boolean {
        if (recursionCount > MaxRecursionCount) {
            return true;
        }

        return super.isSame(type2, recursionCount + 1) &&
            this._classType.isSame((type2 as ObjectType)._classType, recursionCount + 1);
    }

    asStringInternal(recursionCount = 0): string {
        return this._classType.getObjectName(recursionCount + 1);
    }

    requiresSpecialization(recursionCount = 0) {
        if (recursionCount > MaxRecursionCount) {
            return false;
        }

        return this._classType.requiresSpecialization(recursionCount + 1);
    }
}

export interface FunctionParameter {
    category: ParameterCategory;
    name?: string;
    hasDefault?: boolean;
    type: Type;
}

export enum FunctionTypeFlags {
    None = 0,
    InstanceMethod = 1,
    ClassMethod = 2,
    StaticMethod = 4,
    AbstractMethod = 8
}

interface FunctionDetails {
    flags: FunctionTypeFlags;
    parameters: FunctionParameter[];
    declaredReturnType?: Type;
    declaredYieldType?: Type;
    inferredReturnType: InferredType;
    inferredYieldType: InferredType;
    builtInName?: string;
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

    constructor(flags: FunctionTypeFlags) {
        super();
        this._functionDetails = {
            flags,
            parameters: [],
            inferredReturnType: new InferredType(),
            inferredYieldType: new InferredType()
        };
    }

    // Creates a deep copy of the function type, including a fresh
    // version of _functionDetails.
    clone(deleteFirstParam = false): FunctionType {
        let newFunction = new FunctionType(this._functionDetails.flags);
        const startParam = deleteFirstParam ? 1 : 0;

        newFunction._functionDetails = {
            flags: this._functionDetails.flags,
            parameters: this._functionDetails.parameters.slice(startParam),
            declaredReturnType: this._functionDetails.declaredReturnType,
            declaredYieldType: this._functionDetails.declaredYieldType,
            inferredReturnType: this._functionDetails.inferredReturnType,
            inferredYieldType: this._functionDetails.inferredYieldType,
            builtInName: this._functionDetails.builtInName
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
        let newFunction = new FunctionType(this._functionDetails.flags);
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

    getBuiltInName() {
        return this._functionDetails.builtInName;
    }

    setBuiltInName(name: string) {
        this._functionDetails.builtInName = name;
    }

    getParameters() {
        return this._functionDetails.parameters;
    }

    getParameterCount() {
        return this._functionDetails.parameters.length;
    }

    setParameterType(index: number, type: Type): boolean {
        assert(index < this._functionDetails.parameters.length);
        const typeChanged = !type.isSame(this._functionDetails.parameters[index].type);
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

    getDeclaredYieldType() {
        return this._functionDetails.declaredYieldType;
    }

    setDeclaredReturnType(type?: Type): boolean {
        const typeChanged = !this._functionDetails.declaredReturnType || !type ||
            !this._functionDetails.declaredReturnType.isSame(type);
        this._functionDetails.declaredReturnType = type;

        return typeChanged;
    }

    getInferredReturnType() {
        return this._functionDetails.inferredReturnType;
    }

    getEffectiveReturnType() {
        if (this._specializedTypes) {
            return this._specializedTypes.returnType;
        }

        if (this._functionDetails.declaredReturnType) {
            return this._functionDetails.declaredReturnType;
        }

        return this._functionDetails.inferredReturnType.getType();
    }

    getInferredYieldType() {
        return this._functionDetails.inferredYieldType;
    }

    getEffectiveYieldType() {
        if (this._functionDetails.declaredYieldType) {
            return this._functionDetails.declaredYieldType;
        }

        return this._functionDetails.inferredYieldType.getType();
    }

    asStringInternal(recursionCount = 0): string {
        let paramTypeString = this._functionDetails.parameters.map((param, index) => {
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
                const paramType = this.getEffectiveParameterType(index);
                const paramTypeString = recursionCount < MaxRecursionCount ?
                    paramType.asStringInternal(recursionCount + 1) : '';
                paramString += ': ' + paramTypeString;
            }
            return paramString;
        }).join(', ');

        let returnTypeString = 'Any';
        const returnType = this.getEffectiveReturnType();
        returnTypeString = recursionCount < MaxRecursionCount ?
            returnType.asStringInternal(recursionCount + 1) : '';

        return `(${ paramTypeString }) -> ${ returnTypeString }`;
    }

    requiresSpecialization(recursionCount = 0) {
        if (recursionCount > MaxRecursionCount) {
            return false;
        }

        for (let i = 0; i < this._functionDetails.parameters.length; i ++) {
            if (this.getEffectiveParameterType(i).requiresSpecialization(recursionCount + 1)) {
                return true;
            }
        }

        if (this.getEffectiveReturnType().requiresSpecialization(recursionCount + 1)) {
            return true;
        }

        return false;
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

    asStringInternal(recursionCount = 0): string {
        const overloads = this._overloads.map(overload =>
            overload.type.asStringInternal(recursionCount + 1));
        return `Overload[${ overloads.join(', ') }]`;
    }

    requiresSpecialization(recursionCount = 0) {
        return this._overloads.find(
            overload => overload.type.requiresSpecialization(recursionCount + 1)) !== undefined;
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

    hasSetter() {
        return this._setter !== undefined;
    }

    setSetter(setter: FunctionType) {
        this._setter = setter;
    }

    hasDeleter() {
        return this._deleter !== undefined;
    }

    setDeleter(deleter: FunctionType) {
        this._deleter = deleter;
    }

    getEffectiveReturnType() {
        return this._getter.getEffectiveReturnType();
    }

    asStringInternal(recursionCount = 0): string {
        const returnType = this._getter.getEffectiveReturnType();
        let returnTypeString = recursionCount < MaxRecursionCount ?
            returnType.asStringInternal(recursionCount + 1) : '';
        return returnTypeString;
    }

    requiresSpecialization(recursionCount = 0) {
        if (this._getter.requiresSpecialization(recursionCount + 1)) {
            return true;
        }

        if (this._setter && this._setter.requiresSpecialization(recursionCount + 1)) {
            return true;
        }

        if (this._deleter && this._deleter.requiresSpecialization(recursionCount + 1)) {
            return true;
        }

        return false;
    }
}

export class NoneType extends Type {
    category = TypeCategory.None;

    private static _noneInstance = new NoneType();
    static create() {
        // Use a single instance to reduce memory allocation.
        return this._noneInstance;
    }

    asStringInternal(recursionCount = 0): string {
        return 'None';
    }
}

export class NeverType extends NoneType {
    category = TypeCategory.Never;

    private static _neverInstance = new NeverType();
    static create() {
        // Use a single instance to reduce memory allocation.
        return this._neverInstance;
    }

    asStringInternal(recursionCount = 0): string {
        return 'Never';
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

    isAny(): boolean {
        return true;
    }

    isEllipsis(): boolean {
        return this._isEllipsis;
    }

    asStringInternal(): string {
        return this._isEllipsis ? '...' : 'Any';
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

    isAny(): boolean {
        return this._types.find(t => !t.isAny()) === undefined;
    }

    isPossiblyUnbound(): boolean {
        return this._types.find(t => t.isPossiblyUnbound()) !== undefined;
    }

    addType(type1: Type) {
        assert(type1.category !== TypeCategory.Union);
        assert(type1.category !== TypeCategory.Never);

        this._types.push(type1);
    }

    addTypes(types: Type[]) {
        // Add any types that are unique to the union.
        for (let newType of types) {
            assert(newType.category !== TypeCategory.Union);
            assert(newType.category !== TypeCategory.Never);
            if (!this._types.find(t => t.isSame(newType))) {
                this._types.push(newType);
            }
        }
    }

    // Eliminates any "None" elements from the union.
    removeOptional(): Type {
        let simplifiedTypes = this._types.filter(t => t.category !== TypeCategory.None);
        if (simplifiedTypes.length === 1) {
            return simplifiedTypes[0];
        }
        let newUnion = new UnionType();
        newUnion.addTypes(simplifiedTypes);
        return newUnion;
    }

    // Eliminates any "Unbound" elements from the union.
    removeUnbound(): Type {
        let simplifiedTypes = this._types.filter(t => t.category !== TypeCategory.Unbound);
        if (simplifiedTypes.length === 1) {
            return simplifiedTypes[0];
        }
        let newUnion = new UnionType();
        newUnion.addTypes(simplifiedTypes);
        return newUnion;
    }

    // Eliminates any "Unknown" elements from the union.
    removeUnknown(): Type {
        let simplifiedTypes = this._types.filter(t => t.category !== TypeCategory.Unknown);
        if (simplifiedTypes.length === 1) {
            return simplifiedTypes[0];
        }
        let newUnion = new UnionType();
        newUnion.addTypes(simplifiedTypes);
        return newUnion;
    }

    isSame(type2: Type, recursionCount = 0): boolean {
        if (recursionCount > MaxRecursionCount) {
            return true;
        }

        if (!(type2 instanceof UnionType)) {
            return false;
        }

        if (this._types.length !== type2._types.length) {
            return false;
        }

        // The types do not have a particular order, so we need to
        // do the comparison in an order-independent manner.
        return this._types.find(t => !type2.containsType(t, recursionCount)) === undefined;
    }

    containsType(type: Type, recursionCount = 0): boolean {
        return this._types.find(t => t.isSame(type, recursionCount + 1)) !== undefined;
    }

    asStringInternal(recursionCount = 0): string {
        if (this._types.find(t => t.category === TypeCategory.None) !== undefined) {
            const optionalType = recursionCount < MaxRecursionCount ?
                this.removeOptional().asStringInternal(recursionCount + 1) : '';
            return 'Optional[' + optionalType + ']';
        }

        const unionTypeString = recursionCount < MaxRecursionCount ?
            this._types.map(t => t.asStringInternal(recursionCount + 1)).join(', ') : '';

        return 'Union[' + unionTypeString + ']';
    }

    requiresSpecialization(recursionCount = 0) {
        return this._types.find(
            type => type.requiresSpecialization(recursionCount + 1)) !== undefined;
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

    isSame(type2: Type, recursionCount = 0): boolean {
        if (recursionCount > MaxRecursionCount) {
            return true;
        }

        if (!super.isSame(type2, recursionCount + 1)) {
            return false;
        }

        const type2TypeVar = type2 as TypeVarType;

        if (this.getName() !== type2TypeVar.getName()) {
            return false;
        }

        if (this._boundType) {
            if (!type2TypeVar._boundType ||
                    !type2TypeVar._boundType.isSame(this._boundType, recursionCount + 1)) {

                return false;
            }
        } else {
            if (type2TypeVar._boundType) {
                return false;
            }
        }

        if (this._isContravariant !== type2TypeVar._isContravariant) {
            return false;
        }

        if (this._isCovariant !== type2TypeVar._isCovariant) {
            return false;
        }

        if (this._constraints.length !== type2TypeVar._constraints.length) {
            return false;
        }

        for (let i = 0; i < this._constraints.length; i++) {
            if (!this._constraints[i].isSame(type2TypeVar._constraints[i], recursionCount + 1)) {
                return false;
            }
        }

        return true;
    }

    asStringInternal(recursionCount = 0): string {
        // Print the name in a simplified form if it's embedded
        // inside another type string.
        if (recursionCount > 0) {
            return this._name;
        } else {
            let params: string[] = [`'${ this._name }'`];
            if (recursionCount < MaxRecursionCount) {
                for (let constraint of this._constraints) {
                    params.push(constraint.asStringInternal(recursionCount + 1));
                }
            }
            return 'TypeVar[' + params.join(', ') + ']';
        }
    }

    requiresSpecialization(recursionCount = 0) {
        return true;
    }
}
