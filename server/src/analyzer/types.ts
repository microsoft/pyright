/*
 * types.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Representation of types used during type analysis within Python.
 */

import { assert } from '../common/debug';
import { ParameterCategory } from '../parser/parseNodes';
import { FunctionDeclaration } from './declaration';
import { Symbol, SymbolTable } from './symbol';

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

export type Type =
    | UnboundType
    | UnknownType
    | AnyType
    | NoneType
    | NeverType
    | FunctionType
    | OverloadedFunctionType
    | ClassType
    | ObjectType
    | ModuleType
    | UnionType
    | TypeVarType;

export type LiteralValue = number | boolean | string;

export type TypeSourceId = number;
export const maxTypeRecursionCount = 16;

export type InheritanceChain = (ClassType | UnknownType)[];

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

    // A "loader" module includes symbols that were injected by
    // the module loader. We keep these separate so we don't
    // pollute the symbols exported by the module itself.
    loaderFields: SymbolTable;
}

export namespace ModuleType {
    export function create(symbolTable?: SymbolTable) {
        const newModuleType: ModuleType = {
            category: TypeCategory.Module,
            fields: symbolTable || new Map<string, Symbol>(),
            loaderFields: new Map<string, Symbol>()
        };
        return newModuleType;
    }

    export function getField(moduleType: ModuleType, name: string): Symbol | undefined {
        // Always look for the symbol in the module's fields before consulting
        // the loader fields. The loader runs before the module, so its values
        // will be overwritten by the module.
        let symbol = moduleType.fields.get(name);

        if (!symbol && moduleType.loaderFields) {
            symbol = moduleType.loaderFields.get(name);
        }
        return symbol;
    }
}

export interface DataClassEntry {
    name: string;
    hasDefault: boolean;
    type: Type;
}

export const enum ClassTypeFlags {
    None = 0,

    // Class is defined in the "builtins" or "typings" file.
    BuiltInClass = 1 << 0,

    // Class requires special-case handling because it
    // exhibits non-standard behavior or is not defined
    // formally as a class. Examples include 'Optional'
    // and 'Union'.
    SpecialBuiltIn = 1 << 1,

    // Introduced in Python 3.7 - class either derives directly
    // from NamedTuple or has a @dataclass class decorator.
    DataClass = 1 << 2,

    // Flags that control whether methods should be
    // synthesized for a dataclass class.
    SkipSynthesizedInit = 1 << 3,

    // Introduced in PEP 589, TypedDict classes provide a way
    // to specify type hints for dictionaries with different
    // value types and a limited set of static keys.
    TypedDictClass = 1 << 4,

    // Used in conjunction with TypedDictClass, indicates that
    // the dictionary values can be omitted.
    CanOmitDictValues = 1 << 5,

    // The class has a metaclass of EnumMet or derives from
    // a class that has this metaclass.
    EnumClass = 1 << 6,

    // The class derives from a class that has the ABCMeta
    // metaclass. Such classes are allowed to contain
    // @abstractmethod decorators.
    SupportsAbstractMethods = 1 << 7,

    // The class has at least one abstract method or derives
    // from a base class that is abstract without providing
    // non-abstract overrides for all abstract methods.
    HasAbstractMethods = 1 << 8,

    // Derives from property class and has the semantics of
    // a property (with optional setter, deleter).
    PropertyClass = 1 << 9,

    // The class is decorated with a "@final" decorator
    // indicating that it cannot be subclassed.
    Final = 1 << 10,

    // The class derives directly from "Protocol".
    ProtocolClass = 1 << 11
}

interface ClassDetails {
    name: string;
    flags: ClassTypeFlags;
    typeSourceId: TypeSourceId;
    baseClasses: Type[];
    mro: Type[];
    metaClass?: ClassType | UnknownType;
    aliasClass?: ClassType;
    fields: SymbolTable;
    typeParameters: TypeVarType[];
    docString?: string;
    dataClassEntries?: DataClassEntry[];
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
    export function create(name: string, flags: ClassTypeFlags, typeSourceId: TypeSourceId, docString?: string) {
        const newClass: ClassType = {
            category: TypeCategory.Class,
            details: {
                name,
                flags,
                typeSourceId,
                baseClasses: [],
                mro: [],
                fields: new Map<string, Symbol>(),
                typeParameters: [],
                docString
            },
            skipAbstractClassTest: false
        };

        return newClass;
    }

    export function cloneForSpecialization(
        classType: ClassType,
        typeArguments: Type[] | undefined,
        skipAbstractClassTest = false
    ): ClassType {
        const newClassType = create(classType.details.name, classType.details.flags, classType.details.typeSourceId);
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
        return classType.details.typeParameters.length > 0 && classType.typeArguments === undefined;
    }

    export function isSpecialBuiltIn(classType: ClassType, className?: string) {
        if (!(classType.details.flags & ClassTypeFlags.SpecialBuiltIn)) {
            return false;
        }

        if (className !== undefined) {
            return classType.details.name === className;
        }

        return true;
    }

    export function isBuiltIn(classType: ClassType, className?: string) {
        if (!(classType.details.flags & ClassTypeFlags.BuiltInClass)) {
            return false;
        }

        if (className !== undefined) {
            return classType.details.name === className;
        }

        return true;
    }

    export function hasAbstractMethods(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.HasAbstractMethods) && !classType.skipAbstractClassTest;
    }

    export function supportsAbstractMethods(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.SupportsAbstractMethods);
    }

    export function isDataClass(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.DataClass);
    }

    export function isSkipSynthesizedInit(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.SkipSynthesizedInit);
    }

    export function isTypedDictClass(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.TypedDictClass);
    }

    export function isCanOmitDictValues(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.CanOmitDictValues);
    }

    export function isEnumClass(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.EnumClass);
    }

    export function isPropertyClass(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.PropertyClass);
    }

    export function isFinal(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.Final);
    }

    export function isProtocolClass(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.ProtocolClass);
    }

    export function getDataClassEntries(classType: ClassType): DataClassEntry[] {
        return classType.details.dataClassEntries || [];
    }

    export function getTypeParameters(classType: ClassType) {
        // If this is a special class, use the alias class' type
        // parameters instead.
        if (classType.details.aliasClass) {
            return classType.details.aliasClass.details.typeParameters;
        }
        return classType.details.typeParameters;
    }

    // Same as isSame except that it doesn't compare type arguments.
    export function isSameGenericClass(
        classType: ClassType,
        type2: ClassType,
        treatAliasAsSame = true,
        recursionCount = 0
    ) {
        if (recursionCount > maxTypeRecursionCount) {
            return true;
        }

        // If the class details match, it's definitely the same class.
        if (classType.details === type2.details) {
            return true;
        }

        // If either or both have aliases (e.g. List -> list), use the
        // aliases for comparison purposes.
        const class1Details =
            treatAliasAsSame && classType.details.aliasClass ? classType.details.aliasClass.details : classType.details;
        const class2Details =
            treatAliasAsSame && type2.details.aliasClass ? type2.details.aliasClass.details : type2.details;

        if (class1Details === class2Details) {
            return true;
        }

        // Compare most of the details fields. We intentionally skip the isAbstractClass
        // flag because it gets set dynamically.
        if (
            class1Details.name !== class2Details.name ||
            class1Details.flags !== class2Details.flags ||
            class1Details.typeSourceId !== class2Details.typeSourceId ||
            class1Details.baseClasses.length !== class2Details.baseClasses.length ||
            class1Details.typeParameters.length !== class2Details.typeParameters.length
        ) {
            return false;
        }

        for (let i = 0; i < class1Details.baseClasses.length; i++) {
            if (!isTypeSame(class1Details.baseClasses[i], class2Details.baseClasses[i], recursionCount + 1)) {
                return false;
            }
        }

        if (class1Details.metaClass || class2Details.metaClass) {
            if (
                !class1Details.metaClass ||
                !class2Details.metaClass ||
                !isTypeSame(class1Details.metaClass, class2Details.metaClass)
            ) {
                return false;
            }
        }

        for (let i = 0; i < class1Details.typeParameters.length; i++) {
            if (!isTypeSame(class1Details.typeParameters[i], class2Details.typeParameters[i], recursionCount + 1)) {
                return false;
            }
        }

        const dataClassEntries1 = class1Details.dataClassEntries || [];
        const dataClassEntries2 = class2Details.dataClassEntries || [];
        if (dataClassEntries1.length !== dataClassEntries2.length) {
            return false;
        }

        for (let i = 0; i < dataClassEntries1.length; i++) {
            if (
                dataClassEntries1[i].name !== dataClassEntries2[i].name ||
                dataClassEntries1[i].hasDefault !== dataClassEntries2[i].hasDefault ||
                !isTypeSame(dataClassEntries1[i].type, dataClassEntries2[i].type, recursionCount + 1)
            ) {
                return false;
            }
        }

        // If the two types don't have the same symbol table, they are probably
        // using synthesized (undeclared) symbols. Make sure that they contain the
        // same number of symbols and types.
        if (class1Details.fields !== class2Details.fields) {
            if (class1Details.fields.size !== class2Details.fields.size) {
                return false;
            }

            let symbolsMatch = true;
            class1Details.fields.forEach((symbol1, name) => {
                const symbol2 = class2Details.fields.get(name);
                if (!symbol2) {
                    symbolsMatch = false;
                } else {
                    const symbol1Type = symbol1.getSynthesizedType() || UnknownType.create();
                    const symbol2Type = symbol2.getSynthesizedType() || UnknownType.create();
                    if (!isTypeSame(symbol1Type, symbol2Type, recursionCount + 1)) {
                        symbolsMatch = false;
                    }
                }
            });

            if (!symbolsMatch) {
                return false;
            }
        }

        return true;
    }

    // Determines whether this is a subclass (derived class)
    // of the specified class. If the caller passes an empty
    // array to inheritanceChain, it will be filled in by
    // the call to include the chain of inherited classes starting
    // with type2 and ending with this type.
    export function isDerivedFrom(
        subclassType: ClassType,
        parentClassType: ClassType,
        inheritanceChain?: InheritanceChain
    ): boolean {
        // Is it the exact same class?
        if (isSameGenericClass(subclassType, parentClassType)) {
            if (inheritanceChain) {
                inheritanceChain.push(subclassType);
            }
            return true;
        }

        // Handle built-in types like 'dict' and 'list', which are all
        // subclasses of object even though they are not explicitly declared
        // that way.
        if (isBuiltIn(subclassType) && isBuiltIn(parentClassType, 'object')) {
            if (inheritanceChain) {
                inheritanceChain.push(parentClassType);
            }
            return true;
        }

        const aliasedSubclass = subclassType.details.aliasClass || subclassType;
        for (const baseClass of aliasedSubclass.details.baseClasses) {
            if (baseClass.category === TypeCategory.Class) {
                if (isDerivedFrom(baseClass, parentClassType, inheritanceChain)) {
                    if (inheritanceChain) {
                        inheritanceChain.push(subclassType);
                    }
                    return true;
                }
            } else if (isAnyOrUnknown(baseClass)) {
                if (inheritanceChain) {
                    inheritanceChain.push(UnknownType.create());
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
    isNameSynthesized?: boolean;
    hasDefault?: boolean;
    type: Type;
}

export const enum FunctionTypeFlags {
    None = 0,

    // Function is a __new__ method; first parameter is "cls"
    ConstructorMethod = 1 << 0,

    // Function is decorated with @classmethod; first parameter is "cls";
    // can be bound to associated class
    ClassMethod = 1 << 1,

    // Function is decorated with @staticmethod; cannot be bound to class
    StaticMethod = 1 << 2,

    // Function is decorated with @abstractmethod
    AbstractMethod = 1 << 3,

    // Function contains "yield" or "yield from" statements
    Generator = 1 << 4,

    // Skip check that validates that all parameters without default
    // value expressions have corresponding arguments; used for
    // named tuples in some cases
    DisableDefaultChecks = 1 << 5,

    // Method has no declaration in user code, it's synthesized; used
    // for implied methods such as those used in namedtuple, dataclass, etc.
    SynthesizedMethod = 1 << 6,

    // For some synthesized classes (in particular, NamedTuple), the
    // __init__ method is created with default parameters, so we will
    // skip the constructor check for these methods.
    SkipConstructorCheck = 1 << 7,

    // Function is decorated with @overload
    Overloaded = 1 << 8,

    // Function is declared with async keyword
    Async = 1 << 9,

    // Indicates that return type should be wrapped in an awaitable type
    WrapReturnTypeInAwait = 1 << 10,

    // Function is declared within a type stub fille
    StubDefinition = 1 << 11,

    // Function is decorated with @final
    Final = 1 << 12,

    // Function has one or more parameters that are missing type annotations
    UnannotatedParams = 1 << 13
}

interface FunctionDetails {
    flags: FunctionTypeFlags;
    parameters: FunctionParameter[];
    declaredReturnType?: Type;
    declaration?: FunctionDeclaration;
    builtInName?: string;
    docString?: string;
}

export interface SpecializedFunctionTypes {
    parameterTypes: Type[];
    returnType?: Type;
}

export interface FunctionType extends TypeBase {
    category: TypeCategory.Function;

    details: FunctionDetails;

    // This flag is set when the first parameter is stripped
    // (see "clone" method below).
    ignoreFirstParamOfDeclaration?: boolean;

    // A function type can be specialized (i.e. generic type
    // variables replaced by a concrete type).
    specializedTypes?: SpecializedFunctionTypes;

    // Filled in lazily
    inferredReturnType?: Type;
}

export namespace FunctionType {
    export function create(flags: FunctionTypeFlags, docString?: string) {
        const newFunctionType: FunctionType = {
            category: TypeCategory.Function,
            details: {
                flags,
                parameters: [],
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
            declaration: type.details.declaration,
            builtInName: type.details.builtInName,
            docString: type.details.docString
        };

        // If we strip off the first parameter, this is no longer an
        // instance method or class method.
        if (deleteFirstParam) {
            newFunction.details.flags &= ~(FunctionTypeFlags.ConstructorMethod | FunctionTypeFlags.ClassMethod);
            newFunction.details.flags |= FunctionTypeFlags.StaticMethod;
            newFunction.ignoreFirstParamOfDeclaration = true;
        }

        if (type.specializedTypes) {
            newFunction.specializedTypes = {
                parameterTypes: type.specializedTypes.parameterTypes.slice(startParam),
                returnType: type.specializedTypes.returnType
            };
        }

        newFunction.inferredReturnType = type.inferredReturnType;

        return newFunction;
    }

    // Creates a shallow copy of the function type with new
    // specialized types. The clone shares the _functionDetails
    // with the object being cloned.
    export function cloneForSpecialization(
        type: FunctionType,
        specializedTypes: SpecializedFunctionTypes
    ): FunctionType {
        const newFunction = create(type.details.flags, type.details.docString);
        newFunction.details = type.details;

        assert(specializedTypes.parameterTypes.length === type.details.parameters.length);
        newFunction.specializedTypes = specializedTypes;

        return newFunction;
    }

    export function isInstanceMethod(type: FunctionType): boolean {
        return (
            (type.details.flags &
                (FunctionTypeFlags.ConstructorMethod |
                    FunctionTypeFlags.StaticMethod |
                    FunctionTypeFlags.ClassMethod)) ===
            0
        );
    }

    export function isConstructorMethod(type: FunctionType): boolean {
        return (type.details.flags & FunctionTypeFlags.ConstructorMethod) !== 0;
    }

    export function isStaticMethod(type: FunctionType): boolean {
        return (type.details.flags & FunctionTypeFlags.StaticMethod) !== 0;
    }

    export function isClassMethod(type: FunctionType): boolean {
        return (type.details.flags & FunctionTypeFlags.ClassMethod) !== 0;
    }

    export function isAbstractMethod(type: FunctionType): boolean {
        return (type.details.flags & FunctionTypeFlags.AbstractMethod) !== 0;
    }

    export function isGenerator(type: FunctionType): boolean {
        return (type.details.flags & FunctionTypeFlags.Generator) !== 0;
    }

    export function isSynthesizedMethod(type: FunctionType): boolean {
        return (type.details.flags & FunctionTypeFlags.SynthesizedMethod) !== 0;
    }

    export function isSkipConstructorCheck(type: FunctionType): boolean {
        return (type.details.flags & FunctionTypeFlags.SkipConstructorCheck) !== 0;
    }

    export function isOverloaded(type: FunctionType): boolean {
        return (type.details.flags & FunctionTypeFlags.Overloaded) !== 0;
    }

    export function isDefaultParameterCheckDisabled(type: FunctionType) {
        return (type.details.flags & FunctionTypeFlags.DisableDefaultChecks) !== 0;
    }

    export function isAsync(type: FunctionType) {
        return (type.details.flags & FunctionTypeFlags.Async) !== 0;
    }

    export function isWrapReturnTypeInAwait(type: FunctionType) {
        return (type.details.flags & FunctionTypeFlags.WrapReturnTypeInAwait) !== 0;
    }

    export function isStubDefinition(type: FunctionType) {
        return (type.details.flags & FunctionTypeFlags.StubDefinition) !== 0;
    }

    export function isFinal(type: FunctionType) {
        return (type.details.flags & FunctionTypeFlags.Final) !== 0;
    }

    export function hasUnannotatedParams(type: FunctionType) {
        return (type.details.flags & FunctionTypeFlags.UnannotatedParams) !== 0;
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

    export function getSpecializedReturnType(type: FunctionType) {
        return type.specializedTypes && type.specializedTypes.returnType
            ? type.specializedTypes.returnType
            : type.details.declaredReturnType;
    }
}

export interface OverloadedFunctionType extends TypeBase {
    category: TypeCategory.OverloadedFunction;
    overloads: FunctionType[];
}

export namespace OverloadedFunctionType {
    export function create() {
        const newType: OverloadedFunctionType = {
            category: TypeCategory.OverloadedFunction,
            overloads: []
        };
        return newType;
    }

    export function addOverload(type: OverloadedFunctionType, functionType: FunctionType) {
        type.overloads.push(functionType);
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
    return type.category === TypeCategory.None || type.category === TypeCategory.Never;
}

export function isAnyOrUnknown(type: Type): boolean {
    if (type.category === TypeCategory.Any || type.category === TypeCategory.Unknown) {
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

export function isTypeSame(type1: Type, type2: Type, recursionCount = 0): boolean {
    if (type1.category !== type2.category) {
        return false;
    }

    if (recursionCount > maxTypeRecursionCount) {
        return true;
    }

    switch (type1.category) {
        case TypeCategory.Class: {
            const classType2 = type2 as ClassType;

            // If the details are not the same it's not the same class.
            if (!ClassType.isSameGenericClass(type1, classType2, true, recursionCount + 1)) {
                return false;
            }

            // Make sure the type args match.
            const type1TypeArgs = type1.typeArguments || [];
            const type2TypeArgs = classType2.typeArguments || [];
            const typeArgCount = Math.max(type1TypeArgs.length, type2TypeArgs.length);

            for (let i = 0; i < typeArgCount; i++) {
                // Assume that missing type args are "Any".
                const typeArg1 = i < type1TypeArgs.length ? type1TypeArgs[i] : AnyType.create();
                const typeArg2 = i < type2TypeArgs.length ? type2TypeArgs[i] : AnyType.create();

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
            const params1 = type1.details.parameters;
            const params2 = functionType2.details.parameters;

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
            let return1Type = type1.details.declaredReturnType;
            if (type1.specializedTypes && type1.specializedTypes.returnType) {
                return1Type = type1.specializedTypes.returnType;
            }
            let return2Type = functionType2.details.declaredReturnType;
            if (functionType2.specializedTypes && functionType2.specializedTypes.returnType) {
                return2Type = functionType2.specializedTypes.returnType;
            }
            if (return1Type || return2Type) {
                if (!return1Type || !return2Type || !isTypeSame(return1Type, return2Type, recursionCount + 1)) {
                    return false;
                }
            }

            if (type1.details.declaration !== functionType2.details.declaration) {
                return false;
            }

            return true;
        }

        case TypeCategory.OverloadedFunction: {
            // Make sure the overload counts match.
            const functionType2 = type2 as OverloadedFunctionType;
            if (type1.overloads.length !== functionType2.overloads.length) {
                return false;
            }

            // We assume here that overloaded functions always appear
            // in the same order from one analysis pass to another.
            for (let i = 0; i < type1.overloads.length; i++) {
                if (!isTypeSame(type1.overloads[i], functionType2.overloads[i])) {
                    return false;
                }
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

        case TypeCategory.Module: {
            const type2Module = type2 as ModuleType;

            // Module types are the same if they share the same
            // module symbol table.
            if (type1.fields === type2Module.fields) {
                return true;
            }

            // If both symbol tables are empty, we can also assume
            // they're equal.
            if (type1.fields.size === 0 && type2Module.fields.size === 0) {
                return true;
            }

            return false;
        }
    }

    return true;
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
    for (let i = 0; i < types.length; i++) {
        const type = types[i];

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

            // If we're adding Literal[False] or Literal[True] to its
            // opposite, combine them into a non-literal 'bool' type.
            if (ClassType.isBuiltIn(type.classType, 'bool')) {
                if (typeToAdd.literalValue !== undefined && !typeToAdd.literalValue === type.literalValue) {
                    types[i] = ObjectType.create(type.classType);
                    return;
                }
            }
        }
    }

    types.push(typeToAdd);
}
