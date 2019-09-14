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

    protected constructor() {
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
}

export class UnknownType extends Type {
    category = TypeCategory.Unknown;

    private static _instance = new UnknownType();
    static create() {
        // Use a single instance to reduce memory allocation.
        return this._instance;
    }
}

export class ModuleType extends Type {
    category = TypeCategory.Module;
    private _fields: SymbolTable;
    private _docString?: string;

    // A partial module is one that is not fully initialized
    // but contains only the symbols that have been imported
    // in a multi-part import (e.g. import a.b.c).
    private _isPartialModule = false;

    constructor(symbolTable: SymbolTable, docString?: string) {
        super();

        this._fields = symbolTable;
        this._docString = docString;
    }

    getFields() {
        return this._fields;
    }

    getDocString() {
        return this._docString;
    }

    setIsPartialModule() {
        this._isPartialModule = true;
    }

    isPartialModule() {
        return this._isPartialModule;
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

    private _classDetails: ClassDetails;

    // A generic class that has been completely or partially
    // specialized will have type arguments that correspond to
    // some or all of the type parameters. Unspecified type
    // parameters are undefined.
    private _typeArguments?: Type[];

    private _skipAbstractClassTest = false;

    constructor(name: string, flags: ClassTypeFlags, typeSourceId: TypeSourceId, docString?: string) {
        super();

        this._classDetails = {
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
    }

    cloneForSpecialization(typeArguments: Type[], skipAbstractClassTest = false): ClassType {
        const newClassType = new ClassType(this._classDetails.name,
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

    setIsDataClass(skipInit: boolean) {
        this._classDetails.flags |= ClassTypeFlags.DataClass;
        if (skipInit) {
            this._classDetails.flags |= ClassTypeFlags.SkipSynthesizedInit;
        }
    }

    isDataClass() {
        return !!(this._classDetails.flags & ClassTypeFlags.DataClass);
    }

    isSkipSynthesizedInit() {
        return !!(this._classDetails.flags & ClassTypeFlags.SkipSynthesizedInit);
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

    getDocString() {
        return this._classDetails.docString;
    }

    getTypeSourceId() {
        return this._classDetails.typeSourceId;
    }

    addBaseClass(type: Type, isMetaclass: boolean) {
        this._classDetails.baseClasses.push({ isMetaclass, type });
    }

    updateBaseClassType(index: number, type: Type) {
        const didChange = !isTypeSame(type, this._classDetails.baseClasses[index].type);
        this._classDetails.baseClasses[index].type = type;
        return didChange;
    }

    getClassFields(): SymbolTable {
        return this._classDetails.classFields;
    }

    setClassFields(nameMap: SymbolTable) {
        this._classDetails.classFields = nameMap;
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
        if (!this.isSpecialBuiltIn()) {
            if (typeArgs.length < this.getTypeParameters().length) {
                while (typeArgs.length < this.getTypeParameters().length) {
                    // Fill in any remaining type parameters with Any.
                    typeArgs.push(AnyType.create());
                }
            }
        }

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
                if (!isTypeSame(params[i], this._classDetails.typeParameters[i])) {
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

    isAliasOf(type2: ClassType): boolean {
        return type2._classDetails.aliasClass !== undefined &&
            type2._classDetails.aliasClass._classDetails === this._classDetails;
    }

    // Determines whether this is a subclass (derived class)
    // of the specified class. If the caller passes an empty
    // array to inheritanceChain, it will be filled in by
    // the call to include the chain of inherited classes starting
    // with type2 and ending with this type.
    isDerivedFrom(type2: ClassType, inheritanceChain?: InheritanceChain): boolean {
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

        for (const baseClass of this.getBaseClasses()) {
            if (baseClass.type instanceof ClassType) {
                if (baseClass.type.isDerivedFrom(type2, inheritanceChain)) {
                    if (inheritanceChain) {
                        inheritanceChain.push(this);
                    }
                    return true;
                }
            } else if (isAnyOrUnknown(baseClass.type)) {
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

    // Some types can be further constrained to have
    // literal types (e.g. true or 'string' or 3).
    private _literalValue?: LiteralValue;

    constructor(classType: ClassType) {
        super();

        assert(classType instanceof ClassType);
        this._classType = classType;
    }

    cloneWithLiteral(value: LiteralValue): ObjectType {
        const newType = new ObjectType(this._classType);
        newType._literalValue = value;
        return newType;
    }

    getLiteralValue(): LiteralValue | undefined {
        return this._literalValue;
    }

    getClassType() {
        return this._classType;
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
        const typeArgs = type.getTypeArguments();
        if (typeArgs) {
            if (recursionCount > _maxRecursionCount) {
                return false;
            }

            return typeArgs.find(
                typeArg => requiresSpecialization(typeArg, recursionCount + 1)
            ) !== undefined;
        }

        if (type.getTypeParameters().length === 0) {
            return false;
        }

        return true;
    } else if (type instanceof ObjectType) {
        if (recursionCount > _maxRecursionCount) {
            return false;
        }

        return requiresSpecialization(type.getClassType(), recursionCount + 1);
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
        if (type1.getTypeSourceId() !== classType2.getTypeSourceId()) {
            return false;
        }

        // If neither of the classes have type arguments, they're the same.
        const type1TypeArgs = type1.getTypeArguments();
        const type2TypeArgs = classType2.getTypeArguments();
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

        if (type1.getLiteralValue() !== objType2.getLiteralValue()) {
            return false;
        }

        return isTypeSame(type1.getClassType(), objType2.getClassType(), recursionCount + 1);
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
    let objName = type.getClassName();

    // If there is a type arguments array, it's a specialized class.
    const typeArgs = type.getTypeArguments();

    if (typeArgs) {
        if (typeArgs.length > 0) {
            objName += '[' + typeArgs.map(typeArg => {
                return printType(typeArg, recursionCount + 1);
            }).join(', ') + ']';
        }
    } else {
        const typeParams = type.getTypeParameters();

        if (typeParams.length > 0) {
            objName += '[' + typeParams.map(typeArg => {
                return printType(typeArg, recursionCount + 1);
            }).join(', ') + ']';
        }
    }

    return objName;
}

export function printLiteralValue(type: ObjectType): string {
    const literalValue = type.getLiteralValue();
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
            if (objType.getLiteralValue() !== undefined) {
                return printLiteralValue(objType);
            }

            return printObjectTypeForClass(objType.getClassType(),
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

    if (srcType instanceof ObjectType && srcType.getLiteralValue() !== undefined) {
        // Strip the literal.
        srcType = new ObjectType(srcType.getClassType());
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
                if (type.getLiteralValue() === undefined) {
                    return;
                }
            }
        }
    }

    types.push(typeToAdd);
}
