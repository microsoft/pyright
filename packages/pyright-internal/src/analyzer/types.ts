/*
 * types.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Representation of types used during type analysis within Python.
 */

import { assert } from '../common/debug';
import { Uri } from '../common/uri/uri';
import { ArgumentNode, ExpressionNode, NameNode, ParameterCategory } from '../parser/parseNodes';
import { ClassDeclaration, FunctionDeclaration, SpecialBuiltInClassDeclaration } from './declaration';
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

    // Used in type narrowing to indicate that all possible
    // subtypes in a union have been eliminated, and execution
    // should never get to this point.
    Never,

    // Callable type with typed input parameters and return parameter.
    Function,

    // Functions defined with @overload decorator in stub files that
    // have multiple function declarations for a common implementation.
    OverloadedFunction,

    // Class definition, including associated instance methods,
    // class methods, static methods, properties, and variables.
    Class,

    // Module instance.
    Module,

    // Composite type (e.g. Number OR String).
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
    | FunctionType
    | OverloadedFunctionType
    | ClassType
    | ModuleType
    | TypeVarType;

export type Type = UnionableType | NeverType | UnionType;

export type TypeVarScopeId = string;
export const InScopePlaceholderScopeId = '-';

export class EnumLiteral {
    constructor(
        public classFullName: string,
        public className: string,
        public itemName: string,
        public itemType: Type
    ) {}

    getName() {
        return `${this.classFullName}.${this.itemName}`;
    }
}

export type LiteralValue = number | bigint | boolean | string | EnumLiteral;

export type TypeSourceId = number;

// This constant controls the maximum number of nested types (i.e. types
// used as type arguments or parameter types in other types) before we
// give up. This constant was previously set to 32, but there were certain
// pathological recursive types where this resulted in a hang. It was also
// previously lowered to 10, but this caused some legitimate failures in
// code that used numpy. Even at 16, there are some legitimate failures in
// numpy.
export const maxTypeRecursionCount = 20;

export type InheritanceChain = (ClassType | UnknownType)[];

export interface TypeSameOptions {
    ignorePseudoGeneric?: boolean;
    ignoreTypeFlags?: boolean;
    ignoreConditions?: boolean;
    ignoreTypedDictNarrowEntries?: boolean;
    treatAnySameAsUnknown?: boolean;
}

export interface TypeAliasInfo {
    name: string;
    fullName: string;
    moduleName: string;
    fileUri: Uri;

    typeVarScopeId: TypeVarScopeId;

    // Indicates whether the type alias was declared with the
    // "type" syntax introduced in PEP 695 or was created by a direct
    // call to the TypeAliasType constructor.
    isPep695Syntax: boolean;

    // Type parameters, if type alias is generic
    typeParameters?: TypeVarType[] | undefined;

    // Lazily-evaluated variance of type parameters based on how
    // they are used in the type alias
    usageVariance?: Variance[];

    // Type argument, if type alias is specialized
    typeArguments?: Type[] | undefined;
}

interface TypeBase {
    category: TypeCategory;
    flags: TypeFlags;

    // Used to handle nested references to instantiable classes
    // (e.g. type[type[type[T]]]). If the field isn't present,
    // it is assumed to be zero.
    instantiableNestingLevel?: number;

    // Used in cases where the type is an instantiable special form such as
    // UnionType, Literal, or Required. These are not directly instantiable
    // and are simple classes when used in value (runtime) expressions but
    // have special meaning when used in a type expression.
    specialForm?: ClassType;

    // Used only for type aliases
    typeAliasInfo?: TypeAliasInfo | undefined;

    // Used only for conditional (constrained) types
    condition?: TypeCondition[] | undefined;

    // This type is inferred within a py.typed source file and could be
    // inferred differently by other type checkers. We don't model this
    // with a TypeFlags because we don't want an ambiguous and unambiguous
    // type to be seen as distinct when comparing types.
    isAmbiguous?: boolean;

    // Cached values are not cloned.
    cached?: {
        // Type converted to instantiable and instance by convertToInstance
        // and convertToInstantiable (cached)
        instantiableType?: Type;
        instanceType?: Type;

        // Type converted to instantiable and instance by TypeBase methods (cached)
        typeBaseInstantiableType?: Type;
        typeBaseInstanceType?: Type;

        // Requires specialization flag (cached)
        requiresSpecialization?: boolean;
    };
}

export namespace TypeBase {
    export function isInstantiable(type: TypeBase) {
        return (type.flags & TypeFlags.Instantiable) !== 0;
    }

    export function isInstance(type: TypeBase) {
        return (type.flags & TypeFlags.Instance) !== 0;
    }

    export function isAmbiguous(type: TypeBase) {
        return !!type.isAmbiguous;
    }

    export function cloneType<T extends TypeBase>(type: T): T {
        const clone = { ...type };
        delete clone.cached;
        return clone;
    }

    export function cloneAsSpecialForm<T extends TypeBase>(type: T, specialForm: ClassType | undefined): T {
        const clone = { ...type };
        delete clone.cached;

        if (specialForm) {
            clone.specialForm = specialForm;
        } else {
            delete clone.specialForm;
        }

        return clone;
    }

    export function cloneTypeAsInstance<T extends Type>(type: T, cache: boolean): T {
        assert(TypeBase.isInstantiable(type));

        const newInstance = TypeBase.cloneType(type);

        if (newInstance.instantiableNestingLevel === undefined) {
            newInstance.flags &= ~TypeFlags.Instantiable;
            newInstance.flags |= TypeFlags.Instance;
            delete newInstance.instantiableNestingLevel;
        } else {
            if (newInstance.instantiableNestingLevel === 1) {
                delete newInstance.instantiableNestingLevel;
            } else {
                newInstance.instantiableNestingLevel--;
            }
        }

        // Should we cache it for next time?
        if (cache) {
            if (!type.cached) {
                type.cached = {};
            }

            type.cached.typeBaseInstanceType = newInstance;
        }

        return newInstance;
    }

    export function cloneTypeAsInstantiable<T extends Type>(type: T, cache: boolean): T {
        const newInstance: T = TypeBase.cloneType(type);

        if (TypeBase.isInstance(type)) {
            newInstance.flags &= ~TypeFlags.Instance;
            newInstance.flags |= TypeFlags.Instantiable;
        } else {
            newInstance.instantiableNestingLevel =
                newInstance.instantiableNestingLevel === undefined ? 1 : newInstance.instantiableNestingLevel;
        }

        // Remove type alias information because the type will no longer match
        // that of the type alias definition.
        delete newInstance.typeAliasInfo;

        // Should we cache it for next time?
        if (cache) {
            if (!type.cached) {
                type.cached = {};
            }

            type.cached.typeBaseInstantiableType = newInstance;
        }

        return newInstance;
    }

    export function cloneForTypeAlias(
        type: Type,
        name: string,
        fullName: string,
        moduleName: string,
        fileUri: Uri,
        typeVarScopeId: TypeVarScopeId,
        isPep695Syntax: boolean,
        typeParams?: TypeVarType[],
        typeArgs?: Type[]
    ): Type {
        const typeClone = cloneType(type);

        typeClone.typeAliasInfo = {
            name,
            fullName,
            moduleName,
            fileUri,
            typeParameters: typeParams,
            typeArguments: typeArgs,
            typeVarScopeId,
            isPep695Syntax,
        };

        return typeClone;
    }

    export function cloneForCondition<T extends Type>(type: T, condition: TypeCondition[] | undefined): T {
        // Handle the common case where there are no conditions. In this case,
        // cloning isn't necessary.
        if (type.condition === undefined && condition === undefined) {
            return type;
        }

        const typeClone = cloneType(type);
        typeClone.condition = condition;
        return typeClone;
    }

    export function cloneForAmbiguousType(type: Type) {
        if (type.isAmbiguous) {
            return type;
        }

        const typeClone = cloneType(type);
        typeClone.isAmbiguous = true;
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

    export function convertToInstance(type: UnboundType): UnboundType {
        // Remove the "special form" if present. Otherwise return the existing type.
        return type.specialForm ? UnboundType.create() : type;
    }
}

export interface UnknownType extends TypeBase {
    category: TypeCategory.Unknown;
    isIncomplete: boolean;

    // A "possible type" is a form of a "weak union" where the actual
    // type is unknown, but it could be one of the subtypes in the union.
    // This is used for overload matching in cases where more than one
    // overload matches due to an argument that evaluates to Any or Unknown.
    possibleType?: Type;
}

export namespace UnknownType {
    const _instance: UnknownType = {
        category: TypeCategory.Unknown,
        flags: TypeFlags.Instantiable | TypeFlags.Instance,
        isIncomplete: false,
    };
    const _incompleteInstance: UnknownType = {
        category: TypeCategory.Unknown,
        flags: TypeFlags.Instantiable | TypeFlags.Instance,
        isIncomplete: true,
    };

    export function create(isIncomplete = false) {
        return isIncomplete ? _incompleteInstance : _instance;
    }

    export function createPossibleType(possibleType: Type, isIncomplete: boolean) {
        const unknownWithPossibleType: UnknownType = {
            category: TypeCategory.Unknown,
            flags: TypeFlags.Instantiable | TypeFlags.Instance,
            isIncomplete,
            possibleType,
        };

        return unknownWithPossibleType;
    }

    export function convertToInstance(type: UnknownType): UnknownType {
        // Remove the "special form" if present. Otherwise return the existing type.
        return type.specialForm ? UnknownType.create(type.isIncomplete) : type;
    }
}

export interface ModuleType extends TypeBase {
    category: TypeCategory.Module;
    fields: SymbolTable;
    docString?: string | undefined;

    // If a field lookup isn't found, should the type of the
    // resulting field be Any/Unknown or treated as an error?
    notPresentFieldType?: AnyType | UnknownType;

    // A "loader" module includes symbols that were injected by
    // the module loader. We keep these separate so we don't
    // pollute the symbols exported by the module itself.
    loaderFields: SymbolTable;

    // The period-delimited import name of this module.
    moduleName: string;

    fileUri: Uri;
}

export namespace ModuleType {
    export function create(moduleName: string, fileUri: Uri, symbolTable?: SymbolTable) {
        const newModuleType: ModuleType = {
            category: TypeCategory.Module,
            fields: symbolTable || new Map<string, Symbol>(),
            loaderFields: new Map<string, Symbol>(),
            flags: TypeFlags.Instantiable | TypeFlags.Instantiable,
            moduleName,
            fileUri,
        };
        return newModuleType;
    }

    export function getField(moduleType: ModuleType, name: string): Symbol | undefined {
        // Always look for the symbol in the module's fields before consulting
        // the loader fields. The loader runs before the module, so its values
        // will be overwritten by the module.
        let symbol = moduleType.fields.get(name);

        if (moduleType.loaderFields) {
            if (!symbol) {
                symbol = moduleType.loaderFields.get(name);
            } else if (symbol.getDeclarations().length === 1) {
                // If the symbol is hidden when accessed via the module but is
                // also accessible through a loader field, use the latter so it
                // isn't flagged as an error.
                const loaderSymbol = moduleType.loaderFields.get(name);
                if (loaderSymbol && !loaderSymbol.isExternallyHidden()) {
                    symbol = loaderSymbol;
                }
            }
        }
        return symbol;
    }
}

export interface DataClassEntry {
    name: string;
    classType: ClassType;
    isClassVar: boolean;
    isKeywordOnly: boolean;
    alias?: string | undefined;
    hasDefault?: boolean | undefined;
    nameNode: NameNode | undefined;
    defaultValueExpression?: ExpressionNode | undefined;
    includeInInit: boolean;
    type: Type;
    converter?: ArgumentNode | undefined;
}

export interface TypedDictEntry {
    valueType: Type;
    isRequired: boolean;
    isReadOnly: boolean;
    isProvided: boolean;
}

export interface TypedDictEntries {
    knownItems: Map<string, TypedDictEntry>;
    extraItems?: TypedDictEntry | undefined;
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

    // Introduced in PEP 589, TypedDict classes provide a way
    // to specify type hints for dictionaries with different
    // value types and a limited set of static keys.
    TypedDictClass = 1 << 2,

    // Used in conjunction with TypedDictClass, indicates that
    // the TypedDict class is marked "closed".
    TypedDictMarkedClosed = 1 << 3,

    // Used in conjunction with TypedDictClass, indicates that
    // the TypedDict class is marked "closed" or one or more of
    // its superclasses is marked "closed".
    TypedDictEffectivelyClosed = 1 << 4,

    // Used in conjunction with TypedDictClass, indicates that
    // the dictionary values can be omitted.
    CanOmitDictValues = 1 << 5,

    // The class derives from a class that has the ABCMeta
    // metaclass. Such classes are allowed to contain
    // @abstractmethod decorators.
    SupportsAbstractMethods = 1 << 6,

    // Derives from property class and has the semantics of
    // a property (with optional setter, deleter).
    PropertyClass = 1 << 7,

    // The class is decorated with a "@final" decorator
    // indicating that it cannot be subclassed.
    Final = 1 << 8,

    // The class derives directly from "Protocol".
    ProtocolClass = 1 << 9,

    // A class whose constructor (__init__ method) does not have
    // annotated types and is treated as though each parameter
    // is a generic type for purposes of type inference.
    PseudoGenericClass = 1 << 10,

    // A protocol class that is "runtime checkable" can be used
    // in an isinstance call.
    RuntimeCheckable = 1 << 11,

    // The type is defined in the typing_extensions.pyi file.
    TypingExtensionClass = 1 << 12,

    // The class type is in the process of being evaluated and
    // is not yet complete. This allows us to detect cases where
    // the class refers to itself (e.g. uses itself as a type
    // argument to one of its generic base classes).
    PartiallyEvaluated = 1 << 13,

    // The class or one of its ancestors defines a __class_getitem__
    // method that is used for subscripting. This is not set if the
    // class is generic, and therefore supports standard subscripting
    // semantics.
    HasCustomClassGetItem = 1 << 14,

    // The tuple class uses a variadic type parameter and requires
    // special-case handling of its type arguments.
    TupleClass = 1 << 15,

    // The class has a metaclass of EnumMeta or derives from
    // a class that has this metaclass.
    EnumClass = 1 << 16,

    // Properties that are defined using the @classmethod decorator.
    ClassProperty = 1 << 17,

    // Class is declared within a type stub file.
    DefinedInStub = 1 << 18,

    // Class does not allow writing or deleting its instance variables
    // through a member access. Used with named tuples.
    ReadOnlyInstanceVariables = 1 << 19,

    // Decorated with @type_check_only.
    TypeCheckOnly = 1 << 20,

    // Created with the NewType call.
    NewTypeClass = 1 << 21,

    // Class is allowed to be used as an implicit type alias even
    // though it is not defined using a `class` statement.
    ValidTypeAliasClass = 1 << 22,

    // A special form is not compatible with type[T] and cannot
    // be directly instantiated.
    SpecialFormClass = 1 << 23,

    // This class is rejected when used as the second argument to
    // an isinstance or issubclass call.
    IllegalIsinstanceClass = 1 << 24,
}

export interface DataClassBehaviors {
    skipGenerateInit?: boolean;
    skipGenerateEq?: boolean;
    generateOrder?: boolean;
    generateSlots?: boolean;
    generateHash?: boolean;
    keywordOnly?: boolean;
    frozen?: boolean;
    frozenDefault?: boolean;
    fieldDescriptorNames: string[];
}

interface ClassDetails {
    name: string;
    fullName: string;
    moduleName: string;
    fileUri: Uri;
    flags: ClassTypeFlags;
    typeSourceId: TypeSourceId;
    baseClasses: Type[];
    mro: (ClassType | AnyType | UnknownType)[];
    declaration?: ClassDeclaration | SpecialBuiltInClassDeclaration | undefined;
    declaredMetaclass?: ClassType | UnknownType | undefined;
    effectiveMetaclass?: ClassType | UnknownType | undefined;
    fields: SymbolTable;
    typeParameters: TypeVarType[];
    typeVarScopeId?: TypeVarScopeId | undefined;
    docString?: string | undefined;
    dataClassEntries?: DataClassEntry[] | undefined;
    dataClassBehaviors?: DataClassBehaviors | undefined;
    typedDictEntries?: TypedDictEntries | undefined;
    localSlotsNames?: string[];

    // If the class is decorated with a @deprecated decorator, this
    // string provides the message to be displayed when the class
    // is used.
    deprecatedMessage?: string | undefined;

    // A cache of protocol classes (indexed by the class full name)
    // that have been determined to be compatible or incompatible
    // with this class. We use "object" here to avoid a circular dependency.
    // It's actually a map of ProtocolCompatibility objects.
    protocolCompatibility?: object;

    // Transforms to apply if this class is used as a metaclass
    // or a base class.
    classDataClassTransform?: DataClassBehaviors | undefined;

    // Indicates that one or more type parameters has an
    // autovariance, so variance must be inferred.
    requiresVarianceInference?: boolean;

    // A cached value that indicates whether an instance of this class
    // is hashable (i.e. does not override "__hash__" with None).
    isInstanceHashable?: boolean;

    // Callback for deferred synthesis of methods in symbol table.
    synthesizeMethodsDeferred?: () => void;

    // Callback for calculating inherited slots names.
    calculateInheritedSlotsNamesDeferred?: () => void;
    inheritedSlotsNamesCached?: string[];
}

export interface TupleTypeArgument {
    type: Type;

    // Does the type argument represent a single value or
    // an "unbounded" (zero or more) arguments?
    isUnbounded: boolean;

    // For tuples captured from a callable, this indicates
    // the corresponding positional parameter has a default
    // argument and can therefore be omitted.
    isOptional?: boolean;
}

export interface PropertyMethodInfo {
    // The decorated function (fget, fset, fdel) for a property
    methodType: FunctionType;

    // The class that declared this function
    classType: ClassType | undefined;
}

export interface ClassType extends TypeBase {
    category: TypeCategory.Class;

    details: ClassDetails;

    // A generic class that has been completely or partially
    // specialized will have type arguments that correspond to
    // some or all of the type parameters.
    typeArguments?: Type[] | undefined;

    // A bool value that has been returned by a user-defined
    // type guard (see PEP 647) will have additional type information
    // that indicates how a type should be narrowed. This field will
    // be used only in a bool class.
    typeGuardType?: Type | undefined;
    isStrictTypeGuard?: boolean;

    // If a generic container class (like a list or dict) is known
    // to contain no elements, its type arguments may be "Unknown".
    // This value allows us to elide the Unknown when it's safe to
    // do so.
    isEmptyContainer?: boolean | undefined;

    // For tuples, the class definition calls for a single type parameter but
    // the spec allows the programmer to provide an arbitrary number of
    // type arguments. This field holds the individual type arguments
    // while the "typeArguments" field holds the derived non-variadic
    // type argument, which is the union of the tuple type arguments.
    tupleTypeArguments?: TupleTypeArgument[] | undefined;

    // We sometimes package multiple types into a tuple internally
    // for matching against a variadic type variable or another unpacked
    // tuple. We need to be able to distinguish this case from normal tuples.
    isUnpacked?: boolean | undefined;

    // If type arguments are present, were they explicit (i.e.
    // provided explicitly in the code)?
    isTypeArgumentExplicit?: boolean | undefined;

    // This class type represents the class and any classes that
    // derive from it, as opposed to the original class only. This
    // distinction is important in certain scenarios like instantiation
    // of abstract or protocol classes.
    includeSubclasses?: boolean;

    // This class type represents the class and any auto-promotion
    // types that PEP 484 indicates should be treated as subclasses
    // when the type appears within a type annotation.
    includePromotions?: boolean;

    // Some types can be further constrained to have
    // literal types (e.g. true or 'string' or 3).
    literalValue?: LiteralValue | undefined;

    // The typing module defines aliases for builtin types
    // (e.g. Tuple, List, Dict). This field holds the alias
    // name.
    aliasName?: string | undefined;

    // Used for "narrowing" of typed dicts where some entries
    // that are not required have been confirmed to be present
    // through the use of a guard expression.
    typedDictNarrowedEntries?: Map<string, TypedDictEntry> | undefined;

    // Indicates that the typed dict class should be considered "partial",
    // i.e. all of its entries are effectively NotRequired and only
    // writable entries are considered present, and they are marked read-only.
    // This is used for the TypedDict "update" method.
    isTypedDictPartial?: boolean;

    // Indicates whether the class is an asymmetric descriptor
    // or property - one where the __get__ and __set__ types differ.
    // If undefined, it hasn't been tested yet for asymmetry.
    isAsymmetricDescriptor?: boolean;

    // Indicates whether the class has an asymmetric __getattr__ and
    // __setattr__ signature.
    isAsymmetricAttributeAccessor?: boolean;

    // Special-case fields for property classes.
    fgetInfo?: PropertyMethodInfo | undefined;
    fsetInfo?: PropertyMethodInfo | undefined;
    fdelInfo?: PropertyMethodInfo | undefined;

    // Provides the deprecated message specifically for instances of
    // the "deprecated" class. This allows these instances to be used
    // as decorators for other classes or functions.
    deprecatedInstanceMessage?: string | undefined;
}

export namespace ClassType {
    export function createInstantiable(
        name: string,
        fullName: string,
        moduleName: string,
        fileUri: Uri,
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
                fileUri,
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
            flags: TypeFlags.Instantiable,
        };

        return newClass;
    }

    export function cloneAsInstance(type: ClassType, includeSubclasses = true): ClassType {
        if (TypeBase.isInstance(type)) {
            return type;
        }

        if (includeSubclasses && type.cached?.typeBaseInstanceType) {
            return type.cached.typeBaseInstanceType as ClassType;
        }

        const newInstance = TypeBase.cloneTypeAsInstance(type, /* cache */ includeSubclasses);
        delete newInstance.specialForm;
        if (includeSubclasses) {
            newInstance.includeSubclasses = true;
        }

        return newInstance;
    }

    export function cloneAsInstantiable(type: ClassType, includeSubclasses = true): ClassType {
        if (includeSubclasses && type.cached?.typeBaseInstantiableType) {
            return type.cached.typeBaseInstantiableType as ClassType;
        }

        const newInstance = TypeBase.cloneTypeAsInstantiable(type, includeSubclasses);
        if (includeSubclasses) {
            newInstance.includeSubclasses = true;
        }

        return newInstance;
    }

    export function cloneForSpecialization(
        classType: ClassType,
        typeArguments: Type[] | undefined,
        isTypeArgumentExplicit: boolean,
        includeSubclasses = false,
        tupleTypeArguments?: TupleTypeArgument[],
        isEmptyContainer?: boolean
    ): ClassType {
        const newClassType = TypeBase.cloneType(classType);

        newClassType.typeArguments = typeArguments?.length === 0 ? undefined : typeArguments;
        newClassType.isTypeArgumentExplicit = isTypeArgumentExplicit;

        if (includeSubclasses) {
            newClassType.includeSubclasses = true;
        }

        newClassType.tupleTypeArguments = tupleTypeArguments ? [...tupleTypeArguments] : undefined;

        if (isEmptyContainer !== undefined) {
            newClassType.isEmptyContainer = isEmptyContainer;
        }

        return newClassType;
    }

    export function cloneIncludeSubclasses(classType: ClassType, includeSubclasses = true) {
        if (!!classType.includeSubclasses === includeSubclasses) {
            return classType;
        }

        const newClassType = TypeBase.cloneType(classType);
        newClassType.includeSubclasses = includeSubclasses;
        return newClassType;
    }

    export function cloneWithLiteral(classType: ClassType, value: LiteralValue | undefined): ClassType {
        const newClassType = TypeBase.cloneType(classType);
        newClassType.literalValue = value;

        // Remove type alias information because the type will no longer match
        // that of the type alias definition if we change the literal type.
        delete newClassType.typeAliasInfo;

        return newClassType;
    }

    export function cloneForDeprecatedInstance(type: ClassType, deprecatedMessage?: string): ClassType {
        const newClassType = TypeBase.cloneType(type);
        newClassType.deprecatedInstanceMessage = deprecatedMessage;
        return newClassType;
    }

    export function cloneForTypingAlias(classType: ClassType, aliasName: string): ClassType {
        const newClassType = TypeBase.cloneType(classType);
        newClassType.aliasName = aliasName;
        return newClassType;
    }

    export function cloneForNarrowedTypedDictEntries(
        classType: ClassType,
        narrowedEntries?: Map<string, TypedDictEntry>
    ): ClassType {
        const newClassType = TypeBase.cloneType(classType);
        newClassType.typedDictNarrowedEntries = narrowedEntries;
        return newClassType;
    }

    export function cloneForPartialTypedDict(classType: ClassType): ClassType {
        const newClassType = TypeBase.cloneType(classType);
        newClassType.isTypedDictPartial = true;
        return newClassType;
    }

    export function cloneRemoveTypePromotions(classType: ClassType): ClassType {
        if (!classType.includePromotions) {
            return classType;
        }

        const newClassType = TypeBase.cloneType(classType);
        delete newClassType.includePromotions;
        return newClassType;
    }

    export function cloneForTypeGuard(
        classType: ClassType,
        typeGuardType: Type,
        isStrictTypeGuard: boolean
    ): ClassType {
        const newClassType = TypeBase.cloneType(classType);
        newClassType.typeGuardType = typeGuardType;
        newClassType.isStrictTypeGuard = isStrictTypeGuard;
        return newClassType;
    }

    export function cloneForSymbolTableUpdate(classType: ClassType): ClassType {
        const newClassType = TypeBase.cloneType(classType);
        newClassType.details = { ...newClassType.details };
        newClassType.details.fields = new Map(newClassType.details.fields);
        newClassType.details.mro = Array.from(newClassType.details.mro);
        newClassType.details.mro[0] = cloneAsInstantiable(newClassType);
        return newClassType;
    }

    export function cloneForUnpacked(classType: ClassType, isUnpacked = true): ClassType {
        const newClassType = TypeBase.cloneType(classType);
        newClassType.isUnpacked = isUnpacked;
        return newClassType;
    }

    export function cloneWithNewFlags(classType: ClassType, newFlags: ClassTypeFlags): ClassType {
        const newClassType = TypeBase.cloneType(classType);
        newClassType.details = { ...newClassType.details };
        newClassType.details.flags = newFlags;
        return newClassType;
    }

    export function isLiteralValueSame(type1: ClassType, type2: ClassType): boolean {
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

    // Determines whether two typed dict classes are equivalent given
    // that one or both have narrowed entries (i.e. entries that are
    // guaranteed to be present).
    export function isTypedDictNarrowedEntriesSame(type1: ClassType, type2: ClassType): boolean {
        if (type1.typedDictNarrowedEntries) {
            if (!type2.typedDictNarrowedEntries) {
                return false;
            }

            const tdEntries1 = type1.typedDictNarrowedEntries;
            const tdEntries2 = type2.typedDictNarrowedEntries;

            if (tdEntries1.size !== tdEntries2.size) {
                return false;
            }

            let key: string;
            let entry1: TypedDictEntry;
            for ([key, entry1] of tdEntries1.entries()) {
                const entry2 = tdEntries2.get(key);
                if (!entry2) {
                    return false;
                }
                if (entry1.isProvided !== entry2.isProvided) {
                    return false;
                }
            }
        } else if (type2.typedDictNarrowedEntries) {
            return false;
        }

        return true;
    }

    // Determines whether typed dict class type1 is a narrower form of type2,
    // i.e. all of the "narrowed entries" found within type2 are also found
    // within type1.
    export function isTypedDictNarrower(type1: ClassType, type2: ClassType): boolean {
        const tdEntries2 = type2.typedDictNarrowedEntries;
        if (!tdEntries2) {
            return true;
        }

        const tdEntries1 = type1.typedDictNarrowedEntries ?? new Map<string, TypedDictEntry>();

        let key: string;
        let entry2: TypedDictEntry;
        for ([key, entry2] of tdEntries2.entries()) {
            if (entry2.isProvided) {
                const entry1 = tdEntries1.get(key);
                if (!entry1?.isProvided) {
                    return false;
                }
            }
        }

        return true;
    }

    // Is the class generic but not specialized?
    export function isUnspecialized(classType: ClassType) {
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

    export function isBuiltIn(classType: ClassType, className?: string | string[]) {
        if (!(classType.details.flags & ClassTypeFlags.BuiltInClass)) {
            return false;
        }

        if (className !== undefined) {
            const classArray = Array.isArray(className) ? className : [className];
            return (
                classArray.some((name) => name === classType.details.name) ||
                classArray.some((name) => name === classType.aliasName)
            );
        }

        return true;
    }

    export function supportsAbstractMethods(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.SupportsAbstractMethods);
    }

    export function isDataClass(classType: ClassType) {
        return !!classType.details.dataClassBehaviors;
    }

    export function isDataClassSkipGenerateInit(classType: ClassType) {
        return !!classType.details.dataClassBehaviors?.skipGenerateInit;
    }

    export function isDataClassSkipGenerateEq(classType: ClassType) {
        return !!classType.details.dataClassBehaviors?.skipGenerateEq;
    }

    export function isDataClassFrozen(classType: ClassType) {
        return !!classType.details.dataClassBehaviors?.frozen;
    }

    export function isDataClassGenerateOrder(classType: ClassType) {
        return !!classType.details.dataClassBehaviors?.generateOrder;
    }

    export function isDataClassKeywordOnly(classType: ClassType) {
        return !!classType.details.dataClassBehaviors?.keywordOnly;
    }

    export function isDataClassGenerateSlots(classType: ClassType) {
        return !!classType.details.dataClassBehaviors?.generateSlots;
    }

    export function isDataClassGenerateHash(classType: ClassType) {
        return !!classType.details.dataClassBehaviors?.generateHash;
    }

    export function isTypeCheckOnly(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.TypeCheckOnly);
    }

    export function isNewTypeClass(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.NewTypeClass);
    }

    export function isValidTypeAliasClass(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.ValidTypeAliasClass);
    }

    export function isSpecialFormClass(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.SpecialFormClass);
    }

    export function isIllegalIsinstanceClass(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.IllegalIsinstanceClass);
    }

    export function isTypedDictClass(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.TypedDictClass);
    }

    export function isCanOmitDictValues(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.CanOmitDictValues);
    }

    export function isTypedDictMarkedClosed(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.TypedDictMarkedClosed);
    }

    export function isTypedDictEffectivelyClosed(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.TypedDictEffectivelyClosed);
    }

    export function isEnumClass(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.EnumClass);
    }

    export function isPropertyClass(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.PropertyClass);
    }

    export function isClassProperty(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.ClassProperty);
    }

    export function isFinal(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.Final);
    }

    export function isProtocolClass(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.ProtocolClass);
    }

    export function isDefinedInStub(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.DefinedInStub);
    }

    export function isPseudoGenericClass(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.PseudoGenericClass);
    }

    export function getDataClassEntries(classType: ClassType): DataClassEntry[] {
        classType.details.synthesizeMethodsDeferred?.();

        return classType.details.dataClassEntries || [];
    }

    export function isRuntimeCheckable(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.RuntimeCheckable);
    }

    export function isTypingExtensionClass(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.TypingExtensionClass);
    }

    export function isPartiallyEvaluated(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.PartiallyEvaluated);
    }

    export function hasCustomClassGetItem(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.HasCustomClassGetItem);
    }

    export function isTupleClass(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.TupleClass);
    }

    export function isReadOnlyInstanceVariables(classType: ClassType) {
        return !!(classType.details.flags & ClassTypeFlags.ReadOnlyInstanceVariables);
    }

    export function getTypeParameters(classType: ClassType) {
        return classType.details.typeParameters;
    }

    export function derivesFromAnyOrUnknown(classType: ClassType) {
        return classType.details.mro.some((baseClass) => isAnyOrUnknown(baseClass));
    }

    export function getSymbolTable(classType: ClassType) {
        classType.details.synthesizeMethodsDeferred?.();

        return classType.details.fields;
    }

    export function getInheritedSlotsNames(classType: ClassType) {
        // First synthesize methods if needed. The slots entries
        // can depend on synthesized methods.
        classType.details.synthesizeMethodsDeferred?.();

        classType.details.calculateInheritedSlotsNamesDeferred?.();

        return classType.details.inheritedSlotsNamesCached;
    }

    // Similar to isPartiallyEvaluated except that it also looks at all of the
    // classes in the MRO list for this class to see if any of them are still
    // partially evaluated.
    export function isHierarchyPartiallyEvaluated(classType: ClassType) {
        return (
            ClassType.isPartiallyEvaluated(classType) ||
            classType.details.mro.some((mroClass) => isClass(mroClass) && ClassType.isPartiallyEvaluated(mroClass))
        );
    }

    // Same as isTypeSame except that it doesn't compare type arguments.
    export function isSameGenericClass(classType: ClassType, type2: ClassType, recursionCount = 0) {
        if (!classType.isTypedDictPartial !== !type2.isTypedDictPartial) {
            return false;
        }

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

        if (recursionCount > maxTypeRecursionCount) {
            return true;
        }
        recursionCount++;

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
            if (
                !isTypeSame(
                    class1Details.baseClasses[i],
                    class2Details.baseClasses[i],
                    { ignorePseudoGeneric: true },
                    recursionCount
                )
            ) {
                return false;
            }
        }

        if (class1Details.declaredMetaclass || class2Details.declaredMetaclass) {
            if (
                !class1Details.declaredMetaclass ||
                !class2Details.declaredMetaclass ||
                !isTypeSame(
                    class1Details.declaredMetaclass,
                    class2Details.declaredMetaclass,
                    { ignorePseudoGeneric: true },
                    recursionCount
                )
            ) {
                return false;
            }
        }

        for (let i = 0; i < class1Details.typeParameters.length; i++) {
            if (
                !isTypeSame(
                    class1Details.typeParameters[i],
                    class2Details.typeParameters[i],
                    { ignorePseudoGeneric: true },
                    recursionCount
                )
            ) {
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
            // Handle literal types.
            if (parentClassType.literalValue !== undefined) {
                if (
                    subclassType.literalValue === undefined ||
                    !ClassType.isLiteralValueSame(parentClassType, subclassType)
                ) {
                    return false;
                }
            }

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

        // Handle the case where both source and dest are property objects. This
        // special case is needed because we synthesize a new class for each
        // property declaration.
        if (ClassType.isBuiltIn(subclassType, 'property') && ClassType.isBuiltIn(parentClassType, 'property')) {
            if (inheritanceChain) {
                inheritanceChain.push(subclassType);
            }
            return true;
        }

        for (const baseClass of subclassType.details.baseClasses) {
            if (isInstantiableClass(baseClass)) {
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

    export function getReverseMro(classType: ClassType): (ClassType | UnknownType | AnyType)[] {
        return classType.details.mro.slice(0).reverse();
    }
}

export interface FunctionParameter {
    category: ParameterCategory;
    name?: string | undefined;
    isNameSynthesized?: boolean;
    hasDefault?: boolean | undefined;
    defaultValueExpression?: ExpressionNode | undefined;
    type: Type;

    isTypeInferred?: boolean | undefined;
    defaultType?: Type | undefined;
    hasDeclaredType?: boolean | undefined;
    typeAnnotation?: ExpressionNode | undefined;
}

export function isPositionOnlySeparator(param: FunctionParameter) {
    // A simple parameter with no name is treated as a "/" separator.
    return param.category === ParameterCategory.Simple && !param.name;
}

export function isKeywordOnlySeparator(param: FunctionParameter) {
    // An *args parameter with no name is treated as a "*" separator.
    return param.category === ParameterCategory.ArgsList && !param.name;
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

    // Decorated with @type_check_only.
    TypeCheckOnly = 1 << 7,

    // Function is decorated with @overload
    Overloaded = 1 << 8,

    // Function is declared with async keyword
    Async = 1 << 9,

    // Function is declared within a type stub fille
    StubDefinition = 1 << 11,

    // Function is declared within a module that claims to be fully typed
    // (i.e. a "py.typed" file is present).
    PyTypedDefinition = 1 << 12,

    // Function is decorated with @final
    Final = 1 << 13,

    // Function has one or more parameters that are missing type annotations
    UnannotatedParams = 1 << 14,

    // The *args and **kwargs parameters do not need to be present for this
    // function to be compatible. This is used for Callable[..., x] and
    // ... type arguments to ParamSpec and Concatenate.
    GradualCallableForm = 1 << 15,

    // This function represents the value bound to a ParamSpec, so its return
    // type is not meaningful.
    ParamSpecValue = 1 << 16,

    // The function type is in the process of being evaluated and
    // is not yet complete. This allows us to detect cases where
    // the function refers to itself (e.g. uses a type annotation
    // that contains a forward reference that requires the function
    // type itself to be evaluated first).
    PartiallyEvaluated = 1 << 17,

    // Decorated with @override as defined in PEP 698.
    Overridden = 1 << 18,

    // Decorated with @no_type_check.
    NoTypeCheck = 1 << 19,
}

interface FunctionDetails {
    name: string;
    fullName: string;
    moduleName: string;
    flags: FunctionTypeFlags;
    typeParameters: TypeVarType[];
    parameters: FunctionParameter[];
    declaredReturnType?: Type | undefined;
    declaration?: FunctionDeclaration | undefined;
    typeVarScopeId?: TypeVarScopeId | undefined;
    builtInName?: string | undefined;
    docString?: string | undefined;
    deprecatedMessage?: string | undefined;

    // If this is a method, this refers to the class that contains it.
    methodClass?: ClassType | undefined;

    // Transforms to apply if this function is used
    // as a decorator.
    decoratorDataClassBehaviors?: DataClassBehaviors | undefined;

    // For __new__ and __init__ methods, the TypeVar scope ID of the
    // associated class.
    constructorTypeVarScopeId?: TypeVarScopeId | undefined;

    // For functions whose parameter lists derive from a solved
    // ParamSpec or higher-order generic functions, this is a list of
    // additional TypeVar IDs that may need to be solved.
    higherOrderTypeVarScopeIds?: TypeVarScopeId[];
}

export interface SpecializedFunctionTypes {
    // Specialized types for each of the parameters in the "parameters" array.
    parameterTypes: Type[];

    // Specialized types of default arguments for each parameter in
    // the "parameters" array. If an entry is undefined or the entire array
    // is missing, there is no specialized type, and the original "defaultType"
    // should be used.
    parameterDefaultArgs?: (Type | undefined)[];

    // Specialized type of the declared return type. Undefined if there is
    // no declared return type.
    returnType?: Type | undefined;
}

export interface CallSiteInferenceTypeCacheEntry {
    paramTypes: Type[];
    returnType: Type;
}

export interface SignatureWithOffsets {
    type: FunctionType | OverloadedFunctionType;
    expressionOffsets: number[];
}

export interface FunctionType extends TypeBase {
    category: TypeCategory.Function;

    details: FunctionDetails;

    // A function type can be specialized (i.e. generic type
    // variables replaced by a concrete type).
    specializedTypes?: SpecializedFunctionTypes | undefined;

    // Inferred return type. Filled in lazily.
    inferredReturnType?: Type | undefined;

    // Call-site return type inference cache.
    callSiteReturnTypeCache?: CallSiteInferenceTypeCacheEntry[];

    // If this is a bound function where the first parameter
    // was stripped from the original unbound function, the
    // (specialized) type of that stripped parameter.
    strippedFirstParamType?: Type | undefined;

    // If this is a bound function where the first parameter
    // was stripped from the original unbound function,
    // the class or object to which the function was bound.
    boundToType?: ClassType | undefined;

    // The flags for the function prior to binding
    preBoundFlags?: FunctionTypeFlags;

    // The type var scope for the class that the function was bound to.
    // This applies only to constructor methods.
    boundTypeVarScopeId?: TypeVarScopeId | undefined;

    // If this function is part of an overloaded function, this
    // refers back to the overloaded function type.
    overloaded?: OverloadedFunctionType;

    // If this function is a callable that was returned by another
    // function call, the signatures of the function that was used
    // for that call and any other signatures that were passed as
    // arguments to it.
    trackedSignatures?: SignatureWithOffsets[];

    // If this function is created with a "Callable" annotation with
    // type arguments? This allows us to detect and report an error
    // when this is used in an isinstance call.
    isCallableWithTypeArgs?: boolean;
}

export namespace FunctionType {
    export function createInstance(
        name: string,
        fullName: string,
        moduleName: string,
        functionFlags: FunctionTypeFlags,
        docString?: string
    ) {
        return create(name, fullName, moduleName, functionFlags, TypeFlags.Instance, docString);
    }

    export function createInstantiable(functionFlags: FunctionTypeFlags, docString?: string) {
        return create('', '', '', functionFlags, TypeFlags.Instantiable, docString);
    }

    export function createSynthesizedInstance(name: string, additionalFlags = FunctionTypeFlags.None) {
        return create(name, '', '', additionalFlags | FunctionTypeFlags.SynthesizedMethod, TypeFlags.Instance);
    }

    function create(
        name: string,
        fullName: string,
        moduleName: string,
        functionFlags: FunctionTypeFlags,
        typeFlags: TypeFlags,
        docString?: string
    ) {
        const newFunctionType: FunctionType = {
            category: TypeCategory.Function,
            details: {
                name,
                fullName,
                moduleName,
                flags: functionFlags,
                parameters: [],
                typeParameters: [],
                docString,
            },
            flags: typeFlags,
        };
        return newFunctionType;
    }

    // Creates a deep copy of the function type, including a fresh
    // version of _functionDetails.
    export function clone(
        type: FunctionType,
        stripFirstParam = false,
        boundToType?: ClassType,
        boundTypeVarScopeId?: TypeVarScopeId
    ): FunctionType {
        const newFunction = TypeBase.cloneType(type);

        newFunction.details = { ...type.details };
        newFunction.preBoundFlags = newFunction.details.flags;
        newFunction.boundToType = boundToType;
        newFunction.boundTypeVarScopeId = boundTypeVarScopeId;

        if (stripFirstParam) {
            if (type.details.parameters.length > 0) {
                if (type.details.parameters[0].category === ParameterCategory.Simple) {
                    if (type.details.parameters.length > 0 && !type.details.parameters[0].isTypeInferred) {
                        // Stash away the effective type of the first parameter if it
                        // wasn't synthesized.
                        newFunction.strippedFirstParamType = getEffectiveParameterType(type, 0);
                    }
                    newFunction.details.parameters = type.details.parameters.slice(1);
                }
            } else {
                stripFirstParam = false;
            }

            // If we strip off the first parameter, this is no longer an
            // instance method or class method.
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
                parameterDefaultArgs: stripFirstParam
                    ? type.specializedTypes.parameterDefaultArgs?.slice(1)
                    : type.specializedTypes.parameterDefaultArgs,
                returnType: type.specializedTypes.returnType,
            };
        }

        newFunction.inferredReturnType = type.inferredReturnType;

        return newFunction;
    }

    export function cloneAsInstance(type: FunctionType): FunctionType {
        if (type.cached?.typeBaseInstanceType) {
            return type.cached.typeBaseInstanceType as FunctionType;
        }

        const newInstance = TypeBase.cloneTypeAsInstance(type, /* cache */ true);
        delete newInstance.specialForm;
        return newInstance;
    }

    export function cloneAsInstantiable(type: FunctionType): FunctionType {
        if (type.cached?.typeBaseInstantiableType) {
            return type.cached.typeBaseInstantiableType as FunctionType;
        }

        const newInstance = TypeBase.cloneTypeAsInstantiable(type, /* cache */ true);
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
        const newFunction = TypeBase.cloneType(type);

        assert(specializedTypes.parameterTypes.length === type.details.parameters.length);
        if (specializedTypes.parameterDefaultArgs) {
            assert(specializedTypes.parameterDefaultArgs.length === type.details.parameters.length);
        }

        newFunction.specializedTypes = specializedTypes;
        newFunction.inferredReturnType = specializedInferredReturnType;

        return newFunction;
    }

    // Creates a new function based on the parameters of another function.
    export function applyParamSpecValue(type: FunctionType, paramSpecValue: FunctionType): FunctionType {
        const hasPositionalOnly = paramSpecValue.details.parameters.some((param) => isPositionOnlySeparator(param));
        const newFunction = FunctionType.cloneRemoveParamSpecArgsKwargs(TypeBase.cloneType(type), hasPositionalOnly);
        const paramSpec = FunctionType.getParamSpecFromArgsKwargs(type);
        assert(paramSpec !== undefined);

        // Make a shallow clone of the details.
        newFunction.details = { ...newFunction.details };

        newFunction.details.typeParameters = newFunction.details.typeParameters.filter(
            (t) => !isTypeSame(t, paramSpec)
        );

        const prevParams = Array.from(newFunction.details.parameters);

        newFunction.details.parameters = [
            ...prevParams,
            ...paramSpecValue.details.parameters.map((param) => {
                return {
                    category: param.category,
                    name: param.name,
                    hasDefault: param.hasDefault,
                    defaultValueExpression: param.defaultValueExpression,
                    isNameSynthesized: param.isNameSynthesized,
                    hasDeclaredType: true,
                    type: param.type,
                };
            }),
        ];

        if (newFunction.details.docString === undefined) {
            newFunction.details.docString = paramSpecValue.details.docString;
        }

        if (newFunction.details.deprecatedMessage === undefined) {
            newFunction.details.deprecatedMessage = paramSpecValue.details.deprecatedMessage;
        }

        const origFlagsMask = FunctionTypeFlags.Overloaded | FunctionTypeFlags.ParamSpecValue;
        newFunction.details.flags = type.details.flags & origFlagsMask;

        const methodFlagsMask =
            FunctionTypeFlags.ClassMethod | FunctionTypeFlags.StaticMethod | FunctionTypeFlags.ConstructorMethod;

        // If the original function was a method, use its method type. Otherwise
        // use the method type of the param spec.
        if (type.details.methodClass) {
            newFunction.details.flags |= type.details.flags & methodFlagsMask;
        } else {
            newFunction.details.flags |= paramSpecValue.details.flags & methodFlagsMask;
        }

        // Use the "..." flag from the param spec.
        newFunction.details.flags |= paramSpecValue.details.flags & FunctionTypeFlags.GradualCallableForm;

        // Mark the function as synthesized since there is no user-defined declaration for it.
        newFunction.details.flags |= FunctionTypeFlags.SynthesizedMethod;
        delete newFunction.details.declaration;

        // Update the specialized parameter types as well.
        const specializedTypes = newFunction.specializedTypes;
        if (specializedTypes) {
            paramSpecValue.details.parameters.forEach((paramInfo) => {
                specializedTypes.parameterTypes.push(paramInfo.type);

                // Assume that the parameters introduced via paramSpec have no specialized
                // default arg types. Fall back on the original default arg type in this case.
                specializedTypes.parameterDefaultArgs?.push(undefined);
            });
        }

        FunctionType.addHigherOrderTypeVarScopeIds(newFunction, paramSpecValue.details.typeVarScopeId);
        FunctionType.addHigherOrderTypeVarScopeIds(newFunction, paramSpecValue.details.higherOrderTypeVarScopeIds);
        newFunction.details.constructorTypeVarScopeId = paramSpecValue.details.constructorTypeVarScopeId;

        if (!newFunction.details.methodClass && paramSpecValue.details.methodClass) {
            newFunction.details.methodClass = paramSpecValue.details.methodClass;
        }

        return newFunction;
    }

    export function cloneWithNewFlags(type: FunctionType, flags: FunctionTypeFlags): FunctionType {
        const newFunction = TypeBase.cloneType(type);

        // Make a shallow clone of the details.
        newFunction.details = { ...type.details };
        newFunction.details.flags = flags;

        return newFunction;
    }

    export function cloneWithNewTypeVarScopeId(
        type: FunctionType,
        newScopeId: TypeVarScopeId,
        typeParameters: TypeVarType[],
        trackedSignatures?: SignatureWithOffsets[]
    ): FunctionType {
        const newFunction = TypeBase.cloneType(type);

        // Make a shallow clone of the details.
        newFunction.details = { ...type.details };
        newFunction.details.typeVarScopeId = newScopeId;
        newFunction.details.typeParameters = typeParameters;
        newFunction.trackedSignatures = trackedSignatures;

        FunctionType.addHigherOrderTypeVarScopeIds(
            newFunction,
            typeParameters.map((t) => t.scopeId)
        );

        return newFunction;
    }

    export function cloneWithDocString(type: FunctionType, docString?: string): FunctionType {
        const newFunction = TypeBase.cloneType(type);

        // Make a shallow clone of the details.
        newFunction.details = { ...type.details };

        newFunction.details.docString = docString;

        return newFunction;
    }

    export function cloneWithDeprecatedMessage(type: FunctionType, deprecatedMessage?: string): FunctionType {
        const newFunction = TypeBase.cloneType(type);

        // Make a shallow clone of the details.
        newFunction.details = { ...type.details };

        newFunction.details.deprecatedMessage = deprecatedMessage;

        return newFunction;
    }

    // If the function ends with "*args: P.args, **kwargs: P.kwargs", this function
    // returns a new function that is a clone of the input function with the
    // *args and **kwargs parameters removed. If stripPositionOnlySeparator is true,
    // a trailing positional-only separator will be removed.
    export function cloneRemoveParamSpecArgsKwargs(
        type: FunctionType,
        stripPositionOnlySeparator = false
    ): FunctionType {
        const paramCount = type.details.parameters.length;
        if (paramCount < 2) {
            return type;
        }

        const argsParam = type.details.parameters[paramCount - 2];
        const kwargsParam = type.details.parameters[paramCount - 1];

        if (
            argsParam.category !== ParameterCategory.ArgsList ||
            kwargsParam.category !== ParameterCategory.KwargsDict
        ) {
            return type;
        }

        const argsType = FunctionType.getEffectiveParameterType(type, paramCount - 2);
        const kwargsType = FunctionType.getEffectiveParameterType(type, paramCount - 1);
        if (!isParamSpec(argsType) || !isParamSpec(kwargsType) || !isTypeSame(argsType, kwargsType)) {
            return type;
        }

        const newFunction = TypeBase.cloneType(type);

        // Make a shallow clone of the details.
        newFunction.details = { ...type.details };
        const details = newFunction.details;

        let paramsToDrop = 2;

        // If the last remaining parameter is a position-only separator, remove it as well.
        // Always remove it if it's the only remaining parameter.
        if (paramCount >= 3 && isPositionOnlySeparator(details.parameters[paramCount - 3])) {
            if (paramCount === 3 || stripPositionOnlySeparator) {
                paramsToDrop = 3;
            }
        }

        // Remove the last parameters, which are the *args and **kwargs.
        details.parameters = details.parameters.slice(0, details.parameters.length - paramsToDrop);

        if (type.specializedTypes) {
            newFunction.specializedTypes = { ...type.specializedTypes };
            newFunction.specializedTypes.parameterTypes = newFunction.specializedTypes.parameterTypes.slice(
                0,
                newFunction.specializedTypes.parameterTypes.length - paramsToDrop
            );
            if (newFunction.specializedTypes.parameterDefaultArgs) {
                newFunction.specializedTypes.parameterDefaultArgs =
                    newFunction.specializedTypes.parameterDefaultArgs.slice(
                        0,
                        newFunction.specializedTypes.parameterDefaultArgs.length - paramsToDrop
                    );
            }
        }

        if (type.inferredReturnType) {
            newFunction.inferredReturnType = type.inferredReturnType;
        }

        return newFunction;
    }

    // If the function ends with "*args: P.args, **kwargs: P.kwargs", this function
    // returns P. Otherwise, it returns undefined.
    export function getParamSpecFromArgsKwargs(type: FunctionType): TypeVarType | undefined {
        const params = type.details.parameters;
        if (params.length < 2) {
            return undefined;
        }

        const secondLastParam = params[params.length - 2];
        const lastParam = params[params.length - 1];

        if (
            secondLastParam.category === ParameterCategory.ArgsList &&
            isTypeVar(secondLastParam.type) &&
            secondLastParam.type.paramSpecAccess === 'args' &&
            lastParam.category === ParameterCategory.KwargsDict &&
            isTypeVar(lastParam.type) &&
            lastParam.type.paramSpecAccess === 'kwargs'
        ) {
            return TypeVarType.cloneForParamSpecAccess(secondLastParam.type, /* access */ undefined);
        }

        return undefined;
    }

    export function addParamSpecVariadics(type: FunctionType, paramSpec: TypeVarType) {
        FunctionType.addParameter(type, {
            category: ParameterCategory.ArgsList,
            name: 'args',
            type: TypeVarType.cloneForParamSpecAccess(paramSpec, 'args'),
            hasDeclaredType: true,
        });

        FunctionType.addParameter(type, {
            category: ParameterCategory.KwargsDict,
            name: 'kwargs',
            type: TypeVarType.cloneForParamSpecAccess(paramSpec, 'kwargs'),
            hasDeclaredType: true,
        });
    }

    export function addDefaultParameters(type: FunctionType, useUnknown = false) {
        getDefaultParameters(useUnknown).forEach((param) => {
            FunctionType.addParameter(type, param);
        });
    }

    export function addHigherOrderTypeVarScopeIds(
        functionType: FunctionType,
        scopeIds: (TypeVarScopeId | undefined)[] | TypeVarScopeId | undefined
    ) {
        if (!scopeIds) {
            return;
        }

        if (!Array.isArray(scopeIds)) {
            scopeIds = [scopeIds];
        }

        if (!functionType.details.higherOrderTypeVarScopeIds) {
            functionType.details.higherOrderTypeVarScopeIds = [];
        }

        // Add the scope IDs to the function if they're unique.
        scopeIds.forEach((scopeId) => {
            if (!scopeId || scopeId === functionType.details.typeVarScopeId) {
                return;
            }

            if (!functionType.details.higherOrderTypeVarScopeIds!.some((id) => id === scopeId)) {
                functionType.details.higherOrderTypeVarScopeIds!.push(scopeId);
            }
        });
    }

    export function getDefaultParameters(useUnknown = false): FunctionParameter[] {
        return [
            {
                category: ParameterCategory.ArgsList,
                name: 'args',
                type: useUnknown ? UnknownType.create() : AnyType.create(),
                hasDeclaredType: !useUnknown,
            },
            {
                category: ParameterCategory.KwargsDict,
                name: 'kwargs',
                type: useUnknown ? UnknownType.create() : AnyType.create(),
                hasDeclaredType: !useUnknown,
            },
        ];
    }

    // Indicates whether the input signature consists of (*args: Any, **kwargs: Any).
    export function hasDefaultParameters(functionType: FunctionType): boolean {
        let sawArgs = false;
        let sawKwargs = false;

        for (let i = 0; i < functionType.details.parameters.length; i++) {
            const param = functionType.details.parameters[i];

            // Ignore nameless separator parameters.
            if (!param.name) {
                continue;
            }

            if (param.category === ParameterCategory.Simple) {
                return false;
            } else if (param.category === ParameterCategory.ArgsList) {
                sawArgs = true;
            } else if (param.category === ParameterCategory.KwargsDict) {
                sawKwargs = true;
            }

            if (!isAnyOrUnknown(FunctionType.getEffectiveParameterType(functionType, i))) {
                return false;
            }
        }

        return sawArgs && sawKwargs;
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

    export function isTypeCheckOnly(type: FunctionType): boolean {
        return (type.details.flags & FunctionTypeFlags.TypeCheckOnly) !== 0;
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

    export function isGradualCallableForm(type: FunctionType) {
        return (type.details.flags & FunctionTypeFlags.GradualCallableForm) !== 0;
    }

    export function isParamSpecValue(type: FunctionType) {
        return (type.details.flags & FunctionTypeFlags.ParamSpecValue) !== 0;
    }

    export function isPartiallyEvaluated(type: FunctionType) {
        return !!(type.details.flags & FunctionTypeFlags.PartiallyEvaluated);
    }

    export function isOverridden(type: FunctionType) {
        return !!(type.details.flags & FunctionTypeFlags.Overridden);
    }

    export function getEffectiveParameterType(type: FunctionType, index: number): Type {
        assert(index < type.details.parameters.length, 'Parameter types array overflow');

        if (type.specializedTypes && index < type.specializedTypes.parameterTypes.length) {
            return type.specializedTypes.parameterTypes[index];
        }

        return type.details.parameters[index].type;
    }

    export function getEffectiveParameterDefaultArgType(type: FunctionType, index: number): Type | undefined {
        assert(index < type.details.parameters.length, 'Parameter types array overflow');

        if (type.specializedTypes?.parameterDefaultArgs && index < type.specializedTypes.parameterDefaultArgs.length) {
            const defaultArgType = type.specializedTypes.parameterDefaultArgs[index];
            if (defaultArgType) {
                return defaultArgType;
            }
        }

        return type.details.parameters[index].defaultType;
    }

    export function addParameter(type: FunctionType, param: FunctionParameter) {
        type.details.parameters.push(param);

        if (type.specializedTypes) {
            type.specializedTypes.parameterTypes.push(param.type);
        }
    }

    export function addPositionOnlyParameterSeparator(type: FunctionType) {
        addParameter(type, {
            category: ParameterCategory.Simple,
            type: AnyType.create(),
        });
    }

    export function addKeywordOnlyParameterSeparator(type: FunctionType) {
        addParameter(type, {
            category: ParameterCategory.ArgsList,
            type: AnyType.create(),
        });
    }

    export function getEffectiveReturnType(type: FunctionType, includeInferred = true) {
        if (type.specializedTypes?.returnType) {
            return type.specializedTypes.returnType;
        }

        if (type.details.declaredReturnType) {
            return type.details.declaredReturnType;
        }

        if (includeInferred) {
            return type.inferredReturnType;
        }

        return undefined;
    }
}

export interface OverloadedFunctionType extends TypeBase {
    category: TypeCategory.OverloadedFunction;
    overloads: FunctionType[];
}

export namespace OverloadedFunctionType {
    export function create(overloads: FunctionType[]) {
        const newType: OverloadedFunctionType = {
            category: TypeCategory.OverloadedFunction,
            overloads: [],
            flags: TypeFlags.Instance,
        };

        overloads.forEach((overload) => {
            OverloadedFunctionType.addOverload(newType, overload);
        });

        return newType;
    }

    // Adds a new overload or an implementation.
    export function addOverload(type: OverloadedFunctionType, functionType: FunctionType) {
        functionType.overloaded = type;
        type.overloads.push(functionType);
    }

    export function getOverloads(type: OverloadedFunctionType): FunctionType[] {
        return type.overloads.filter((func) => FunctionType.isOverloaded(func));
    }

    export function getImplementation(type: OverloadedFunctionType): FunctionType | undefined {
        return type.overloads.find((func) => !FunctionType.isOverloaded(func));
    }
}

export interface NeverType extends TypeBase {
    category: TypeCategory.Never;
    isNoReturn: boolean;
}

export namespace NeverType {
    const _neverInstance: NeverType = {
        category: TypeCategory.Never,
        flags: TypeFlags.Instance | TypeFlags.Instantiable,
        isNoReturn: false,
    };

    const _noReturnInstance: NeverType = {
        category: TypeCategory.Never,
        flags: TypeFlags.Instance | TypeFlags.Instantiable,
        isNoReturn: true,
    };

    export function createNever() {
        return _neverInstance;
    }

    export function createNoReturn() {
        return _noReturnInstance;
    }

    export function convertToInstance(type: NeverType): NeverType {
        // Remove the "special form" if present. Otherwise return the existing type.
        if (!type.specialForm) {
            return type;
        }

        return type.isNoReturn ? NeverType.createNoReturn() : NeverType.createNever();
    }
}

export interface AnyType extends TypeBase {
    category: TypeCategory.Any;
    isEllipsis: boolean;
}

export namespace AnyType {
    const _anyInstanceSpecialForm: AnyType = {
        category: TypeCategory.Any,
        isEllipsis: false,
        flags: TypeFlags.Instance | TypeFlags.Instantiable,
    };

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

    export function createSpecialForm() {
        return _anyInstanceSpecialForm;
    }
}

export namespace AnyType {
    export function convertToInstance(type: AnyType): AnyType {
        // Remove the "special form" if present. Otherwise return the existing type.
        return type.specialForm ? AnyType.create() : type;
    }
}

// References a single condition associated with a constrained TypeVar.
export interface TypeCondition {
    typeVar: TypeVarType;
    constraintIndex: number;
}

export namespace TypeCondition {
    export function combine(
        conditions1: TypeCondition[] | undefined,
        conditions2: TypeCondition[] | undefined
    ): TypeCondition[] | undefined {
        if (!conditions1) {
            return conditions2;
        }

        if (!conditions2) {
            return conditions1;
        }

        // Deduplicate the lists.
        const combined = Array.from(conditions1);
        conditions2.forEach((c1) => {
            if (!combined.some((c2) => _compare(c1, c2) === 0)) {
                combined.push(c1);
            }
        });

        // Always keep the conditions sorted for easier comparison.
        return combined.sort(_compare);
    }

    function _compare(c1: TypeCondition, c2: TypeCondition) {
        if (c1.typeVar.details.name < c2.typeVar.details.name) {
            return -1;
        } else if (c1.typeVar.details.name > c2.typeVar.details.name) {
            return 1;
        }
        if (c1.constraintIndex < c2.constraintIndex) {
            return -1;
        } else if (c1.constraintIndex > c2.constraintIndex) {
            return 1;
        }
        return 0;
    }

    export function isSame(
        conditions1: TypeCondition[] | undefined,
        conditions2: TypeCondition[] | undefined
    ): boolean {
        if (!conditions1) {
            return !conditions2;
        }

        if (!conditions2 || conditions1.length !== conditions2.length) {
            return false;
        }

        return (
            conditions1.find(
                (c1, index) =>
                    c1.typeVar.nameWithScope !== conditions2[index].typeVar.nameWithScope ||
                    c1.constraintIndex !== conditions2[index].constraintIndex
            ) === undefined
        );
    }

    // Determines if the two conditions can be used at the same time. If
    // one constraint list contains a constraint for a type variable, and the
    // same constraint is not in the other constraint list, the two are considered
    // incompatible.
    export function isCompatible(
        conditions1: TypeCondition[] | undefined,
        conditions2: TypeCondition[] | undefined
    ): boolean {
        if (!conditions1 || !conditions2) {
            return true;
        }

        for (const c1 of conditions1) {
            let foundTypeVarMatch = false;
            const exactMatch = conditions2.find((c2) => {
                if (c1.typeVar.nameWithScope === c2.typeVar.nameWithScope) {
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

export interface LiteralTypes {
    literalStrMap?: Map<string, UnionableType> | undefined;
    literalIntMap?: Map<bigint | number, UnionableType> | undefined;
    literalEnumMap?: Map<string, UnionableType> | undefined;
}

export interface UnionType extends TypeBase {
    category: TypeCategory.Union;
    subtypes: UnionableType[];
    literalInstances: LiteralTypes;
    literalClasses: LiteralTypes;
    typeAliasSources?: Set<UnionType>;
    includesRecursiveTypeAlias?: boolean;
}

export namespace UnionType {
    export function create() {
        const newUnionType: UnionType = {
            category: TypeCategory.Union,
            subtypes: [],
            literalInstances: {},
            literalClasses: {},
            flags: TypeFlags.Instance | TypeFlags.Instantiable,
        };

        return newUnionType;
    }

    export function addType(unionType: UnionType, newType: UnionableType) {
        // If we're adding a string, integer or enum literal, add it to the
        // corresponding literal map to speed up some operations. It's not
        // uncommon for unions to contain hundreds of literals.
        if (isClass(newType) && newType.literalValue !== undefined && newType.condition === undefined) {
            const literalMaps = isClassInstance(newType) ? unionType.literalInstances : unionType.literalClasses;

            if (ClassType.isBuiltIn(newType, 'str')) {
                if (literalMaps.literalStrMap === undefined) {
                    literalMaps.literalStrMap = new Map<string, UnionableType>();
                }
                literalMaps.literalStrMap.set(newType.literalValue as string, newType);
            } else if (ClassType.isBuiltIn(newType, 'int')) {
                if (literalMaps.literalIntMap === undefined) {
                    literalMaps.literalIntMap = new Map<bigint | number, UnionableType>();
                }
                literalMaps.literalIntMap.set(newType.literalValue as number | bigint, newType);
            } else if (ClassType.isEnumClass(newType)) {
                if (literalMaps.literalEnumMap === undefined) {
                    literalMaps.literalEnumMap = new Map<string, UnionableType>();
                }
                const enumLiteral = newType.literalValue as EnumLiteral;
                literalMaps.literalEnumMap.set(enumLiteral.getName(), newType);
            }
        }

        unionType.flags &= newType.flags;
        unionType.subtypes.push(newType);

        if (isTypeVar(newType) && newType.details.recursiveTypeAliasName) {
            // Note that at least one recursive type alias was included in
            // this union. We'll need to expand it before the union is used.
            unionType.includesRecursiveTypeAlias = true;
        }
    }

    // Determines whether the union contains a specified subtype. If exclusionSet is passed,
    // the method skips any subtype indexes that are in the set and adds a found index to
    // the exclusion set. This speeds up union type comparisons.
    export function containsType(
        unionType: UnionType,
        subtype: Type,
        exclusionSet?: Set<number>,
        recursionCount = 0
    ): boolean {
        // Handle string literals as a special case because unions can sometimes
        // contain hundreds of string literal types.
        if (isClass(subtype) && subtype.condition === undefined && subtype.literalValue !== undefined) {
            const literalMaps = isClassInstance(subtype) ? unionType.literalInstances : unionType.literalClasses;

            if (ClassType.isBuiltIn(subtype, 'str') && literalMaps.literalStrMap !== undefined) {
                return literalMaps.literalStrMap.has(subtype.literalValue as string);
            } else if (ClassType.isBuiltIn(subtype, 'int') && literalMaps.literalIntMap !== undefined) {
                return literalMaps.literalIntMap.has(subtype.literalValue as number | bigint);
            } else if (ClassType.isEnumClass(subtype) && literalMaps.literalEnumMap !== undefined) {
                const enumLiteral = subtype.literalValue as EnumLiteral;
                return literalMaps.literalEnumMap.has(enumLiteral.getName());
            }
        }

        const foundIndex = unionType.subtypes.findIndex((t, i) => {
            if (exclusionSet?.has(i)) {
                return false;
            }

            return isTypeSame(t, subtype, {}, recursionCount);
        });

        if (foundIndex < 0) {
            return false;
        }

        exclusionSet?.add(foundIndex);
        return true;
    }

    export function addTypeAliasSource(unionType: UnionType, typeAliasSource: Type) {
        if (typeAliasSource.category === TypeCategory.Union) {
            const sourcesToAdd = typeAliasSource.typeAliasInfo ? [typeAliasSource] : typeAliasSource.typeAliasSources;

            if (sourcesToAdd) {
                if (!unionType.typeAliasSources) {
                    unionType.typeAliasSources = new Set<UnionType>();
                }

                sourcesToAdd.forEach((source) => {
                    unionType.typeAliasSources!.add(source);
                });
            }
        }
    }
}

export const enum Variance {
    Auto,
    Unknown,
    Invariant,
    Covariant,
    Contravariant,
}

export interface TypeVarDetails {
    name: string;
    constraints: Type[];
    boundType?: Type | undefined;
    isDefaultExplicit?: boolean;
    defaultType: Type;

    isParamSpec: boolean;
    isVariadic: boolean;

    declaredVariance: Variance;

    // Internally created (e.g. for pseudo-generic classes)
    isSynthesized: boolean;
    isSynthesizedSelf?: boolean | undefined;
    synthesizedIndex?: number | undefined;
    isExemptFromBoundCheck?: boolean;

    // Does this type variable originate from PEP 695 type parameter syntax?
    isTypeParamSyntax?: boolean;

    // Used for recursive type aliases.
    recursiveTypeAliasName?: string | undefined;
    recursiveTypeAliasScopeId?: TypeVarScopeId | undefined;
    recursiveTypeAliasIsPep695Syntax?: boolean;

    // Type parameters for a recursive type alias.
    recursiveTypeParameters?: TypeVarType[] | undefined;
}

export type ParamSpecAccess = 'args' | 'kwargs';

export const enum TypeVarScopeType {
    Class,
    Function,
    TypeAlias,
}

export interface TypeVarType extends TypeBase {
    category: TypeCategory.TypeVar;
    details: TypeVarDetails;

    // An ID that uniquely identifies the scope to which this TypeVar is bound
    scopeId?: TypeVarScopeId | undefined;

    // A human-readable name of the function, class, or type alias that
    // provides the scope to which this type variable is bound. Unlike the
    // scopeId, this might not be unique, so it should be used only for error
    // messages.
    scopeName?: string | undefined;

    // If the TypeVar is bound to a scope, this is the scope type
    scopeType?: TypeVarScopeType;

    // String formatted as <name>.<scopeId>
    nameWithScope?: string | undefined;

    // Is this variadic TypeVar unpacked (i.e. Unpack or * operator applied)?
    isVariadicUnpacked?: boolean | undefined;

    // Is this variadic TypeVar included in a Union[]? This allows us to
    // differentiate between Unpack[Vs] and Union[Unpack[Vs]].
    isVariadicInUnion?: boolean | undefined;

    // Represents access to "args" or "kwargs" of a ParamSpec
    paramSpecAccess?: ParamSpecAccess;

    // May be different from declaredVariance if declared as Auto
    computedVariance?: Variance;

    // When an out-of-scope TypeVar appears within an expected type during
    // bidirectional type inference, it needs to be solved along with the
    // in-scope TypeVars. This is done by cloning the out-of-scope TypeVar
    // and effectively making it in-scope.
    isInScopePlaceholder?: boolean;
}

export namespace TypeVarType {
    export function createInstance(name: string) {
        return create(name, /* isParamSpec */ false, TypeFlags.Instance);
    }

    export function createInstantiable(name: string, isParamSpec = false) {
        return create(name, isParamSpec, TypeFlags.Instantiable);
    }

    export function cloneAsInstance(type: TypeVarType): TypeVarType {
        assert(TypeBase.isInstantiable(type));

        if (type.cached?.typeBaseInstanceType) {
            return type.cached.typeBaseInstanceType as TypeVarType;
        }

        const newInstance = TypeBase.cloneTypeAsInstance(type, /* cache */ true);
        delete newInstance.specialForm;
        return newInstance;
    }

    export function cloneAsInstantiable(type: TypeVarType): TypeVarType {
        if (type.cached?.typeBaseInstantiableType) {
            return type.cached.typeBaseInstantiableType as TypeVarType;
        }

        const newInstance = TypeBase.cloneTypeAsInstantiable(type, /* cache */ true);
        return newInstance;
    }

    export function cloneForNewName(type: TypeVarType, name: string): TypeVarType {
        const newInstance = TypeBase.cloneType(type);
        newInstance.details = { ...type.details };
        newInstance.details.name = name;

        if (newInstance.scopeId) {
            newInstance.nameWithScope = makeNameWithScope(name, newInstance.scopeId);
        }

        return newInstance;
    }

    export function cloneForScopeId(
        type: TypeVarType,
        scopeId: string,
        scopeName: string,
        scopeType: TypeVarScopeType
    ): TypeVarType {
        const newInstance = TypeBase.cloneType(type);
        newInstance.nameWithScope = makeNameWithScope(type.details.name, scopeId);
        newInstance.scopeId = scopeId;
        newInstance.scopeName = scopeName;
        newInstance.scopeType = scopeType;
        return newInstance;
    }

    export function cloneForUnpacked(type: TypeVarType, isInUnion = false) {
        assert(type.details.isVariadic);
        const newInstance = TypeBase.cloneType(type);
        newInstance.isVariadicUnpacked = true;
        newInstance.isVariadicInUnion = isInUnion;
        return newInstance;
    }

    export function cloneForPacked(type: TypeVarType) {
        assert(type.details.isVariadic);
        const newInstance = TypeBase.cloneType(type);
        newInstance.isVariadicUnpacked = false;
        newInstance.isVariadicInUnion = false;
        return newInstance;
    }

    // Creates a "simplified" version of the TypeVar with invariance
    // and no bound or constraints. ParamSpecs and variadics are left
    // unmodified. So are auto-variant type variables.
    export function cloneAsInvariant(type: TypeVarType): TypeVarType {
        if (type.details.isParamSpec || type.details.isVariadic) {
            return type;
        }

        if (type.details.declaredVariance === Variance.Auto) {
            return type;
        }

        if (type.details.declaredVariance === Variance.Invariant) {
            if (type.details.boundType === undefined && type.details.constraints.length === 0) {
                return type;
            }
        }

        const newInstance = TypeBase.cloneType(type);
        newInstance.details = { ...newInstance.details };
        newInstance.details.declaredVariance = Variance.Invariant;
        newInstance.details.boundType = undefined;
        newInstance.details.constraints = [];
        return newInstance;
    }

    export function cloneForParamSpecAccess(type: TypeVarType, access: ParamSpecAccess | undefined): TypeVarType {
        const newInstance = TypeBase.cloneType(type);
        newInstance.paramSpecAccess = access;
        return newInstance;
    }

    export function cloneAsSpecializedSelf(type: TypeVarType, specializedBoundType: Type): TypeVarType {
        assert(type.details.isSynthesizedSelf);
        const newInstance = TypeBase.cloneType(type);
        newInstance.details = { ...newInstance.details };
        newInstance.details.boundType = specializedBoundType;
        return newInstance;
    }

    export function cloneAsInScopePlaceholder(type: TypeVarType, usageOffset?: number): TypeVarType {
        if (type.isInScopePlaceholder) {
            return type;
        }

        // If the caller specified a usage offset, append it to the TypeVar
        // internal name. This allows us to distinguish it from other uses
        // of the same TypeVar. For example nested calls to a generic
        // function like `foo(foo(1))`.
        let newNameWithScope = type.nameWithScope;
        if (usageOffset) {
            newNameWithScope = `${type.nameWithScope}-${usageOffset}`;
        }

        const newInstance = TypeBase.cloneType(type);
        newInstance.isInScopePlaceholder = true;
        newInstance.scopeId = InScopePlaceholderScopeId;
        newInstance.nameWithScope = newNameWithScope;
        return newInstance;
    }

    export function makeNameWithScope(name: string, scopeId: string) {
        return `${name}.${scopeId}`;
    }

    function create(name: string, isParamSpec: boolean, typeFlags: TypeFlags): TypeVarType {
        const newTypeVarType: TypeVarType = {
            category: TypeCategory.TypeVar,
            details: {
                name,
                constraints: [],
                declaredVariance: Variance.Invariant,
                isParamSpec,
                isVariadic: false,
                isSynthesized: false,
                defaultType: UnknownType.create(),
            },
            flags: typeFlags,
        };
        return newTypeVarType;
    }

    export function addConstraint(typeVarType: TypeVarType, constraintType: Type) {
        typeVarType.details.constraints.push(constraintType);
    }

    export function getNameWithScope(typeVarType: TypeVarType) {
        // If there is no name with scope, fall back on the (unscoped) name.
        return typeVarType.nameWithScope || typeVarType.details.name;
    }

    export function getReadableName(typeVarType: TypeVarType) {
        if (typeVarType.scopeName) {
            return `${typeVarType.details.name}@${typeVarType.scopeName}`;
        }

        return typeVarType.details.name;
    }

    export function getVariance(type: TypeVarType) {
        const variance = type.computedVariance ?? type.details.declaredVariance;

        // By this point, the variance should have been inferred.
        assert(variance !== Variance.Auto, 'Expected variance to be inferred');

        // If we're in the process of computing variance, it will still be
        // unknown. Default to covariant in this case.
        if (variance === Variance.Unknown) {
            return Variance.Covariant;
        }

        return variance;
    }

    // Indicates whether the specified type is a recursive type alias
    // placeholder that has not yet been resolved.
    export function isTypeAliasPlaceholder(type: TypeVarType) {
        return !!type.details.recursiveTypeAliasName && !type.details.boundType;
    }
}

export function isNever(type: Type): type is NeverType {
    return type.category === TypeCategory.Never;
}

export function isAny(type: Type): type is AnyType {
    return type.category === TypeCategory.Any;
}

export function isUnknown(type: Type): type is UnknownType {
    return type.category === TypeCategory.Unknown;
}

export function isAnyOrUnknown(type: Type): type is AnyType | UnknownType {
    if (type.category === TypeCategory.Any || type.category === TypeCategory.Unknown) {
        return true;
    }

    if (isUnion(type)) {
        return type.subtypes.find((subtype) => !isAnyOrUnknown(subtype)) === undefined;
    }

    return false;
}

export function isUnbound(type: Type): type is UnboundType {
    return type.category === TypeCategory.Unbound;
}

export function isUnion(type: Type): type is UnionType {
    return type.category === TypeCategory.Union;
}

export function isPossiblyUnbound(type: Type): boolean {
    if (isUnbound(type)) {
        return true;
    }

    if (isUnion(type)) {
        return type.subtypes.find((subtype) => isPossiblyUnbound(subtype)) !== undefined;
    }

    return false;
}

export function isClass(type: Type): type is ClassType {
    return type.category === TypeCategory.Class;
}

export function isInstantiableClass(type: Type): type is ClassType {
    return type.category === TypeCategory.Class && TypeBase.isInstantiable(type);
}

export function isClassInstance(type: Type): type is ClassType {
    return type.category === TypeCategory.Class && TypeBase.isInstance(type);
}

export function isModule(type: Type): type is ModuleType {
    return type.category === TypeCategory.Module;
}

export function isTypeVar(type: Type): type is TypeVarType {
    return type.category === TypeCategory.TypeVar;
}

export function isVariadicTypeVar(type: Type): type is TypeVarType {
    return type.category === TypeCategory.TypeVar && type.details.isVariadic;
}

export function isUnpackedVariadicTypeVar(type: Type): boolean {
    return (
        type.category === TypeCategory.TypeVar &&
        type.details.isVariadic &&
        !!type.isVariadicUnpacked &&
        !type.isVariadicInUnion
    );
}

export function isUnpackedClass(type: Type): type is ClassType {
    if (!isClass(type) || !type.isUnpacked) {
        return false;
    }

    return true;
}

export function isUnpacked(type: Type): boolean {
    return isUnpackedVariadicTypeVar(type) || isUnpackedClass(type);
}

export function isParamSpec(type: Type): type is TypeVarType {
    return type.category === TypeCategory.TypeVar && type.details.isParamSpec;
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

// Determines whether two types are the same. If ignorePseudoGeneric is true,
// type arguments for "pseudo-generic" classes (non-generic classes whose init
// methods are not annotated and are therefore treated as generic) are ignored.
export function isTypeSame(type1: Type, type2: Type, options: TypeSameOptions = {}, recursionCount = 0): boolean {
    if (type1 === type2) {
        return true;
    }

    if (type1.category !== type2.category) {
        if (options.treatAnySameAsUnknown) {
            if (type1.category === TypeCategory.Any && type2.category === TypeCategory.Unknown) {
                return true;
            }
            if (type1.category === TypeCategory.Unknown && type2.category === TypeCategory.Any) {
                return true;
            }
        }

        return false;
    }

    if (!options.ignoreTypeFlags) {
        if (type1.flags !== type2.flags) {
            return false;
        }
    }

    if (recursionCount > maxTypeRecursionCount) {
        return true;
    }
    recursionCount++;

    switch (type1.category) {
        case TypeCategory.Class: {
            const classType2 = type2 as ClassType;

            // If the details are not the same it's not the same class.
            if (!ClassType.isSameGenericClass(type1, classType2, recursionCount)) {
                return false;
            }

            if (!options.ignoreConditions && !TypeCondition.isSame(type1.condition, type2.condition)) {
                return false;
            }

            if (!options.ignorePseudoGeneric || !ClassType.isPseudoGenericClass(type1)) {
                // Make sure the type args match.
                if (type1.tupleTypeArguments && classType2.tupleTypeArguments) {
                    const type1TupleTypeArgs = type1.tupleTypeArguments || [];
                    const type2TupleTypeArgs = classType2.tupleTypeArguments || [];
                    if (type1TupleTypeArgs.length !== type2TupleTypeArgs.length) {
                        return false;
                    }

                    for (let i = 0; i < type1TupleTypeArgs.length; i++) {
                        if (
                            !isTypeSame(
                                type1TupleTypeArgs[i].type,
                                type2TupleTypeArgs[i].type,
                                { ...options, ignoreTypeFlags: false },
                                recursionCount
                            )
                        ) {
                            return false;
                        }

                        if (type1TupleTypeArgs[i].isUnbounded !== type2TupleTypeArgs[i].isUnbounded) {
                            return false;
                        }
                    }
                } else {
                    const type1TypeArgs = type1.typeArguments || [];
                    const type2TypeArgs = classType2.typeArguments || [];
                    const typeArgCount = Math.max(type1TypeArgs.length, type2TypeArgs.length);

                    for (let i = 0; i < typeArgCount; i++) {
                        // Assume that missing type args are "Unknown".
                        const typeArg1 = i < type1TypeArgs.length ? type1TypeArgs[i] : UnknownType.create();
                        const typeArg2 = i < type2TypeArgs.length ? type2TypeArgs[i] : UnknownType.create();

                        if (!isTypeSame(typeArg1, typeArg2, { ...options, ignoreTypeFlags: false }, recursionCount)) {
                            return false;
                        }
                    }
                }
            }

            if (!ClassType.isLiteralValueSame(type1, classType2)) {
                return false;
            }

            if (!type1.isTypedDictPartial !== !classType2.isTypedDictPartial) {
                return false;
            }

            if (!options.ignoreTypedDictNarrowEntries && !ClassType.isTypedDictNarrowedEntriesSame(type1, classType2)) {
                return false;
            }

            return true;
        }

        case TypeCategory.Function: {
            // Make sure the parameter counts match.
            const functionType2 = type2 as FunctionType;
            const params1 = type1.details.parameters;
            const params2 = functionType2.details.parameters;

            if (params1.length !== params2.length) {
                return false;
            }

            // If one function is ... and the other is not, they are not the same.
            if (FunctionType.isGradualCallableForm(type1) !== FunctionType.isGradualCallableForm(functionType2)) {
                return false;
            }

            const positionOnlyIndex1 = params1.findIndex((param) => isPositionOnlySeparator(param));
            const positionOnlyIndex2 = params2.findIndex((param) => isPositionOnlySeparator(param));

            // Make sure the parameter details match.
            for (let i = 0; i < params1.length; i++) {
                const param1 = params1[i];
                const param2 = params2[i];

                if (param1.category !== param2.category) {
                    return false;
                }

                const isName1Relevant = positionOnlyIndex1 !== undefined && i > positionOnlyIndex1;
                const isName2Relevant = positionOnlyIndex2 !== undefined && i > positionOnlyIndex2;

                if (isName1Relevant !== isName2Relevant) {
                    return false;
                }

                if (isName1Relevant) {
                    if (param1.name !== param2.name) {
                        return false;
                    }
                } else if (isPositionOnlySeparator(param1) && isPositionOnlySeparator(param2)) {
                    continue;
                } else if (isKeywordOnlySeparator(param1) && isKeywordOnlySeparator(param2)) {
                    continue;
                }

                const param1Type = FunctionType.getEffectiveParameterType(type1, i);
                const param2Type = FunctionType.getEffectiveParameterType(functionType2, i);
                if (!isTypeSame(param1Type, param2Type, { ...options, ignoreTypeFlags: false }, recursionCount)) {
                    return false;
                }
            }

            // Make sure the return types match.
            let return1Type = type1.details.declaredReturnType;
            if (type1.specializedTypes && type1.specializedTypes.returnType) {
                return1Type = type1.specializedTypes.returnType;
            }
            if (!return1Type && type1.inferredReturnType) {
                return1Type = type1.inferredReturnType;
            }

            let return2Type = functionType2.details.declaredReturnType;
            if (functionType2.specializedTypes && functionType2.specializedTypes.returnType) {
                return2Type = functionType2.specializedTypes.returnType;
            }
            if (!return2Type && functionType2.inferredReturnType) {
                return2Type = functionType2.inferredReturnType;
            }

            if (return1Type || return2Type) {
                if (
                    !return1Type ||
                    !return2Type ||
                    !isTypeSame(return1Type, return2Type, { ...options, ignoreTypeFlags: false }, recursionCount)
                ) {
                    return false;
                }
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
                if (!isTypeSame(type1.overloads[i], functionType2.overloads[i], options, recursionCount)) {
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
            const exclusionSet = new Set<number>();
            return (
                findSubtype(
                    type1,
                    (subtype) => !UnionType.containsType(unionType2, subtype, exclusionSet, recursionCount)
                ) === undefined
            );
        }

        case TypeCategory.TypeVar: {
            const type2TypeVar = type2 as TypeVarType;

            if (type1.scopeId !== type2TypeVar.scopeId) {
                return false;
            }

            // Handle the case where this is a generic recursive type alias. Make
            // sure that the type argument types match.
            if (type1.details.recursiveTypeParameters && type2TypeVar.details.recursiveTypeParameters) {
                const type1TypeArgs = type1?.typeAliasInfo?.typeArguments || [];
                const type2TypeArgs = type2?.typeAliasInfo?.typeArguments || [];
                const typeArgCount = Math.max(type1TypeArgs.length, type2TypeArgs.length);

                for (let i = 0; i < typeArgCount; i++) {
                    // Assume that missing type args are "Any".
                    const typeArg1 = i < type1TypeArgs.length ? type1TypeArgs[i] : AnyType.create();
                    const typeArg2 = i < type2TypeArgs.length ? type2TypeArgs[i] : AnyType.create();

                    if (!isTypeSame(typeArg1, typeArg2, { ...options, ignoreTypeFlags: false }, recursionCount)) {
                        return false;
                    }
                }
            }

            if (!type1.isVariadicInUnion !== !type2TypeVar.isVariadicInUnion) {
                return false;
            }

            if (type1.details === type2TypeVar.details) {
                return true;
            }

            if (
                type1.details.name !== type2TypeVar.details.name ||
                type1.details.isParamSpec !== type2TypeVar.details.isParamSpec ||
                type1.details.isVariadic !== type2TypeVar.details.isVariadic ||
                type1.details.isSynthesized !== type2TypeVar.details.isSynthesized ||
                type1.details.declaredVariance !== type2TypeVar.details.declaredVariance ||
                type1.scopeId !== type2TypeVar.scopeId
            ) {
                return false;
            }

            const boundType1 = type1.details.boundType;
            const boundType2 = type2TypeVar.details.boundType;
            if (boundType1) {
                if (
                    !boundType2 ||
                    !isTypeSame(boundType1, boundType2, { ...options, ignoreTypeFlags: false }, recursionCount)
                ) {
                    return false;
                }
            } else {
                if (boundType2) {
                    return false;
                }
            }

            const constraints1 = type1.details.constraints;
            const constraints2 = type2TypeVar.details.constraints;
            if (constraints1.length !== constraints2.length) {
                return false;
            }

            for (let i = 0; i < constraints1.length; i++) {
                if (
                    !isTypeSame(
                        constraints1[i],
                        constraints2[i],
                        { ...options, ignoreTypeFlags: false },
                        recursionCount
                    )
                ) {
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

        case TypeCategory.Unknown: {
            const type2Unknown = type2 as UnknownType;

            return type1.isIncomplete === type2Unknown.isIncomplete;
        }
    }

    return true;
}

// If the type is a union, remove an "unknown" type from the union,
// returning only the known types.
export function removeUnknownFromUnion(type: Type): Type {
    return removeFromUnion(type, (t: Type) => isUnknown(t));
}

// If the type is a union, remove an "unbound" type from the union,
// returning only the known types.
export function removeUnbound(type: Type): Type {
    if (isUnion(type)) {
        return removeFromUnion(type, (t: Type) => isUnbound(t));
    }

    if (isUnbound(type)) {
        return UnknownType.create();
    }

    return type;
}

export function removeFromUnion(type: Type, removeFilter: (type: Type) => boolean) {
    if (isUnion(type)) {
        const remainingTypes = type.subtypes.filter((t) => !removeFilter(t));
        if (remainingTypes.length < type.subtypes.length) {
            const newType = combineTypes(remainingTypes);

            if (isUnion(newType)) {
                UnionType.addTypeAliasSource(newType, type);
            }

            return newType;
        }
    }

    return type;
}

export function findSubtype(type: Type, filter: (type: UnionableType | NeverType) => boolean) {
    if (isUnion(type)) {
        return type.subtypes.find((subtype) => {
            return filter(subtype);
        });
    }

    return filter(type) ? type : undefined;
}

// Combines multiple types into a single type. If the types are
// the same, only one is returned. If they differ, they
// are combined into a UnionType. NeverTypes are filtered out.
// If no types remain in the end, a NeverType is returned.
export function combineTypes(subtypes: Type[], maxSubtypeCount?: number): Type {
    // Filter out any "Never" and "NoReturn" types.
    let sawNoReturn = false;

    if (subtypes.some((subtype) => subtype.category === TypeCategory.Never))
        subtypes = subtypes.filter((subtype) => {
            if (subtype.category === TypeCategory.Never && subtype.isNoReturn) {
                sawNoReturn = true;
            }
            return subtype.category !== TypeCategory.Never;
        });

    if (subtypes.length === 0) {
        return sawNoReturn ? NeverType.createNoReturn() : NeverType.createNever();
    }

    // Handle the common case where there is only one type.
    // Also handle the common case where there are multiple copies of the same type.
    let allSubtypesAreSame = true;
    if (subtypes.length > 1) {
        for (let index = 1; index < subtypes.length; index++) {
            if (subtypes[index] !== subtypes[0]) {
                allSubtypesAreSame = false;
                break;
            }
        }
    }

    if (allSubtypesAreSame) {
        return subtypes[0];
    }

    // Expand all union types.
    let expandedTypes: Type[] | undefined;
    const typeAliasSources = new Set<UnionType>();

    for (let i = 0; i < subtypes.length; i++) {
        const subtype = subtypes[i];
        if (isUnion(subtype)) {
            if (!expandedTypes) {
                expandedTypes = subtypes.slice(0, i);
            }
            expandedTypes = expandedTypes.concat(subtype.subtypes);

            if (subtype.typeAliasInfo) {
                typeAliasSources.add(subtype);
            } else if (subtype.typeAliasSources) {
                subtype.typeAliasSources.forEach((subtype) => {
                    typeAliasSources.add(subtype);
                });
            }
        } else if (expandedTypes) {
            expandedTypes.push(subtype);
        }
    }

    expandedTypes = expandedTypes ?? subtypes;

    // Sort all of the literal and empty types to the end.
    expandedTypes = expandedTypes.sort((type1, type2) => {
        if (isClass(type1) && type1.literalValue !== undefined) {
            return 1;
        }

        if (isClass(type2) && type2.literalValue !== undefined) {
            return -1;
        }

        if (isClassInstance(type1) && type1.isEmptyContainer) {
            return 1;
        } else if (isClassInstance(type2) && type2.isEmptyContainer) {
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
    if (typeAliasSources.size > 0) {
        newUnionType.typeAliasSources = typeAliasSources;
    }

    let hitMaxSubtypeCount = false;

    expandedTypes.forEach((subtype, index) => {
        if (index === 0) {
            UnionType.addType(newUnionType, subtype as UnionableType);
        } else {
            if (maxSubtypeCount === undefined || newUnionType.subtypes.length < maxSubtypeCount) {
                _addTypeIfUnique(newUnionType, subtype as UnionableType);
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

    if (isInstantiableClass(srcType) && srcType.literalValue !== undefined) {
        // Strip the literal.
        srcType = ClassType.cloneWithLiteral(srcType, /* value */ undefined);
        return isTypeSame(destType, srcType);
    }

    if (isClassInstance(srcType) && srcType.literalValue !== undefined) {
        // Strip the literal.
        srcType = ClassType.cloneWithLiteral(srcType, /* value */ undefined);
        return isTypeSame(destType, srcType, { ignoreConditions: true });
    }

    return false;
}

function _addTypeIfUnique(unionType: UnionType, typeToAdd: UnionableType) {
    // Handle the addition of a string literal in a special manner to
    // avoid n^2 behavior in unions that contain hundreds of string
    // literal types. Skip this for constrained types.
    if (isClass(typeToAdd) && typeToAdd.condition === undefined) {
        const literalMaps = isClassInstance(typeToAdd) ? unionType.literalInstances : unionType.literalClasses;

        if (
            ClassType.isBuiltIn(typeToAdd, 'str') &&
            typeToAdd.literalValue !== undefined &&
            literalMaps.literalStrMap !== undefined
        ) {
            if (!literalMaps.literalStrMap.has(typeToAdd.literalValue as string)) {
                UnionType.addType(unionType, typeToAdd);
            }
            return;
        } else if (
            ClassType.isBuiltIn(typeToAdd, 'int') &&
            typeToAdd.literalValue !== undefined &&
            literalMaps.literalIntMap !== undefined
        ) {
            if (!literalMaps.literalIntMap.has(typeToAdd.literalValue as number | bigint)) {
                UnionType.addType(unionType, typeToAdd);
            }
            return;
        } else if (
            ClassType.isEnumClass(typeToAdd) &&
            typeToAdd.literalValue !== undefined &&
            literalMaps.literalEnumMap !== undefined
        ) {
            const enumLiteral = typeToAdd.literalValue as EnumLiteral;
            if (!literalMaps.literalEnumMap.has(enumLiteral.getName())) {
                UnionType.addType(unionType, typeToAdd);
            }
            return;
        }
    }

    const isPseudoGeneric = isClass(typeToAdd) && ClassType.isPseudoGenericClass(typeToAdd);

    for (let i = 0; i < unionType.subtypes.length; i++) {
        const type = unionType.subtypes[i];

        // Does this type already exist in the types array?
        if (isTypeSame(type, typeToAdd)) {
            return;
        }

        // Handle the case where pseudo-generic classes with different
        // type arguments are being combined. Rather than add multiple
        // specialized types, we will replace them with a single specialized
        // type that is specialized with Unknowns. This is important because
        // we can hit recursive cases (where a pseudo-generic class is
        // parameterized with its own class) ad infinitum.
        if (isPseudoGeneric) {
            if (isTypeSame(type, typeToAdd, { ignorePseudoGeneric: true })) {
                unionType.subtypes[i] = ClassType.cloneForSpecialization(
                    typeToAdd,
                    typeToAdd.details.typeParameters.map(() => UnknownType.create()),
                    /* isTypeArgumentExplicit */ true
                );
                return;
            }
        }

        // If the typeToAdd is a literal value and there's already
        // a non-literal type that matches, don't add the literal value.
        if (isClassInstance(type) && isClassInstance(typeToAdd)) {
            if (isSameWithoutLiteralValue(type, typeToAdd)) {
                if (type.literalValue === undefined) {
                    return;
                }
            }

            // If we're adding Literal[False] or Literal[True] to its
            // opposite, combine them into a non-literal 'bool' type.
            if (
                ClassType.isBuiltIn(type, 'bool') &&
                !type.condition &&
                ClassType.isBuiltIn(typeToAdd, 'bool') &&
                !typeToAdd.condition
            ) {
                if (typeToAdd.literalValue !== undefined && !typeToAdd.literalValue === type.literalValue) {
                    unionType.subtypes[i] = ClassType.cloneWithLiteral(type, /* value */ undefined);
                    return;
                }
            }

            // If the typeToAdd is a TypedDict that is the same class as the
            // existing type, see if one of them is a proper subset of the other.
            if (ClassType.isTypedDictClass(type) && ClassType.isSameGenericClass(type, typeToAdd)) {
                // Do not proceed if the TypedDicts are generic and have different type arguments.
                if (!type.typeArguments && !typeToAdd.typeArguments) {
                    if (ClassType.isTypedDictNarrower(typeToAdd, type)) {
                        return;
                    } else if (ClassType.isTypedDictNarrower(type, typeToAdd)) {
                        unionType.subtypes[i] = typeToAdd;
                        return;
                    }
                }
            }
        }

        // If the typeToAdd is an empty container and there's already
        // non-empty container of the same type, don't add the empty container.
        if (isClassInstance(typeToAdd) && typeToAdd.isEmptyContainer) {
            if (isClassInstance(type) && ClassType.isSameGenericClass(type, typeToAdd)) {
                return;
            }
        }
    }

    UnionType.addType(unionType, typeToAdd);
}
