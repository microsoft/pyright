/*
 * types.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Representation of types used during type analysis within Python.
 */

import { assert } from '../common/debug';
import { ExpressionNode, ParameterCategory } from '../parser/parseNodes';
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
    TypeVar,
}

export const enum TypeFlags {
    None = 0,

    // This type refers to something that can be instantiated.
    Instantiable = 1 << 0,

    // This type refers to something that has been instantiated.
    Instance = 1 << 1,
}

export type UnionableType =
    | UnboundType
    | UnknownType
    | AnyType
    | NoneType
    | FunctionType
    | OverloadedFunctionType
    | ClassType
    | ObjectType
    | ModuleType
    | TypeVarType;

export type Type = UnionableType | NeverType | UnionType;

export type TypeVarScopeId = string;

export class EnumLiteral {
    constructor(public className: string, public itemName: string) {}
}

export type LiteralValue = number | boolean | string | EnumLiteral;

export type TypeSourceId = number;
export const maxTypeRecursionCount = 16;

export type InheritanceChain = (ClassType | UnknownType)[];

interface TypeAliasInfo {
    aliasName: string;
    typeParameters?: TypeVarType[];
    typeArguments?: Type[];
    typeVarScopeId: TypeVarScopeId;
}

interface TypeBase {
    category: TypeCategory;
    flags: TypeFlags;
    typeAliasInfo?: TypeAliasInfo;
}

export namespace TypeBase {
    export function isInstantiable(type: TypeBase) {
        return (type.flags & TypeFlags.Instantiable) !== 0;
    }

    export function isInstance(type: TypeBase) {
        return (type.flags & TypeFlags.Instance) !== 0;
    }

    export function cloneForTypeAlias(
        type: Type,
        name: string,
        typeVarScopeId: TypeVarScopeId,
        typeParams?: TypeVarType[],
        typeArgs?: Type[]
    ): Type {
        const typeClone = { ...type };

        typeClone.typeAliasInfo = {
            aliasName: name,
            typeParameters: typeParams,
            typeArguments: typeArgs,
            typeVarScopeId,
        };

        return typeClone;
    }
}

export interface UnboundType extends TypeBase {
    category: TypeCategory.Unbound;
}

export namespace UnboundType {
    const _instance: UnboundType = {
        category: TypeCategory.Unbound,
        flags: TypeFlags.Instantiable | TypeFlags.Instance,
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
        category: TypeCategory.Unknown,
        flags: TypeFlags.Instantiable | TypeFlags.Instance,
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

    // The period-delimited import name of this module.
    moduleName: string;
}

export namespace ModuleType {
    export function create(moduleName: string, symbolTable?: SymbolTable) {
        const newModuleType: ModuleType = {
            category: TypeCategory.Module,
            fields: symbolTable || new Map<string, Symbol>(),
            loaderFields: new Map<string, Symbol>(),
            flags: TypeFlags.Instantiable | TypeFlags.Instantiable,
            moduleName,
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
    hasDefault?: boolean;
    defaultValueExpression?: ExpressionNode;
    includeInInit: boolean;
    type: Type;
}

export interface TypedDictEntry {
    valueType: Type;
    isRequired: boolean;
    isProvided: boolean;
}

export const enum ClassTypeFlags {
    None = 0,

    // Class is defined in the "builtins" or "typing" file.
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
    SkipSynthesizedDataclassInit = 1 << 3,
    SkipSynthesizedDataclassEq = 1 << 4,
    SynthesizedDataclassOrder = 1 << 5,

    // Introduced in PEP 589, TypedDict classes provide a way
    // to specify type hints for dictionaries with different
    // value types and a limited set of static keys.
    TypedDictClass = 1 << 6,

    // Used in conjunction with TypedDictClass, indicates that
    // the dictionary values can be omitted.
    CanOmitDictValues = 1 << 7,

    // The class has a metaclass of EnumMet or derives from
    // a class that has this metaclass.
    EnumClass = 1 << 8,

    // The class derives from a class that has the ABCMeta
    // metaclass. Such classes are allowed to contain
    // @abstractmethod decorators.
    SupportsAbstractMethods = 1 << 9,

    // The class has at least one abstract method or derives
    // from a base class that is abstract without providing
    // non-abstract overrides for all abstract methods.
    HasAbstractMethods = 1 << 10,

    // Derives from property class and has the semantics of
    // a property (with optional setter, deleter).
    PropertyClass = 1 << 11,

    // The class is decorated with a "@final" decorator
    // indicating that it cannot be subclassed.
    Final = 1 << 12,

    // The class derives directly from "Protocol".
    ProtocolClass = 1 << 13,

    // A class whose constructor (__init__ method) does not have
    // annotated types and is treated as though each parameter
    // is a generic type for purposes of type inference.
    PseudoGenericClass = 1 << 14,

    // A protocol class that is "runtime checkable" can be used
    // in an isinstance call.
    RuntimeCheckable = 1 << 15,

    // The type is defined in the typing_extensions.pyi file.
    TypingExtensionClass = 1 << 16,

    // The class type is in the process of being constructed and
    // is not yet complete. This allows us to detect cases where
    // the class refers to itself (e.g. uses itself as a type
    // argument to one of its generic base classes).
    PartiallyConstructed = 1 << 17,

    // The class or one of its ancestors defines a __class_getitem__
    // method that is used for subscripting. This is not set if the
    // class is generic, and therefore supports standard subscripting
    // semantics.
    HasCustomClassGetItem = 1 << 18,

    // This class uses a variadic type arguments, so the number of
    // arguments is variable. Currently, the only class that supports
    // this is tuple.
    VariadicTypeParameter = 1 << 19,
}

interface ClassDetails {
    name: string;
    fullName: string;
    moduleName: string;
    flags: ClassTypeFlags;
    typeSourceId: TypeSourceId;
    baseClasses: Type[];
    mro: Type[];
    declaredMetaclass?: ClassType | UnknownType;
    effectiveMetaclass?: ClassType | UnknownType;
    fields: SymbolTable;
    typeParameters: TypeVarType[];
    typeVarScopeId?: TypeVarScopeId;
    docString?: string;
    dataClassEntries?: DataClassEntry[];
    typedDictEntries?: Map<string, TypedDictEntry>;
}

export interface ClassType extends TypeBase {
    category: TypeCategory.Class;

    details: ClassDetails;

    // A generic class that has been completely or partially
    // specialized will have type arguments that correspond to
    // some or all of the type parameters.
    typeArguments?: Type[];

    // For a few classes (e.g., tuple), the class definition calls for a single
    // type parameter but the spec allows the programmer to provide variadic
    // type arguments. To make these compatible, we need to derive a single
    // typeArgument value based on the variadic arguments.
    variadicTypeArguments?: Type[];

    // If type arguments are present, were they explicit (i.e.
    // provided explicitly in the code)?
    isTypeArgumentExplicit?: boolean;

    skipAbstractClassTest: boolean;

    // Some types can be further constrained to have
    // literal types (e.g. true or 'string' or 3).
    literalValue?: LiteralValue;

    // The typing module defines aliases for builtin types
    // (e.g. Tuple, List, Dict). This field holds the alias
    // name.
    aliasName?: string;
}

export namespace ClassType {
    export function create(
        name: string,
        fullName: string,
        moduleName: string,
        flags: ClassTypeFlags,
        typeSourceId: TypeSourceId,
        declaredMetaclass: ClassType | UnknownType | undefined,
        effectiveMetaclass: ClassType | UnknownType | undefined,
        docString?: string
    ) {
        const newClass: ClassType = {
            category: TypeCategory.Class,
            details: {
                name,
                fullName,
                moduleName,
                flags,
                typeSourceId,
                baseClasses: [],
                declaredMetaclass,
                effectiveMetaclass,
                mro: [],
                fields: new Map<string, Symbol>(),
                typeParameters: [],
                docString,
            },
            skipAbstractClassTest: false,
            flags: TypeFlags.Instantiable,
        };

        return newClass;
    }

    export function cloneForSpecialization(
        classType: ClassType,
        typeArguments: Type[] | undefined,
        isTypeArgumentExplicit: boolean,
        skipAbstractClassTest = false,
        variadicTypeArguments?: Type[]
    ): ClassType {
        const newClassType = { ...classType };

        // Never should never appear as a type argument, so replace it with
        newClassType.typeArguments = typeArguments
            ? typeArguments.map((t) => (isNever(t) ? UnknownType.create() : t))
            : undefined;

        newClassType.isTypeArgumentExplicit = isTypeArgumentExplicit;
        newClassType.skipAbstractClassTest = skipAbstractClassTest;
        newClassType.variadicTypeArguments = variadicTypeArguments
            ? variadicTypeArguments.map((t) => (isNever(t) ? UnknownType.create() : t))
            : undefined;

        return newClassType;
    }

    export function cloneWithLiteral(classType: ClassType, value: LiteralValue | undefined): ClassType {
        const newClassType = { ...classType };
        newClassType.literalValue = value;
        return newClassType;
    }

    export function cloneForTypingAlias(classType: ClassType, aliasName: string): ClassType {
        const newClassType = { ...classType };
        newClassType.aliasName = aliasName;
        return newClassType;
    }

    export function isLiteralValueSame(type1: ClassType, type2: ClassType) {
        if (type1.literalValue === undefined) {
            return type2.literalValue === undefined;
        } else if (type2.literalValue === undefined) {
            return false;
        }

        if (type1.literalValue instanceof EnumLiteral) {
            if (type2.literalValue instanceof EnumLiteral) {
                return type1.literalValue.itemName === type2.literalValue.itemName;
            }
            return false;
        }

        return type1.literalValue === type2.literalValue;
    }

    // Specifies whether the class type is generic (unspecialized)
    // or specialized.
    export function isGeneric(classType: ClassType) {
        return classType.details.typeParameters.length > 0 && classType.typeArguments === undefined;
    }

    export function isSpecialBuiltIn(classType: ClassType, className?: string) {
        if (!(classType.details.flags & ClassTypeFlags.SpecialBuiltIn) && !classType.aliasName) {
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
            return classType.details.name === className || classType.aliasName === className;
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

    export function isSkipSynthesizedDataclassInit(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.SkipSynthesizedDataclassInit);
    }

    export function isSkipSynthesizedDataclassEq(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.SkipSynthesizedDataclassEq);
    }

    export function isSynthesizedDataclassOrder(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.SynthesizedDataclassOrder);
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

    export function isPseudoGenericClass(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.PseudoGenericClass);
    }

    export function getDataClassEntries(classType: ClassType): DataClassEntry[] {
        return classType.details.dataClassEntries || [];
    }

    export function isRuntimeCheckable(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.RuntimeCheckable);
    }

    export function isTypingExtensionClass(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.TypingExtensionClass);
    }

    export function isPartiallyConstructed(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.PartiallyConstructed);
    }

    export function hasCustomClassGetItem(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.HasCustomClassGetItem);
    }

    export function isVariadicTypeParam(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.VariadicTypeParameter);
    }

    export function getTypeParameters(classType: ClassType) {
        return classType.details.typeParameters;
    }

    export function hasUnknownBaseClass(classType: ClassType) {
        return classType.details.mro.some((baseClass) => isAnyOrUnknown(baseClass));
    }

    // Same as isSame except that it doesn't compare type arguments.
    export function isSameGenericClass(classType: ClassType, type2: ClassType, recursionCount = 0) {
        if (recursionCount > maxTypeRecursionCount) {
            return true;
        }

        // If the class details match, it's definitely the same class.
        if (classType.details === type2.details) {
            return true;
        }

        // If either or both have aliases (e.g. List -> list), use the
        // aliases for comparison purposes.
        const class1Details = classType.details;
        const class2Details = type2.details;

        if (class1Details === class2Details) {
            return true;
        }

        // Compare most of the details fields. We intentionally skip the isAbstractClass
        // flag because it gets set dynamically.
        if (
            class1Details.fullName !== class2Details.fullName ||
            class1Details.flags !== class2Details.flags ||
            class1Details.typeSourceId !== class2Details.typeSourceId ||
            class1Details.baseClasses.length !== class2Details.baseClasses.length ||
            class1Details.typeParameters.length !== class2Details.typeParameters.length
        ) {
            return false;
        }

        // Special-case NamedTuple and Tuple classes because we rewrite the base classes
        // in these cases.
        if (ClassType.isBuiltIn(classType, 'NamedTuple') && ClassType.isBuiltIn(type2, 'NamedTuple')) {
            return true;
        }
        if (ClassType.isBuiltIn(classType, 'tuple') && ClassType.isBuiltIn(type2, 'tuple')) {
            return true;
        }

        // Make sure the base classes match.
        for (let i = 0; i < class1Details.baseClasses.length; i++) {
            if (!isTypeSame(class1Details.baseClasses[i], class2Details.baseClasses[i], recursionCount + 1)) {
                return false;
            }
        }

        if (class1Details.declaredMetaclass || class2Details.declaredMetaclass) {
            if (
                !class1Details.declaredMetaclass ||
                !class2Details.declaredMetaclass ||
                !isTypeSame(class1Details.declaredMetaclass, class2Details.declaredMetaclass)
            ) {
                return false;
            }
        }

        for (let i = 0; i < class1Details.typeParameters.length; i++) {
            if (!isTypeSame(class1Details.typeParameters[i], class2Details.typeParameters[i], recursionCount + 1)) {
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

        for (const baseClass of subclassType.details.baseClasses) {
            if (isClass(baseClass)) {
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
}

export namespace ObjectType {
    export function create(classType: ClassType) {
        const newObjectType: ObjectType = {
            category: TypeCategory.Object,
            classType,
            flags: TypeFlags.Instance,
        };
        return newObjectType;
    }
}

export interface FunctionParameter {
    category: ParameterCategory;
    name?: string;
    isNameSynthesized?: boolean;
    isTypeInferred?: boolean;
    hasDefault?: boolean;
    defaultValueExpression?: ExpressionNode;
    defaultType?: Type;
    hasDeclaredType?: boolean;
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

    // Function is declared within a module that claims to be fully typed
    // (i.e. a "py.typed" file is present).
    PyTypedDefinition = 1 << 12,

    // Function is decorated with @final
    Final = 1 << 13,

    // Function has one or more parameters that are missing type annotations
    UnannotatedParams = 1 << 14,

    // Any collection of parameters will match this function. This is used
    // for Callable[..., x].
    SkipParamCompatibilityCheck = 1 << 15,
}

interface FunctionDetails {
    name: string;
    moduleName: string;
    flags: FunctionTypeFlags;
    parameters: FunctionParameter[];
    declaredReturnType?: Type;
    declaration?: FunctionDeclaration;
    typeVarScopeId?: TypeVarScopeId;
    builtInName?: string;
    docString?: string;

    // Parameter specification used only for Callable types created
    // with a ParamSpec representing the parameters.
    paramSpec?: TypeVarType;
}

export interface SpecializedFunctionTypes {
    parameterTypes: Type[];
    returnType?: Type;
}

export interface FunctionType extends TypeBase {
    category: TypeCategory.Function;

    details: FunctionDetails;

    // A function type can be specialized (i.e. generic type
    // variables replaced by a concrete type).
    specializedTypes?: SpecializedFunctionTypes;

    // Filled in lazily
    inferredReturnType?: Type;

    // If this is a bound function where the first parameter
    // was stripped from the original unbound function, the
    // (specialized) type of that stripped parameter.
    strippedFirstParamType?: Type;
}

export interface ParamSpecEntry {
    category: ParameterCategory;
    name?: string;
    type: Type;
}

export namespace FunctionType {
    export function createInstance(
        name: string,
        moduleName: string,
        functionFlags: FunctionTypeFlags,
        docString?: string
    ) {
        return create(name, moduleName, functionFlags, TypeFlags.Instance, docString);
    }

    export function createInstantiable(
        name: string,
        moduleName: string,
        functionFlags: FunctionTypeFlags,
        docString?: string
    ) {
        return create(name, moduleName, functionFlags, TypeFlags.Instantiable, docString);
    }

    function create(
        name: string,
        moduleName: string,
        functionFlags: FunctionTypeFlags,
        typeFlags: TypeFlags,
        docString?: string
    ) {
        const newFunctionType: FunctionType = {
            category: TypeCategory.Function,
            details: {
                name,
                moduleName,
                flags: functionFlags,
                parameters: [],
                docString,
            },
            flags: typeFlags,
        };
        return newFunctionType;
    }

    // Creates a deep copy of the function type, including a fresh
    // version of _functionDetails.
    export function clone(type: FunctionType, stripFirstParam = false): FunctionType {
        const newFunction = create(
            type.details.name,
            type.details.moduleName,
            type.details.flags,
            type.flags,
            type.details.docString
        );

        newFunction.details = { ...type.details };

        // If we strip off the first parameter, this is no longer an
        // instance method or class method.
        if (stripFirstParam) {
            // Stash away the effective type of the first parameter.
            newFunction.strippedFirstParamType = getEffectiveParameterType(type, 0);
            newFunction.details.parameters = type.details.parameters.slice(1);
            newFunction.details.flags &= ~(FunctionTypeFlags.ConstructorMethod | FunctionTypeFlags.ClassMethod);
            newFunction.details.flags |= FunctionTypeFlags.StaticMethod;
        }

        if (type.typeAliasInfo !== undefined) {
            newFunction.typeAliasInfo = type.typeAliasInfo;
        }

        if (type.specializedTypes) {
            newFunction.specializedTypes = {
                parameterTypes: stripFirstParam
                    ? type.specializedTypes.parameterTypes.slice(1)
                    : type.specializedTypes.parameterTypes,
                returnType: type.specializedTypes.returnType,
            };
        }

        newFunction.inferredReturnType = type.inferredReturnType;

        return newFunction;
    }

    export function cloneAsInstance(type: FunctionType) {
        assert(TypeBase.isInstantiable(type));
        const newInstance: FunctionType = { ...type };
        newInstance.flags &= ~TypeFlags.Instantiable;
        newInstance.flags |= TypeFlags.Instance;
        return newInstance;
    }

    export function cloneAsInstantiable(type: FunctionType) {
        assert(TypeBase.isInstance(type));
        const newInstance: FunctionType = { ...type };
        newInstance.flags &= ~TypeFlags.Instance;
        newInstance.flags |= TypeFlags.Instantiable;
        return newInstance;
    }

    // Creates a shallow copy of the function type with new
    // specialized types. The clone shares the _functionDetails
    // with the object being cloned.
    export function cloneForSpecialization(
        type: FunctionType,
        specializedTypes: SpecializedFunctionTypes,
        specializedInferredReturnType: Type | undefined
    ): FunctionType {
        const newFunction = create(
            type.details.name,
            type.details.moduleName,
            type.details.flags,
            type.flags,
            type.details.docString
        );
        newFunction.details = type.details;

        assert(specializedTypes.parameterTypes.length === type.details.parameters.length);
        newFunction.specializedTypes = specializedTypes;

        if (specializedInferredReturnType) {
            newFunction.inferredReturnType = specializedInferredReturnType;
        }

        return newFunction;
    }

    // Creates a new function based on the parameters of another function.
    export function cloneForParamSpec(type: FunctionType, paramTypes: ParamSpecEntry[] | undefined) {
        const newFunction = create(
            type.details.name,
            type.details.moduleName,
            type.details.flags,
            type.flags,
            type.details.docString
        );

        // Make a shallow clone of the details.
        newFunction.details = { ...type.details };

        // The clone should no longer have a parameter specification
        // since we're replacing it.
        delete newFunction.details.paramSpec;

        if (paramTypes) {
            newFunction.details.parameters = paramTypes.map((specEntry, index) => {
                return {
                    category: specEntry.category,
                    name: specEntry.name,
                    isNameSynthesized: false,
                    hasDeclaredType: true,
                    type: specEntry.type,
                };
            });
        }

        return newFunction;
    }

    export function addDefaultParameters(functionType: FunctionType, useUnknown = false) {
        FunctionType.addParameter(functionType, {
            category: ParameterCategory.VarArgList,
            name: 'args',
            type: useUnknown ? UnknownType.create() : AnyType.create(),
            hasDeclaredType: !useUnknown,
        });
        FunctionType.addParameter(functionType, {
            category: ParameterCategory.VarArgDictionary,
            name: 'kwargs',
            type: useUnknown ? UnknownType.create() : AnyType.create(),
            hasDeclaredType: !useUnknown,
        });
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

    export function isPyTypedDefinition(type: FunctionType) {
        return (type.details.flags & FunctionTypeFlags.PyTypedDefinition) !== 0;
    }

    export function isFinal(type: FunctionType) {
        return (type.details.flags & FunctionTypeFlags.Final) !== 0;
    }

    export function hasUnannotatedParams(type: FunctionType) {
        return (type.details.flags & FunctionTypeFlags.UnannotatedParams) !== 0;
    }

    export function shouldSkipParamCompatibilityCheck(type: FunctionType) {
        return (type.details.flags & FunctionTypeFlags.SkipParamCompatibilityCheck) !== 0;
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
    export function create(overloads: FunctionType[] = []) {
        const newType: OverloadedFunctionType = {
            category: TypeCategory.OverloadedFunction,
            overloads,
            flags: TypeFlags.Instance,
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
        category: TypeCategory.None,
        flags: TypeFlags.Instance,
    };

    const _noneType: NoneType = {
        category: TypeCategory.None,
        flags: TypeFlags.Instantiable,
    };

    export function createInstance() {
        return _noneInstance;
    }

    export function createType() {
        return _noneType;
    }
}

export interface NeverType extends TypeBase {
    category: TypeCategory.Never;
}

export namespace NeverType {
    const _neverInstance: NeverType = {
        category: TypeCategory.Never,
        flags: TypeFlags.Instance | TypeFlags.Instantiable,
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
        isEllipsis: false,
        flags: TypeFlags.Instance | TypeFlags.Instantiable,
    };
    const _ellipsisInstance: AnyType = {
        category: TypeCategory.Any,
        isEllipsis: true,
        flags: TypeFlags.Instance | TypeFlags.Instantiable,
    };

    export function create(isEllipsis = false) {
        return isEllipsis ? _ellipsisInstance : _anyInstance;
    }
}

// References a single constraint within a constrained TypeVar.
export interface SubtypeConstraint {
    typeVarName: string;
    constraintIndex: number;
}

export namespace SubtypeConstraint {
    export function combine(constraints1: SubtypeConstraints, constraints2: SubtypeConstraints): SubtypeConstraints {
        if (!constraints1) {
            return constraints2;
        }

        if (!constraints2) {
            return constraints1;
        }

        // Deduplicate the lists.
        const combined = [...constraints1];
        constraints2.forEach((c1) => {
            if (!combined.some((c2) => _compare(c1, c2) === 0)) {
                combined.push(c1);
            }
        });

        // Always keep the constraints sorted for easier comparison.
        return combined.sort(_compare);
    }

    function _compare(c1: SubtypeConstraint, c2: SubtypeConstraint) {
        if (c1.typeVarName < c2.typeVarName) {
            return -1;
        } else if (c1.typeVarName > c2.typeVarName) {
            return 1;
        }
        if (c1.constraintIndex < c2.constraintIndex) {
            return -1;
        } else if (c1.constraintIndex > c2.constraintIndex) {
            return 1;
        }
        return 0;
    }

    export function isSame(constraints1: SubtypeConstraints, constraints2: SubtypeConstraints): boolean {
        if (!constraints1) {
            return !constraints2;
        }

        if (!constraints2 || constraints1.length !== constraints2.length) {
            return false;
        }

        return (
            constraints1.find(
                (c1, index) =>
                    c1.typeVarName !== constraints2[index].typeVarName ||
                    c1.constraintIndex !== constraints2[index].constraintIndex
            ) === undefined
        );
    }

    // Determines if the two constraints can be used at the same time. If
    // one constraint list contains a constraint for a type variable, and the
    // same constraint is not in the other constraint list, the two are considered
    // incompatible.
    export function isCompatible(constraints1: SubtypeConstraints, constraints2: SubtypeConstraints): boolean {
        if (!constraints1 || !constraints2) {
            return true;
        }

        for (const c1 of constraints1) {
            let foundTypeVarMatch = false;
            const exactMatch = constraints2.find((c2) => {
                if (c1.typeVarName === c2.typeVarName) {
                    foundTypeVarMatch = true;
                    return c1.constraintIndex === c2.constraintIndex;
                }
                return false;
            });

            if (foundTypeVarMatch && !exactMatch) {
                return false;
            }
        }

        return true;
    }
}

export type SubtypeConstraints = SubtypeConstraint[] | undefined;
export interface ConstrainedSubtype {
    type: Type;
    constraints: SubtypeConstraints;
}

export interface UnionType extends TypeBase {
    category: TypeCategory.Union;
    subtypes: UnionableType[];
    constraints?: SubtypeConstraints[];
    literalStrMap?: Map<string, UnionableType>;
    literalIntMap?: Map<number, UnionableType>;
}

export namespace UnionType {
    export function create() {
        const newUnionType: UnionType = {
            category: TypeCategory.Union,
            subtypes: [],
            flags: TypeFlags.Instance | TypeFlags.Instantiable,
        };

        return newUnionType;
    }

    export function addType(unionType: UnionType, newType: UnionableType, constraints: SubtypeConstraints) {
        // If we're adding a string literal type, add it to the
        // literal string map to speed up some operations. It's not
        // uncommon for unions to contain hundreds of string literals.
        if (
            isObject(newType) &&
            ClassType.isBuiltIn(newType.classType, 'str') &&
            newType.classType.literalValue !== undefined &&
            !constraints
        ) {
            if (unionType.literalStrMap === undefined) {
                unionType.literalStrMap = new Map<string, UnionableType>();
            }
            unionType.literalStrMap.set(newType.classType.literalValue as string, newType);
        } else if (
            isObject(newType) &&
            ClassType.isBuiltIn(newType.classType, 'int') &&
            newType.classType.literalValue !== undefined &&
            !constraints
        ) {
            if (unionType.literalIntMap === undefined) {
                unionType.literalIntMap = new Map<number, UnionableType>();
            }
            unionType.literalIntMap.set(newType.classType.literalValue as number, newType);
        }

        if (constraints) {
            if (!unionType.constraints) {
                unionType.constraints = Array.from({ length: unionType.subtypes.length });
            }
            unionType.constraints.push(constraints);
        }

        unionType.flags &= newType.flags;
        unionType.subtypes.push(newType);
    }

    export function containsType(
        unionType: UnionType,
        subtype: Type,
        constraints: SubtypeConstraints,
        recursionCount = 0
    ): boolean {
        // Handle string literals as a special case because unions can sometimes
        // contain hundreds of string literal types.
        if (isObject(subtype)) {
            if (
                ClassType.isBuiltIn(subtype.classType, 'str') &&
                subtype.classType.literalValue !== undefined &&
                unionType.literalStrMap !== undefined
            ) {
                return unionType.literalStrMap.has(subtype.classType.literalValue as string);
            } else if (
                ClassType.isBuiltIn(subtype.classType, 'int') &&
                subtype.classType.literalValue !== undefined &&
                unionType.literalIntMap !== undefined
            ) {
                return unionType.literalIntMap.has(subtype.classType.literalValue as number);
            }
        }

        return unionType.subtypes.find((t) => isTypeSame(t, subtype, recursionCount + 1)) !== undefined;
    }
}

export interface TypeVarDetails {
    name: string;
    constraints: Type[];
    boundType?: Type;
    isCovariant: boolean;
    isContravariant: boolean;
    isParamSpec: boolean;

    // Internally created (e.g. for pseudo-generic classes)
    isSynthesized: boolean;
    synthesizedIndex?: number;

    // Used for recursive type aliases.
    recursiveTypeAliasName?: string;
    recursiveTypeAliasScopeId?: TypeVarScopeId;

    // Type parameters for a recursive type alias.
    recursiveTypeParameters?: TypeVarType[];
}

export interface TypeVarType extends TypeBase {
    category: TypeCategory.TypeVar;
    details: TypeVarDetails;

    // An ID that uniquely identifies the scope in which this TypeVar is
    // defined.
    scopeId?: TypeVarScopeId;

    // String formatted as <name>.<scopeId>.
    scopeName?: string;
}

export namespace TypeVarType {
    export function createInstance(name: string, isParamSpec: boolean, isSynthesized = false) {
        return create(name, isParamSpec, isSynthesized, TypeFlags.Instance);
    }

    export function createInstantiable(name: string, isParamSpec: boolean, isSynthesized = false) {
        return create(name, isParamSpec, isSynthesized, TypeFlags.Instantiable);
    }

    export function cloneAsInstance(type: TypeVarType) {
        assert(TypeBase.isInstantiable(type));
        const newInstance: TypeVarType = { ...type };
        newInstance.flags &= ~TypeFlags.Instantiable;
        newInstance.flags |= TypeFlags.Instance;
        return newInstance;
    }

    export function cloneAsInstantiable(type: TypeVarType) {
        assert(TypeBase.isInstance(type));
        const newInstance: TypeVarType = { ...type };
        newInstance.flags &= ~TypeFlags.Instance;
        newInstance.flags |= TypeFlags.Instantiable;
        return newInstance;
    }

    export function cloneForScopeId(type: TypeVarType, scopeId: string) {
        const newInstance: TypeVarType = { ...type };
        newInstance.scopeName = makeScopeName(type.details.name, scopeId);
        newInstance.scopeId = scopeId;
        return newInstance;
    }

    export function makeScopeName(name: string, scopeId: string) {
        return `${name}.${scopeId}`;
    }

    function create(name: string, isParamSpec: boolean, isSynthesized: boolean, typeFlags: TypeFlags) {
        const newTypeVarType: TypeVarType = {
            category: TypeCategory.TypeVar,
            details: {
                name,
                constraints: [],
                isCovariant: false,
                isContravariant: false,
                isParamSpec,
                isSynthesized,
            },
            flags: typeFlags,
        };
        return newTypeVarType;
    }

    export function addConstraint(typeVarType: TypeVarType, constraintType: Type) {
        typeVarType.details.constraints.push(constraintType);
    }

    export function getScopeName(typeVarType: TypeVarType) {
        return typeVarType.scopeName || typeVarType.details.name;
    }
}

export function isNever(type: Type): type is NeverType {
    return type.category === TypeCategory.Never;
}

export function isNone(type: Type): type is NoneType {
    return type.category === TypeCategory.None;
}

export function isUnknown(type: Type): type is UnknownType {
    return type.category === TypeCategory.Unknown;
}

export function isAnyOrUnknown(type: Type): type is AnyType | UnknownType {
    if (type.category === TypeCategory.Any || type.category === TypeCategory.Unknown) {
        return true;
    }

    if (type.category === TypeCategory.Union) {
        return type.subtypes.find((subtype) => !isAnyOrUnknown(subtype)) === undefined;
    }

    return false;
}

export function isUnbound(type: Type): type is UnboundType {
    return type.category === TypeCategory.Unbound;
}

export function isPossiblyUnbound(type: Type): boolean {
    if (type.category === TypeCategory.Unbound) {
        return true;
    }

    if (type.category === TypeCategory.Union) {
        return type.subtypes.find((subtype) => isPossiblyUnbound(subtype)) !== undefined;
    }

    return false;
}

export function isClass(type: Type): type is ClassType {
    return type.category === TypeCategory.Class;
}

export function isObject(type: Type): type is ObjectType {
    return type.category === TypeCategory.Object;
}

export function isModule(type: Type): type is ModuleType {
    return type.category === TypeCategory.Module;
}

export function isTypeVar(type: Type): type is TypeVarType {
    return type.category === TypeCategory.TypeVar;
}

export function isFunction(type: Type): type is FunctionType {
    return type.category === TypeCategory.Function;
}

export function isOverloadedFunction(type: Type): type is OverloadedFunctionType {
    return type.category === TypeCategory.OverloadedFunction;
}

export function getTypeAliasInfo(type: Type) {
    if (type.typeAliasInfo) {
        return type.typeAliasInfo;
    }

    if (
        isTypeVar(type) &&
        type.details.recursiveTypeAliasName &&
        type.details.boundType &&
        type.details.boundType.typeAliasInfo
    ) {
        return type.details.boundType.typeAliasInfo;
    }

    return undefined;
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
            if (!ClassType.isSameGenericClass(type1, classType2, recursionCount + 1)) {
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

            const type1VariadicTypeArgs = type1.variadicTypeArguments || [];
            const type2VariadicTypeArgs = classType2.variadicTypeArguments || [];
            if (type1VariadicTypeArgs.length !== type2VariadicTypeArgs.length) {
                return false;
            }
            for (let i = 0; i < type1VariadicTypeArgs.length; i++) {
                if (!isTypeSame(type1VariadicTypeArgs[i], type2VariadicTypeArgs[i], recursionCount + 1)) {
                    return false;
                }
            }

            if (!ClassType.isLiteralValueSame(type1, classType2)) {
                return false;
            }

            return true;
        }

        case TypeCategory.Object: {
            const objType2 = type2 as ObjectType;

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
            return (
                findSubtype(
                    type1,
                    (subtype, constraints) =>
                        !UnionType.containsType(unionType2, subtype, constraints, recursionCount + 1)
                ) === undefined
            );
        }

        case TypeCategory.TypeVar: {
            const type2TypeVar = type2 as TypeVarType;

            if (type1.scopeId !== type2TypeVar.scopeId) {
                return false;
            }

            if (type1.details === type2TypeVar.details) {
                return true;
            }

            if (type1.details.name !== type2TypeVar.details.name) {
                return false;
            }

            const boundType1 = type1.details.boundType;
            const boundType2 = type2TypeVar.details.boundType;
            if (boundType1) {
                if (!boundType2 || !isTypeSame(boundType1, boundType2, recursionCount + 1)) {
                    return false;
                }
            } else {
                if (boundType2) {
                    return false;
                }
            }

            if (type1.details.isContravariant !== type2TypeVar.details.isContravariant) {
                return false;
            }

            if (type1.details.isCovariant !== type2TypeVar.details.isCovariant) {
                return false;
            }

            const constraints1 = type1.details.constraints;
            const constraints2 = type2TypeVar.details.constraints;
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
export function removeUnbound(type: Type): Type {
    if (type.category === TypeCategory.Union) {
        return removeFromUnion(type, (t: Type) => isUnbound(t));
    }

    if (isUnbound(type)) {
        return UnknownType.create();
    }

    return type;
}

// If the type is a union, remove an "None" type from the union,
// returning only the known types.
export function removeNoneFromUnion(type: Type): Type {
    return removeFromUnion(type, (t: Type) => t.category === TypeCategory.None);
}

export function removeFromUnion(type: Type, removeFilter: (type: Type, constraints: SubtypeConstraints) => boolean) {
    if (type.category === TypeCategory.Union) {
        const remainingTypes: ConstrainedSubtype[] = [];
        type.subtypes.forEach((subtype, index) => {
            const constraints = type.constraints ? type.constraints[index] : undefined;
            if (!removeFilter(subtype, constraints)) {
                remainingTypes.push({ type: subtype, constraints });
            }
        });
        if (remainingTypes.length < type.subtypes.length) {
            return combineConstrainedTypes(remainingTypes);
        }
    }

    return type;
}

export function findSubtype(
    type: Type,
    filter: (type: UnionableType | NeverType, constraints: SubtypeConstraints) => boolean
) {
    if (type.category === TypeCategory.Union) {
        return type.subtypes.find((subtype, index) => {
            return filter(subtype, type.constraints ? type.constraints[index] : undefined);
        });
    }

    return filter(type, undefined) ? type : undefined;
}

// Determines whether the specified type is a type that can be
// combined with other types for a union.
export function isUnionableType(subtypes: Type[]): boolean {
    let typeFlags = TypeFlags.Instance | TypeFlags.Instantiable;

    for (const subtype of subtypes) {
        typeFlags &= subtype.flags;
    }

    // All subtypes need to be instantiable. Some types (like Any
    // and None) are both instances and instantiable. It's OK to
    // include some of these, but at least one subtype needs to
    // be definitively instantiable (not an instance).
    return (typeFlags & TypeFlags.Instantiable) !== 0 && (typeFlags & TypeFlags.Instance) === 0;
}

export function combineTypes(types: Type[], maxSubtypeCount?: number): Type {
    return combineConstrainedTypes(
        types.map((type) => {
            return { type, constraints: undefined };
        }),
        maxSubtypeCount
    );
}

// Combines multiple types into a single type. If the types are
// the same, only one is returned. If they differ, they
// are combined into a UnionType. NeverTypes are filtered out.
// If no types remain in the end, a NeverType is returned.
export function combineConstrainedTypes(subtypes: ConstrainedSubtype[], maxSubtypeCount?: number): Type {
    // Filter out any "Never" types.
    subtypes = subtypes.filter((subtype) => subtype.type.category !== TypeCategory.Never);
    if (subtypes.length === 0) {
        return NeverType.create();
    }

    // Handle the common case where there is only one type.
    if (subtypes.length === 1 && !subtypes[0].constraints) {
        return subtypes[0].type;
    }

    // Expand all union types.
    let expandedTypes: ConstrainedSubtype[] = [];
    for (const constrainedType of subtypes) {
        if (constrainedType.type.category === TypeCategory.Union) {
            const unionType = constrainedType.type;
            unionType.subtypes.forEach((subtype, index) => {
                expandedTypes.push({
                    type: subtype,
                    constraints: SubtypeConstraint.combine(
                        unionType.constraints ? unionType.constraints[index] : undefined,
                        constrainedType.constraints
                    ),
                });
            });
        } else {
            expandedTypes.push({ type: constrainedType.type, constraints: constrainedType.constraints });
        }
    }

    // Sort all of the literal types to the end.
    expandedTypes = expandedTypes.sort((constrainedType1, constrainedType2) => {
        const type1 = constrainedType1.type;
        const type2 = constrainedType2.type;
        if (
            (isObject(type1) && type1.classType.literalValue !== undefined) ||
            (isClass(type1) && type1.literalValue !== undefined)
        ) {
            return 1;
        } else if (
            (isObject(type2) && type2.classType.literalValue !== undefined) ||
            (isClass(type2) && type2.literalValue !== undefined)
        ) {
            return -1;
        }
        return 0;
    });

    // If removing all NoReturn types results in no remaining types,
    // convert it to an unknown.
    if (expandedTypes.length === 0) {
        return UnknownType.create();
    }

    const newUnionType = UnionType.create();
    let hitMaxSubtypeCount = false;

    expandedTypes.forEach((constrainedType, index) => {
        if (index === 0) {
            UnionType.addType(newUnionType, constrainedType.type as UnionableType, constrainedType.constraints);
        } else {
            if (maxSubtypeCount === undefined || newUnionType.subtypes.length < maxSubtypeCount) {
                _addTypeIfUnique(newUnionType, constrainedType.type as UnionableType, constrainedType.constraints);
            } else {
                hitMaxSubtypeCount = true;
            }
        }
    });

    if (hitMaxSubtypeCount) {
        return AnyType.create();
    }

    // If only one type remains, convert it from a union to a simple type.
    if (newUnionType.subtypes.length === 1) {
        return newUnionType.subtypes[0];
    }

    return newUnionType;
}

// Determines whether the dest type is the same as the source type with
// the possible exception that the source type has a literal value when
// the dest does not.
export function isSameWithoutLiteralValue(destType: Type, srcType: Type): boolean {
    // If it's the same with literals, great.
    if (isTypeSame(destType, srcType)) {
        return true;
    }

    if (isClass(srcType) && srcType.literalValue !== undefined) {
        // Strip the literal.
        srcType = ClassType.cloneWithLiteral(srcType, undefined);
        return isTypeSame(destType, srcType);
    }

    if (isObject(srcType) && srcType.classType.literalValue !== undefined) {
        // Strip the literal.
        srcType = ObjectType.create(ClassType.cloneWithLiteral(srcType.classType, undefined));
        return isTypeSame(destType, srcType);
    }

    return false;
}

function _addTypeIfUnique(unionType: UnionType, typeToAdd: UnionableType, constraintsToAdd: SubtypeConstraints) {
    // Handle the addition of a string literal in a special manner to
    // avoid n^2 behavior in unions that contain hundreds of string
    // literal types. Skip this for constrained types.
    if (!constraintsToAdd && isObject(typeToAdd)) {
        if (
            ClassType.isBuiltIn(typeToAdd.classType, 'str') &&
            typeToAdd.classType.literalValue !== undefined &&
            unionType.literalStrMap !== undefined
        ) {
            if (!unionType.literalStrMap.has(typeToAdd.classType.literalValue as string)) {
                UnionType.addType(unionType, typeToAdd, constraintsToAdd);
            }
            return;
        } else if (
            ClassType.isBuiltIn(typeToAdd.classType, 'int') &&
            typeToAdd.classType.literalValue !== undefined &&
            unionType.literalIntMap !== undefined
        ) {
            if (!unionType.literalIntMap.has(typeToAdd.classType.literalValue as number)) {
                UnionType.addType(unionType, typeToAdd, constraintsToAdd);
            }
            return;
        }
    }

    for (let i = 0; i < unionType.subtypes.length; i++) {
        const type = unionType.subtypes[i];
        const constraints = unionType.constraints ? unionType.constraints[i] : undefined;

        if (!SubtypeConstraint.isSame(constraints, constraintsToAdd)) {
            continue;
        }

        // Does this type already exist in the types array?
        if (isTypeSame(type, typeToAdd)) {
            return;
        }

        // If the typeToAdd is a literal value and there's already
        // a non-literal type that matches, don't add the literal value.
        if (isObject(type) && isObject(typeToAdd)) {
            if (isSameWithoutLiteralValue(type, typeToAdd)) {
                if (type.classType.literalValue === undefined) {
                    return;
                }
            }

            // If we're adding Literal[False] or Literal[True] to its
            // opposite, combine them into a non-literal 'bool' type.
            if (ClassType.isBuiltIn(type.classType, 'bool')) {
                if (
                    typeToAdd.classType.literalValue !== undefined &&
                    !typeToAdd.classType.literalValue === type.classType.literalValue
                ) {
                    unionType.subtypes[i] = ObjectType.create(ClassType.cloneWithLiteral(type.classType, undefined));
                    return;
                }
            }
        }
    }

    UnionType.addType(unionType, typeToAdd, constraintsToAdd);
}
