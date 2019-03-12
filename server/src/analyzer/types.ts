/*
* types.ts
* Copyright (c) Microsoft Corporation. All rights reserved.
* Author: Eric Traut
*
* Representation of types used during type analysis within Python.
*/

import * as assert from 'assert';
import { ParameterCategory, ParseNode } from '../parser/parseNodes';
import { InferredType, TypeSourceId } from './inferredType';
import { SymbolTable } from './symbol';

export enum TypeCategory {
    // Name is not bound to a value of any type.
    Unbound,

    // Type exists but is not currenlty known by the
    // type analyzer (e.g. there is no available typings file).
    // Unknown types are treated the same as "Any" at analysis time.
    Unknown,

    // Type can be anything.
    Any,

    // Special "None" type defined in Python.
    None,

    // Immutable sequence of typed values.
    Tuple,

    // Callable type with typed intput parameters and return parameter.
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

const AsStringMaxRecursionCount = 4;

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

    isSame(type2: Type): boolean {
        return this.category === type2.category;
    }

    asString(): string {
        return this.asStringInternal(AsStringMaxRecursionCount);
    }

    abstract asStringInternal(recursionCount: number): string;
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

    asStringInternal(recursionCount = AsStringMaxRecursionCount): string {
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

    asStringInternal(recursionCount = AsStringMaxRecursionCount): string {
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

    asStringInternal(recursionCount = AsStringMaxRecursionCount): string {
        return 'Module';
    }
}

export enum ClassTypeFlags {
    None = 0x00,

    // The class has one or more decorators.
    HasDecorators = 0x01,

    // Class is defined in the "builtins" or "typings" file.
    BuiltInClass = 0x02,

    // CLass requires special-case handling because it
    // exhibits non-standard behavior or is not defined
    // formally as a class. Examples include 'Optional'
    // and 'Union'.
    SpecialBuiltIn = 0x04
}

// export class TypeReference extends Type {
//     // A generic type instantiation will have one or more type
//     // arguments and an associated target class type.
//     private _typeArguments: Type[] = [];
//     private _targetType?: ClassType;
// }

export interface BaseClass {
    isMetaclass: boolean;
    type: Type;
}

interface ClassDetails {
    classFlags: ClassTypeFlags;
    className: string;
    baseClasses: BaseClass[];
    classFields: SymbolTable;
    instanceFields: SymbolTable;
    typeParameters: TypeVarType[];
}

export class ClassType extends Type {
    category = TypeCategory.Class;

    private _classDetails: ClassDetails;

    // A generic class that has been completely or partially
    // specialized will have type arguments that correspond to
    // some or all of the type parameters. Unspecified type
    // parameters are undefined.
    private _typeArguments?: (Type | undefined)[];

    constructor(name: string, flags: ClassTypeFlags) {
        super();

        this._classDetails = {
            className: name,
            classFlags: flags,
            baseClasses: [],
            classFields: new SymbolTable(),
            instanceFields: new SymbolTable(),
            typeParameters: []
        };
    }

    isSpecialBuiltIn() {
        return !!(this._classDetails.classFlags & ClassTypeFlags.SpecialBuiltIn);
    }

    isBuiltIn() {
        return !!(this._classDetails.classFlags & ClassTypeFlags.BuiltInClass);
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

    getClassName() {
        return this._classDetails.className;
    }

    hasDecorators() {
        return !!(this._classDetails.classFlags & ClassTypeFlags.HasDecorators);
    }

    getBaseClasses(): BaseClass[] {
        return this._classDetails.baseClasses;
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

    getInstanceFields(): SymbolTable {
        return this._classDetails.instanceFields;
    }

    setInstanceFields(nameMap: SymbolTable) {
        this._classDetails.instanceFields = nameMap;
    }

    isSame(type2: Type): boolean {
        return super.isSame(type2) &&
            this._classDetails.className === (type2 as ClassType)._classDetails.className;
    }

    asStringInternal(recursionCount = AsStringMaxRecursionCount): string {
        return 'class ' + this._classDetails.className;
    }

    // Determines whether this is a subclass (derived class)
    // of the specified class.
    isDerivedFrom(type2: ClassType): boolean {
        if (type2 === this) {
            return true;
        }

        // Handle built-in types like 'dict' and 'list', which are all
        // subclasses of object even though they are not explicitly declared
        // that way.
        if (this.isBuiltIn() && type2._classDetails.className === 'object' && type2.isBuiltIn()) {
            return true;
        }

        for (let baseClass of this.getBaseClasses()) {
            if (baseClass.type instanceof ClassType) {
                if (baseClass.type.isDerivedFrom(type2)) {
                    return true;
                }
            } else if (baseClass.type.isAny()) {
                return true;
            }
        }

        return false;
    }
}

export class ObjectType extends Type {
    category = TypeCategory.Object;

    private _classType: ClassType;

    constructor(classType: ClassType) {
        super();

        assert(classType instanceof ClassType);
        this._classType = classType;
    }

    getClassType() {
        return this._classType;
    }

    isSame(type2: Type): boolean {
        return super.isSame(type2) &&
            this._classType.isSame((type2 as ObjectType)._classType);
    }

    asStringInternal(recursionCount = AsStringMaxRecursionCount): string {
        return this._classType.getClassName();
    }
}

export interface FunctionParameter {
    category: ParameterCategory;
    name?: string;
    hasDefault?: boolean;
    type: Type;
    node?: ParseNode;
}

export enum FunctionTypeFlags {
    None = 0,
    InstanceMethod = 1,
    ClassMethod = 2,
    StaticMethod = 4,
    HasCustomDecorators = 8
}

interface FunctionDetails {
    flags: FunctionTypeFlags;
    parameters: FunctionParameter[];
    declaredReturnType?: Type;
    inferredReturnType: InferredType;
    typeParameters: TypeVarType[];
}

export class FunctionType extends Type {
    category = TypeCategory.Function;

    private _functionDetails: FunctionDetails;

    // A generic function that has been completely or partially
    // specialized will have type arguments that correspond to
    // some or all of the type parameters. Unspecified type
    // parameters are undefined.
    private _typeArguments?: (Type | undefined)[];

    constructor(flags: FunctionTypeFlags) {
        super();
        this._functionDetails = {
            flags,
            parameters: [],
            inferredReturnType: new InferredType(),
            typeParameters: []
        };
    }

    isInstanceMethod(): boolean {
        return (this._functionDetails.flags & FunctionTypeFlags.InstanceMethod) !== 0;
    }

    isClassMethod(): boolean {
        return (this._functionDetails.flags & FunctionTypeFlags.ClassMethod) !== 0;
    }

    getParameters() {
        return this._functionDetails.parameters;
    }

    setParameters(params: FunctionParameter[]) {
        this._functionDetails.parameters = params;
    }

    addParameter(param: FunctionParameter) {
        this._functionDetails.parameters.push(param);
    }

    getDeclaredReturnType() {
        return this._functionDetails.declaredReturnType;
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
        if (this._functionDetails.declaredReturnType) {
            return this._functionDetails.declaredReturnType;
        }

        return this._functionDetails.inferredReturnType.getType();
    }

    hasCustomDecorators(): boolean {
        return (this._functionDetails.flags & FunctionTypeFlags.HasCustomDecorators) !== undefined;
    }

    clearHasCustomDecoratorsFlag() {
        this._functionDetails.flags &= ~FunctionTypeFlags.HasCustomDecorators;
    }

    asStringInternal(recursionCount = AsStringMaxRecursionCount): string {
        let paramTypeString = this._functionDetails.parameters.map(param => {
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
                const paramTypeString = recursionCount > 0 ?
                    param.type.asStringInternal(recursionCount - 1) : '';
                paramString += ': ' + paramTypeString;
            }
            return paramString;
        }).join(', ');

        let returnTypeString = 'Any';
        const returnType = this.getEffectiveReturnType();
        returnTypeString = recursionCount > 0 ?
            returnType.asStringInternal(recursionCount - 1) : '';

        return `(${ paramTypeString }) -> ${ returnTypeString }`;
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

    asStringInternal(recursionCount = AsStringMaxRecursionCount): string {
        const overloads = this._overloads.map(overload =>
            overload.type.asStringInternal(recursionCount));
        return `Overload[${ overloads.join(', ') }]`;
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

    asStringInternal(recursionCount = AsStringMaxRecursionCount): string {
        const returnType = this._getter.getEffectiveReturnType();
        let returnTypeString = recursionCount > 0 ?
            returnType.asStringInternal(recursionCount - 1) : '';
        return returnTypeString;
    }
}

export class NoneType extends Type {
    category = TypeCategory.None;

    private static _instance = new NoneType();
    static create() {
        // Use a single instance to reduce memory allocation.
        return this._instance;
    }

    asStringInternal(recursionCount = AsStringMaxRecursionCount): string {
        return 'None';
    }
}

export class AnyType extends Type {
    category = TypeCategory.Any;

    private static _instance = new AnyType();
    static create() {
        // Use a single instance to reduce memory allocation.
        return this._instance;
    }

    isAny(): boolean {
        return true;
    }

    asStringInternal(): string {
        return 'Any';
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

        this._types.push(type1);
    }

    addTypes(types: Type[]) {
        // Add any types that are unique to the union.
        for (let newType of types) {
            assert(newType.category !== TypeCategory.Union);
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

    isSame(type2: Type): boolean {
        if (!(type2 instanceof UnionType)) {
            return false;
        }

        if (this._types.length !== type2._types.length) {
            return false;
        }

        // The types do not have a particular order, so we need to
        // do the comparison in an order-indepdendent manner.
        return this._types.find(t => !type2.containsType(t)) === undefined;
    }

    containsType(type: Type): boolean {
        return this._types.find(t => t.isSame(type)) !== undefined;
    }

    asStringInternal(recursionCount = AsStringMaxRecursionCount): string {
        if (this._types.find(t => t.category === TypeCategory.None) !== undefined) {
            const optionalType = recursionCount > 0 ?
                this.removeOptional().asStringInternal(recursionCount - 1) : '';
            return 'Optional[' + optionalType + ']';
        }

        const unionTypeString = recursionCount > 0 ?
            this._types.map(t => t.asStringInternal(recursionCount - 1)).join(', ') : '';

        return 'Union[' + unionTypeString + ']';
    }
}

export class TupleType extends Type {
    category = TypeCategory.Tuple;

    private _tupleBaseClass: ClassType;
    private _entryTypes: Type[] = [];

    constructor(baseClass: ClassType) {
        super();
        this._tupleBaseClass = baseClass;
    }

    getBaseClass() {
        return this._tupleBaseClass;
    }

    getEntryTypes() {
        return this._entryTypes;
    }

    addEntryType(type: Type) {
        this._entryTypes.push(type);
    }

    isSame(type2: Type): boolean {
        if (!super.isSame(type2)) {
            return false;
        }

        const type2Tuple = type2 as TupleType;
        if (this._entryTypes.length !== type2Tuple._entryTypes.length) {
            return false;
        }

        return this._entryTypes.find((t, index) =>
            !type2Tuple._entryTypes[index].isSame(t)) === undefined;
    }

    asStringInternal(recursionCount = AsStringMaxRecursionCount): string {
        let tupleTypeString = recursionCount > 0 ?
            this._entryTypes.map(t => t.asStringInternal(recursionCount - 1)).join(', ') : '';
        return 'Tuple[' + tupleTypeString + ']';
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

    isSame(type2: Type): boolean {
        if (!super.isSame(type2) || this._constraints.length !== (type2 as TypeVarType)._constraints.length) {
            return false;
        }

        for (let i = 0; i < this._constraints.length; i++) {
            if (!this._constraints[i].isSame((type2 as TypeVarType)._constraints[i])) {
                return false;
            }
        }

        return true;
    }

    asStringInternal(recursionCount = AsStringMaxRecursionCount): string {
        let params: string[] = [this._name];
        if (recursionCount > 0) {
            for (let constraint of this._constraints) {
                params.push(constraint.asStringInternal(recursionCount - 1));
            }
        }
        return 'TypeVar[' + params.join(', ') + ']';
    }
}
