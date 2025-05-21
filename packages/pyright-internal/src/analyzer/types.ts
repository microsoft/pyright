/*
 * types.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Representation of types used during type analysis within Python.
 */

import { partition } from '../common/collectionUtils';
import { assert } from '../common/debug';
import { Uri } from '../common/uri/uri';
import { ArgumentNode, ExpressionNode, NameNode, ParamCategory, TypeAnnotationNode } from '../parser/parseNodes';
import { ClassDeclaration, FunctionDeclaration, SpecialBuiltInClassDeclaration } from './declaration';
import { Symbol, SymbolTable } from './symbol';

export const enum TypeCategory {
    // Name is not bound to a value of any type
    Unbound,

    // Implicit Any type
    Unknown,

    // Type can be anything
    Any,

    // The bottom type, equivalent to an empty union
    Never,

    // Callable type
    Function,

    // Functions defined with @overload decorator
    Overloaded,

    // Class definition
    Class,

    // Module instance
    Module,

    // Union of two or more other types
    Union,

    // Type variable
    TypeVar,
}

export const enum TypeFlags {
    None = 0,

    // This type refers to something that can be instantiated.
    Instantiable = 1 << 0,

    // This type refers to something that has been instantiated.
    Instance = 1 << 1,

    // This type is inferred within a py.typed source file and could be
    // inferred differently by other type checkers.
    Ambiguous = 1 << 2,

    // This mask indicates which flags should be considered significant
    // when comparing two types for equivalence.
    TypeCompatibilityMask = Instantiable | Instance,
}

export type UnionableType =
    | UnboundType
    | UnknownType
    | AnyType
    | FunctionType
    | OverloadedType
    | ClassType
    | ModuleType
    | TypeVarType;

export type Type = UnionableType | NeverType | UnionType;

// A string that uniquely identifies a TypeVar that is bound to a scope
// (a generic class, function, or type alias).
export type TypeVarScopeId = string;
export const UnificationScopeId: TypeVarScopeId = '-';

// Information about an enum member that can be used within a Literal
// type annotation.
export class EnumLiteral {
    constructor(
        public classFullName: string,
        public className: string,
        public itemName: string,
        public itemType: Type,
        public isReprEnum: boolean
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

// Options used with the isTypeSame function
export interface TypeSameOptions {
    ignorePseudoGeneric?: boolean;
    ignoreTypeFlags?: boolean;
    ignoreConditions?: boolean;
    ignoreTypedDictNarrowEntries?: boolean;
    honorTypeForm?: boolean;
    honorIsTypeArgExplicit?: boolean;
    treatAnySameAsUnknown?: boolean;
}

export interface TypeAliasSharedInfo {
    name: string;
    fullName: string;
    moduleName: string;
    fileUri: Uri;

    typeVarScopeId: TypeVarScopeId;

    // Is the type alias a PEP 695 TypeAliasType instance?
    isTypeAliasType: boolean;

    // Type parameters, if type alias is generic
    typeParams: TypeVarType[] | undefined;

    // Lazily-evaluated variance of type parameters based on how
    // they are used in the type alias
    computedVariance: Variance[] | undefined;
}

export interface TypeAliasInfo {
    shared: TypeAliasSharedInfo;

    // Type argument, if type alias is specialized
    typeArgs: Type[] | undefined;
}

interface CachedTypeInfo {
    // Type converted to instantiable and instance by convertToInstance
    // and convertToInstantiable (cached)
    instantiableType?: Type;
    instanceType?: Type;

    // Type converted to instantiable and instance by TypeBase methods (cached)
    typeBaseInstantiableType?: Type;
    typeBaseInstanceType?: Type;

    // Requires specialization flag (cached)
    requiresSpecialization?: boolean;
}

export interface TypeBaseProps {
    // Used to handle nested references to instantiable classes
    // (e.g. type[type[type[T]]]). If the field isn't present,
    // it is assumed to be zero
    instantiableDepth: number | undefined;

    // Used in cases where the type is a special form when used in a
    // value expression such as UnionType, Literal, or Required
    specialForm: ClassType | undefined;

    // Used for "type form" objects, the evaluated form
    // of a type expression in a value expression context
    typeForm: Type | undefined;

    // Used only for type aliases
    typeAliasInfo: TypeAliasInfo | undefined;

    // Used only for types that are conditioned on a TypeVar
    condition: TypeCondition[] | undefined;
}

export interface TypeBase<T extends TypeCategory> {
    category: T;
    flags: TypeFlags;

    // Optional properties common to all types.
    props: TypeBaseProps | undefined;

    // Optional cached values are not cloned.
    cached: CachedTypeInfo | undefined;

    // Fields that are specific to a particular type category.
    // These are shared between type instances and are not
    // cloned.
    shared: object | undefined;

    // Fields that are specific to a particular type category.
    // These are private to each type instances and are
    // cloned.
    priv: object | undefined;
}

export namespace TypeBase {
    export function isInstantiable(type: TypeBase<any>) {
        return (type.flags & TypeFlags.Instantiable) !== 0;
    }

    export function isInstance(type: TypeBase<any>) {
        return (type.flags & TypeFlags.Instance) !== 0;
    }

    export function isAmbiguous(type: TypeBase<any>) {
        return (type.flags & TypeFlags.Ambiguous) !== 0;
    }

    export function addProps(type: TypeBase<any>): TypeBaseProps {
        if (!type.props) {
            type.props = {
                instantiableDepth: undefined,
                specialForm: undefined,
                typeForm: undefined,
                typeAliasInfo: undefined,
                condition: undefined,
            };
        }
        return type.props;
    }

    export function getInstantiableDepth(type: TypeBase<any>) {
        return type.props?.instantiableDepth ?? 0;
    }

    export function setSpecialForm(type: TypeBase<any>, specialForm: ClassType | undefined) {
        TypeBase.addProps(type).specialForm = specialForm;
    }

    export function setInstantiableDepth(type: TypeBase<any>, depth: number | undefined) {
        TypeBase.addProps(type).instantiableDepth = depth;
    }

    export function setTypeAliasInfo(type: TypeBase<any>, typeAliasInfo: TypeAliasInfo | undefined) {
        TypeBase.addProps(type).typeAliasInfo = typeAliasInfo;
    }

    export function setTypeForm(type: TypeBase<any>, typeForm: Type | undefined) {
        TypeBase.addProps(type).typeForm = typeForm;
    }

    export function setCondition(type: TypeBase<any>, condition: TypeCondition[] | undefined) {
        TypeBase.addProps(type).condition = condition;
    }

    export function cloneType<T extends TypeBase<any>>(type: T): T {
        const clone = { ...type };
        if (type.props) {
            clone.props = { ...type.props };
        }
        if (type.priv) {
            clone.priv = { ...type.priv };
        }
        clone.cached = undefined;
        return clone;
    }

    export function cloneAsSpecialForm<T extends TypeBase<any>>(type: T, specialForm: ClassType | undefined): T {
        const clone = TypeBase.cloneType(type);
        TypeBase.setSpecialForm(clone, specialForm);
        return clone;
    }

    export function cloneTypeAsInstance<T extends Type>(type: T, cache: boolean): T {
        assert(TypeBase.isInstantiable(type));

        const newInstance = TypeBase.cloneType(type);

        // Remove type form information from the type.
        if (newInstance.props?.typeForm) {
            TypeBase.setTypeForm(newInstance, undefined);
        }

        const depth = newInstance.props?.instantiableDepth;
        if (depth === undefined) {
            newInstance.flags &= ~TypeFlags.Instantiable;
            newInstance.flags |= TypeFlags.Instance;
        } else if (depth <= 1) {
            TypeBase.setInstantiableDepth(newInstance, undefined);
        } else {
            TypeBase.setInstantiableDepth(newInstance, depth - 1);
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
            const oldDepth = type.props?.instantiableDepth;
            TypeBase.setInstantiableDepth(newInstance, oldDepth === undefined ? 1 : oldDepth + 1);
        }

        // Remove type alias information because the type will no longer match
        // that of the type alias definition.
        if (newInstance.props?.typeAliasInfo) {
            TypeBase.setTypeAliasInfo(newInstance, undefined);
        }

        // Remove type form information from the type.
        if (newInstance.props?.typeForm) {
            TypeBase.setTypeForm(newInstance, undefined);
        }

        // Should we cache it for next time?
        if (cache) {
            if (!type.cached) {
                type.cached = {};
            }

            type.cached.typeBaseInstantiableType = newInstance;
        }

        return newInstance;
    }

    export function cloneForTypeAlias<T extends Type>(type: T, aliasInfo: TypeAliasInfo): T {
        const typeClone = cloneType(type);

        TypeBase.setTypeAliasInfo(typeClone, aliasInfo);

        return typeClone;
    }

    export function cloneWithTypeForm<T extends Type>(type: T, typeForm: Type | undefined): T {
        const typeClone = cloneType(type);

        TypeBase.setTypeForm(typeClone, typeForm);

        return typeClone;
    }

    export function cloneForCondition<T extends Type>(type: T, condition: TypeCondition[] | undefined): T {
        // Handle the common case where there are no conditions. In this case,
        // cloning isn't necessary.
        if (type.props?.condition === undefined && condition === undefined) {
            return type;
        }

        const typeClone = cloneType(type);
        TypeBase.setCondition(typeClone, condition);
        return typeClone;
    }

    export function cloneForAmbiguousType(type: Type) {
        if (TypeBase.isAmbiguous(type)) {
            return type;
        }

        const typeClone = cloneType(type);
        typeClone.flags |= TypeFlags.Ambiguous;
        return typeClone;
    }
}

export interface UnboundType extends TypeBase<TypeCategory.Unbound> {}

export namespace UnboundType {
    const _instance: UnboundType = {
        category: TypeCategory.Unbound,
        flags: TypeFlags.Instantiable | TypeFlags.Instance,
        props: undefined,
        cached: undefined,
        shared: undefined,
        priv: undefined,
    };

    export function create() {
        // All Unbound objects are the same, so use a shared instance.
        return _instance;
    }

    export function convertToInstance(type: UnboundType): UnboundType {
        // Remove the "special form" if present. Otherwise return the existing type.
        return type.props?.specialForm ? UnboundType.create() : type;
    }
}

export interface UnknownDetailsPriv {
    // Flag that indicates whether the type is a placeholder for an incomplete
    // type during code flow analysis.
    isIncomplete: boolean;

    // A "possible type" is a form of a "weak union" where the actual
    // type is unknown, but it could be one of the subtypes in the union.
    // This is used for overload matching in cases where more than one
    // overload matches due to an argument that evaluates to Any or Unknown.
    possibleType: Type | undefined;
}

export interface UnknownType extends TypeBase<TypeCategory.Unknown> {
    priv: UnknownDetailsPriv;
}

export namespace UnknownType {
    const _instance: UnknownType = {
        category: TypeCategory.Unknown,
        flags: TypeFlags.Instantiable | TypeFlags.Instance,
        props: undefined,
        cached: undefined,
        shared: undefined,
        priv: {
            isIncomplete: false,
            possibleType: undefined,
        },
    };
    const _incompleteInstance: UnknownType = {
        category: TypeCategory.Unknown,
        flags: TypeFlags.Instantiable | TypeFlags.Instance,
        props: undefined,
        cached: undefined,
        shared: undefined,
        priv: {
            isIncomplete: true,
            possibleType: undefined,
        },
    };

    export function create(isIncomplete = false) {
        return isIncomplete ? _incompleteInstance : _instance;
    }

    export function createPossibleType(possibleType: Type, isIncomplete: boolean) {
        const unknownWithPossibleType: UnknownType = {
            category: TypeCategory.Unknown,
            flags: TypeFlags.Instantiable | TypeFlags.Instance,
            props: undefined,
            cached: undefined,
            shared: undefined,
            priv: {
                isIncomplete,
                possibleType,
            },
        };

        return unknownWithPossibleType;
    }

    export function convertToInstance(type: UnknownType): UnknownType {
        // Remove the "special form" if present. Otherwise return the existing type.
        return type.props?.specialForm ? UnknownType.create(type.priv.isIncomplete) : type;
    }
}

export interface ModuleDetailsPriv {
    fields: SymbolTable;
    docString: string | undefined;

    // If a field lookup isn't found, should the type of the
    // resulting field be Any/Unknown or treated as an error?
    notPresentFieldType: AnyType | UnknownType | undefined;

    // A "loader" module includes symbols that were injected by
    // the module loader. We keep these separate so we don't
    // pollute the symbols exported by the module itself.
    loaderFields: SymbolTable;

    // The period-delimited import name of this module.
    moduleName: string;

    fileUri: Uri;
}

export interface ModuleType extends TypeBase<TypeCategory.Module> {
    priv: ModuleDetailsPriv;
}

export namespace ModuleType {
    export function create(moduleName: string, fileUri: Uri, symbolTable?: SymbolTable) {
        const newModuleType: ModuleType = {
            category: TypeCategory.Module,
            flags: TypeFlags.Instantiable | TypeFlags.Instantiable,
            props: undefined,
            cached: undefined,
            shared: undefined,
            priv: {
                fields: symbolTable || new Map<string, Symbol>(),
                docString: undefined,
                notPresentFieldType: undefined,
                loaderFields: new Map<string, Symbol>(),
                moduleName,
                fileUri,
            },
        };
        return newModuleType;
    }

    export function getField(moduleType: ModuleType, name: string): Symbol | undefined {
        // Always look for the symbol in the module's fields before consulting
        // the loader fields. The loader runs before the module, so its values
        // will be overwritten by the module.
        let symbol = moduleType.priv.fields.get(name);

        if (moduleType.priv.loaderFields) {
            if (!symbol) {
                symbol = moduleType.priv.loaderFields.get(name);
            } else if (symbol.getDeclarations().length === 1) {
                // If the symbol is hidden when accessed via the module but is
                // also accessible through a loader field, use the latter so it
                // isn't flagged as an error.
                const loaderSymbol = moduleType.priv.loaderFields.get(name);
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
    mroClass?: ClassType;
    isClassVar: boolean;
    isKeywordOnly: boolean;
    alias?: string | undefined;
    hasDefault?: boolean | undefined;
    isDefaultFactory?: boolean | undefined;
    nameNode: NameNode | undefined;
    typeAnnotationNode: TypeAnnotationNode | undefined;
    defaultExpr?: ExpressionNode | undefined;
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
    BuiltIn = 1 << 0,

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

    // The tuple class requires special-case handling for its type arguments.
    TupleClass = 1 << 15,

    // The class has a metaclass of EnumMeta or derives from
    // a class that has this metaclass.
    EnumClass = 1 << 16,

    // Properties that are defined using the @classmethod decorator.
    ClassProperty = 1 << 17,

    // Class is declared within a type stub file.
    DefinedInStub = 1 << 18,

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

interface ClassDetailsShared {
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
    typeParams: TypeVarType[];
    typeVarScopeId?: TypeVarScopeId | undefined;
    docString?: string | undefined;
    dataClassEntries?: DataClassEntry[] | undefined;
    dataClassBehaviors?: DataClassBehaviors | undefined;
    namedTupleEntries?: Set<string> | undefined;
    typedDictEntries?: TypedDictEntries | undefined;
    typedDictExtraItemsExpr?: ExpressionNode | undefined;
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

export interface TupleTypeArg {
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

export interface ClassDetailsPriv {
    // A generic class that has been completely or partially
    // specialized will have type arguments that correspond to
    // some or all of the type parameters.
    typeArgs?: Type[] | undefined;

    // If a generic container class (like a list or dict) is known
    // to contain no elements, its type arguments may be "Unknown".
    // This value allows us to elide the Unknown when it's safe to
    // do so.
    isEmptyContainer?: boolean | undefined;

    // For tuples, the class definition calls for a single type parameter but
    // the spec allows the programmer to provide an arbitrary number of
    // type arguments. This field holds the individual type arguments
    // while the "typeArgs" field holds the derived non-variadic
    // type argument, which is the union of the tuple type arguments.
    tupleTypeArgs?: TupleTypeArg[] | undefined;

    // We sometimes package multiple types into a tuple internally
    // for matching against a variadic type variable or another unpacked
    // tuple. We need to be able to distinguish this case from normal tuples.
    isUnpacked?: boolean | undefined;

    // If type arguments are present, were they explicit (i.e.
    // provided explicitly in the code)?
    isTypeArgExplicit?: boolean | undefined;

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

    // Special-case fields for partial class.
    partialCallType?: Type | undefined;
}

export interface ClassType extends TypeBase<TypeCategory.Class> {
    shared: ClassDetailsShared;
    priv: ClassDetailsPriv;
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
            flags: TypeFlags.Instantiable,
            props: undefined,
            cached: undefined,
            shared: {
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
                typeParams: [],
                docString,
            },
            priv: {},
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
        if (newInstance.props?.specialForm) {
            TypeBase.setSpecialForm(newInstance, undefined);
        }

        if (includeSubclasses) {
            newInstance.priv.includeSubclasses = true;
        }

        return newInstance;
    }

    export function cloneAsInstantiable(type: ClassType, includeSubclasses = true): ClassType {
        if (includeSubclasses && type.cached?.typeBaseInstantiableType) {
            return type.cached.typeBaseInstantiableType as ClassType;
        }

        const newInstance = TypeBase.cloneTypeAsInstantiable(type, includeSubclasses);
        if (includeSubclasses) {
            newInstance.priv.includeSubclasses = true;
        }

        return newInstance;
    }

    export function specialize(
        classType: ClassType,
        typeArgs: Type[] | undefined,
        isTypeArgExplicit?: boolean,
        includeSubclasses = false,
        tupleTypeArgs?: TupleTypeArg[],
        isEmptyContainer?: boolean
    ): ClassType {
        const newClassType = TypeBase.cloneType(classType);

        newClassType.priv.typeArgs = typeArgs?.length === 0 ? undefined : typeArgs;

        // If the user passed undefined for this argument, infer it
        // based on whether typeArgs was provided.
        if (isTypeArgExplicit === undefined) {
            isTypeArgExplicit = !!typeArgs;
        }

        newClassType.priv.isTypeArgExplicit = isTypeArgExplicit;

        if (includeSubclasses) {
            newClassType.priv.includeSubclasses = true;
        }

        newClassType.priv.tupleTypeArgs = tupleTypeArgs ? [...tupleTypeArgs] : undefined;

        if (isEmptyContainer !== undefined) {
            newClassType.priv.isEmptyContainer = isEmptyContainer;
        }

        return newClassType;
    }

    export function cloneIncludeSubclasses(classType: ClassType, includeSubclasses = true) {
        if (!!classType.priv.includeSubclasses === includeSubclasses) {
            return classType;
        }

        const newClassType = TypeBase.cloneType(classType);
        newClassType.priv.includeSubclasses = includeSubclasses;
        return newClassType;
    }

    export function cloneWithLiteral(classType: ClassType, value: LiteralValue | undefined): ClassType {
        const newClassType = TypeBase.cloneType(classType);
        newClassType.priv.literalValue = value;

        // Remove type alias information because the type will no longer match
        // that of the type alias definition if we change the literal type.
        if (newClassType.props?.typeAliasInfo) {
            TypeBase.setTypeAliasInfo(newClassType, undefined);
        }

        return newClassType;
    }

    export function cloneForDeprecatedInstance(type: ClassType, deprecatedMessage?: string): ClassType {
        const newClassType = TypeBase.cloneType(type);
        newClassType.priv.deprecatedInstanceMessage = deprecatedMessage;
        return newClassType;
    }

    export function cloneForTypingAlias(classType: ClassType, aliasName: string): ClassType {
        const newClassType = TypeBase.cloneType(classType);
        newClassType.priv.aliasName = aliasName;
        return newClassType;
    }

    export function cloneForNarrowedTypedDictEntries(
        classType: ClassType,
        narrowedEntries?: Map<string, TypedDictEntry>
    ): ClassType {
        const newClassType = TypeBase.cloneType(classType);
        newClassType.priv.typedDictNarrowedEntries = narrowedEntries;
        return newClassType;
    }

    export function cloneForPartialTypedDict(classType: ClassType): ClassType {
        const newClassType = TypeBase.cloneType(classType);
        newClassType.priv.isTypedDictPartial = true;
        return newClassType;
    }

    export function cloneRemoveTypePromotions(classType: ClassType): ClassType {
        if (!classType.priv.includePromotions) {
            return classType;
        }

        const newClassType = TypeBase.cloneType(classType);
        if (newClassType.priv.includePromotions !== undefined) {
            newClassType.priv.includePromotions = undefined;
        }
        return newClassType;
    }

    export function cloneForPartial(classType: ClassType, partialCallType: Type): ClassType {
        const newClassType = TypeBase.cloneType(classType);
        newClassType.priv.partialCallType = partialCallType;
        return newClassType;
    }

    export function cloneForUnpacked(classType: ClassType): ClassType {
        if (classType.priv.isUnpacked) {
            return classType;
        }

        const newClassType = TypeBase.cloneType(classType);
        newClassType.priv.isUnpacked = true;
        return newClassType;
    }

    export function cloneForPacked(classType: ClassType): ClassType {
        if (!classType.priv.isUnpacked) {
            return classType;
        }

        const newClassType = TypeBase.cloneType(classType);
        newClassType.priv.isUnpacked = false;
        return newClassType;
    }

    export function cloneWithNewFlags(classType: ClassType, newFlags: ClassTypeFlags): ClassType {
        const newClassType = TypeBase.cloneType(classType);
        newClassType.shared = { ...newClassType.shared };
        newClassType.shared.flags = newFlags;
        return newClassType;
    }

    export function isLiteralValueSame(type1: ClassType, type2: ClassType): boolean {
        if (type1.priv.literalValue === undefined) {
            return type2.priv.literalValue === undefined;
        } else if (type2.priv.literalValue === undefined) {
            return false;
        }

        if (type1.priv.literalValue instanceof EnumLiteral) {
            if (type2.priv.literalValue instanceof EnumLiteral) {
                return type1.priv.literalValue.itemName === type2.priv.literalValue.itemName;
            }
            return false;
        }

        return type1.priv.literalValue === type2.priv.literalValue;
    }

    // Determines whether two typed dict classes are equivalent given
    // that one or both have narrowed entries (i.e. entries that are
    // guaranteed to be present).
    export function isTypedDictNarrowedEntriesSame(type1: ClassType, type2: ClassType): boolean {
        if (type1.priv.typedDictNarrowedEntries) {
            if (!type2.priv.typedDictNarrowedEntries) {
                return false;
            }

            const tdEntries1 = type1.priv.typedDictNarrowedEntries;
            const tdEntries2 = type2.priv.typedDictNarrowedEntries;

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
        } else if (type2.priv.typedDictNarrowedEntries) {
            return false;
        }

        return true;
    }

    // Determines whether typed dict class type1 is a narrower form of type2,
    // i.e. all of the "narrowed entries" found within type2 are also found
    // within type1.
    export function isTypedDictNarrower(type1: ClassType, type2: ClassType): boolean {
        const tdEntries2 = type2.priv.typedDictNarrowedEntries;
        if (!tdEntries2) {
            return true;
        }

        const tdEntries1 = type1.priv.typedDictNarrowedEntries ?? new Map<string, TypedDictEntry>();

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
        return classType.shared.typeParams.length > 0 && classType.priv.typeArgs === undefined;
    }

    export function isSpecialBuiltIn(classType: ClassType, className?: string) {
        if (!(classType.shared.flags & ClassTypeFlags.SpecialBuiltIn) && !classType.priv.aliasName) {
            return false;
        }

        if (className !== undefined) {
            return classType.shared.name === className;
        }

        return true;
    }

    export function isBuiltIn(classType: ClassType, className?: string | string[]) {
        if (!(classType.shared.flags & ClassTypeFlags.BuiltIn)) {
            return false;
        }

        if (className !== undefined) {
            const classArray = Array.isArray(className) ? className : [className];
            return classArray.some(
                (name) =>
                    name === classType.shared.name ||
                    name === classType.shared.fullName ||
                    name === classType.priv.aliasName
            );
        }

        return true;
    }

    export function supportsAbstractMethods(classType: ClassType) {
        return !!(classType.shared.flags & ClassTypeFlags.SupportsAbstractMethods);
    }

    export function isDataClass(classType: ClassType) {
        return !!classType.shared.dataClassBehaviors;
    }

    export function isDataClassSkipGenerateInit(classType: ClassType) {
        return !!classType.shared.dataClassBehaviors?.skipGenerateInit;
    }

    export function isDataClassSkipGenerateEq(classType: ClassType) {
        return !!classType.shared.dataClassBehaviors?.skipGenerateEq;
    }

    export function isDataClassFrozen(classType: ClassType) {
        return !!classType.shared.dataClassBehaviors?.frozen;
    }

    export function isDataClassGenerateOrder(classType: ClassType) {
        return !!classType.shared.dataClassBehaviors?.generateOrder;
    }

    export function isDataClassKeywordOnly(classType: ClassType) {
        return !!classType.shared.dataClassBehaviors?.keywordOnly;
    }

    export function isDataClassGenerateSlots(classType: ClassType) {
        return !!classType.shared.dataClassBehaviors?.generateSlots;
    }

    export function isDataClassGenerateHash(classType: ClassType) {
        return !!classType.shared.dataClassBehaviors?.generateHash;
    }

    export function isTypeCheckOnly(classType: ClassType) {
        return !!(classType.shared.flags & ClassTypeFlags.TypeCheckOnly);
    }

    export function isNewTypeClass(classType: ClassType) {
        return !!(classType.shared.flags & ClassTypeFlags.NewTypeClass);
    }

    export function isValidTypeAliasClass(classType: ClassType) {
        return !!(classType.shared.flags & ClassTypeFlags.ValidTypeAliasClass);
    }

    export function isSpecialFormClass(classType: ClassType) {
        return !!(classType.shared.flags & ClassTypeFlags.SpecialFormClass);
    }

    export function isIllegalIsinstanceClass(classType: ClassType) {
        return !!(classType.shared.flags & ClassTypeFlags.IllegalIsinstanceClass);
    }

    export function isTypedDictClass(classType: ClassType) {
        return !!(classType.shared.flags & ClassTypeFlags.TypedDictClass);
    }

    export function isCanOmitDictValues(classType: ClassType) {
        return !!(classType.shared.flags & ClassTypeFlags.CanOmitDictValues);
    }

    export function isTypedDictMarkedClosed(classType: ClassType) {
        return !!(classType.shared.flags & ClassTypeFlags.TypedDictMarkedClosed);
    }

    export function isTypedDictEffectivelyClosed(classType: ClassType) {
        return !!(classType.shared.flags & ClassTypeFlags.TypedDictEffectivelyClosed);
    }

    export function isEnumClass(classType: ClassType) {
        return !!(classType.shared.flags & ClassTypeFlags.EnumClass);
    }

    export function isPropertyClass(classType: ClassType) {
        return !!(classType.shared.flags & ClassTypeFlags.PropertyClass);
    }

    export function isClassProperty(classType: ClassType) {
        return !!(classType.shared.flags & ClassTypeFlags.ClassProperty);
    }

    export function isFinal(classType: ClassType) {
        return !!(classType.shared.flags & ClassTypeFlags.Final);
    }

    export function isProtocolClass(classType: ClassType) {
        return !!(classType.shared.flags & ClassTypeFlags.ProtocolClass);
    }

    export function isDefinedInStub(classType: ClassType) {
        return !!(classType.shared.flags & ClassTypeFlags.DefinedInStub);
    }

    export function isPseudoGenericClass(classType: ClassType) {
        return !!(classType.shared.flags & ClassTypeFlags.PseudoGenericClass);
    }

    export function getDataClassEntries(classType: ClassType): DataClassEntry[] {
        classType.shared.synthesizeMethodsDeferred?.();

        return classType.shared.dataClassEntries || [];
    }

    export function isRuntimeCheckable(classType: ClassType) {
        return !!(classType.shared.flags & ClassTypeFlags.RuntimeCheckable);
    }

    export function isTypingExtensionClass(classType: ClassType) {
        return !!(classType.shared.flags & ClassTypeFlags.TypingExtensionClass);
    }

    export function isPartiallyEvaluated(classType: ClassType) {
        return !!(classType.shared.flags & ClassTypeFlags.PartiallyEvaluated);
    }

    export function hasCustomClassGetItem(classType: ClassType) {
        return !!(classType.shared.flags & ClassTypeFlags.HasCustomClassGetItem);
    }

    export function isTupleClass(classType: ClassType) {
        return !!(classType.shared.flags & ClassTypeFlags.TupleClass);
    }

    export function getTypeParams(classType: ClassType) {
        return classType.shared.typeParams;
    }

    export function derivesFromAnyOrUnknown(classType: ClassType) {
        return classType.shared.mro.some((baseClass) => isAnyOrUnknown(baseClass));
    }

    export function getSymbolTable(classType: ClassType) {
        classType.shared.synthesizeMethodsDeferred?.();

        return classType.shared.fields;
    }

    export function getInheritedSlotsNames(classType: ClassType) {
        // First synthesize methods if needed. The slots entries
        // can depend on synthesized methods.
        classType.shared.synthesizeMethodsDeferred?.();

        classType.shared.calculateInheritedSlotsNamesDeferred?.();

        return classType.shared.inheritedSlotsNamesCached;
    }

    // Similar to isPartiallyEvaluated except that it also looks at all of the
    // classes in the MRO list for this class to see if any of them are still
    // partially evaluated.
    export function isHierarchyPartiallyEvaluated(classType: ClassType) {
        return (
            ClassType.isPartiallyEvaluated(classType) ||
            classType.shared.mro.some((mroClass) => isClass(mroClass) && ClassType.isPartiallyEvaluated(mroClass))
        );
    }

    export function hasNamedTupleEntry(classType: ClassType, name: string): boolean {
        if (!classType.shared.namedTupleEntries) {
            return false;
        }

        return classType.shared.namedTupleEntries.has(name);
    }

    // Same as isTypeSame except that it doesn't compare type arguments.
    export function isSameGenericClass(classType: ClassType, type2: ClassType, recursionCount = 0) {
        if (!classType.priv.isTypedDictPartial !== !type2.priv.isTypedDictPartial) {
            return false;
        }

        if (TypeBase.isInstance(classType) !== TypeBase.isInstance(type2)) {
            return false;
        }

        if (TypeBase.getInstantiableDepth(classType) !== TypeBase.getInstantiableDepth(type2)) {
            return false;
        }

        const class1Details = classType.shared;
        const class2Details = type2.shared;

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
            class1Details.typeParams.length !== class2Details.typeParams.length
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

        for (let i = 0; i < class1Details.typeParams.length; i++) {
            if (
                !isTypeSame(
                    class1Details.typeParams[i],
                    class2Details.typeParams[i],
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
            if (parentClassType.priv.literalValue !== undefined) {
                if (
                    subclassType.priv.literalValue === undefined ||
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

        // Handle the case where the subclass is a type[type[T]] and the parent
        // class is type.
        const subclassDepth = TypeBase.getInstantiableDepth(subclassType);
        if (subclassDepth > 0) {
            if (isBuiltIn(parentClassType, 'type') && TypeBase.getInstantiableDepth(parentClassType) < subclassDepth) {
                if (inheritanceChain) {
                    inheritanceChain.push(parentClassType);
                }
                return true;
            }
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

        for (const baseClass of subclassType.shared.baseClasses) {
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
        return classType.shared.mro.slice(0).reverse();
    }
}

export enum FunctionParamFlags {
    None = 0,

    // Is the name of the parameter synthesize internally?
    NameSynthesized = 1 << 0,

    // Does the parameter have an explicitly-declared type?
    TypeDeclared = 1 << 1,

    // Is the type of the parameter inferred?
    TypeInferred = 1 << 2,
}

export interface FunctionParam {
    category: ParamCategory;
    flags: FunctionParamFlags;
    name: string | undefined;

    // Use getParamType to access this field.
    // eslint-disable-next-line @typescript-eslint/naming-convention
    _type: Type;

    // Use getParamDefaultType to access this field.
    // eslint-disable-next-line @typescript-eslint/naming-convention
    _defaultType: Type | undefined;

    defaultExpr: ExpressionNode | undefined;
}

export namespace FunctionParam {
    export function create(
        category: ParamCategory,
        type: Type,
        flags = FunctionParamFlags.None,
        name?: string,
        defaultType?: Type,
        defaultExpr?: ExpressionNode
    ): FunctionParam {
        return { category, flags, name, _type: type, _defaultType: defaultType, defaultExpr };
    }

    export function isNameSynthesized(param: FunctionParam) {
        return !!(param.flags & FunctionParamFlags.NameSynthesized);
    }

    export function isTypeDeclared(param: FunctionParam) {
        return !!(param.flags & FunctionParamFlags.TypeDeclared);
    }

    export function isTypeInferred(param: FunctionParam) {
        return !!(param.flags & FunctionParamFlags.TypeInferred);
    }
}

export function isPositionOnlySeparator(param: FunctionParam) {
    // A simple parameter with no name is treated as a "/" separator.
    return param.category === ParamCategory.Simple && !param.name;
}

export function isKeywordOnlySeparator(param: FunctionParam) {
    // An *args parameter with no name is treated as a "*" separator.
    return param.category === ParamCategory.ArgsList && !param.name;
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

    // Function defined in one of the core stdlib modules.
    BuiltIn = 1 << 20,
}

interface FunctionDetailsShared {
    name: string;
    fullName: string;
    moduleName: string;
    flags: FunctionTypeFlags;
    typeParams: TypeVarType[];
    parameters: FunctionParam[];
    declaredReturnType: Type | undefined;
    declaration: FunctionDeclaration | undefined;
    typeVarScopeId: TypeVarScopeId | undefined;
    docString: string | undefined;
    deprecatedMessage: string | undefined;

    // If this is a method, this refers to the class that contains it.
    methodClass: ClassType | undefined;

    // Transforms to apply if this function is used
    // as a decorator.
    decoratorDataClassBehaviors: DataClassBehaviors | undefined;

    // Inferred return type. Filled in lazily.
    inferredReturnType?: {
        type: Type;
        isIncomplete?: boolean;
        evaluationCount?: number;
    };
}

export interface SpecializedFunctionTypes {
    // Specialized types for each of the parameters in the "parameters" array.
    parameterTypes: Type[];

    // Specialized types of default arguments for each parameter in
    // the "parameters" array. If an entry is undefined or the entire array
    // is missing, there is no specialized type, and the original "defaultType"
    // should be used.
    parameterDefaultTypes: (Type | undefined)[] | undefined;

    // Specialized type of the declared return type. Undefined if there is
    // no declared return type.
    returnType: Type | undefined;
}

export interface CallSiteInferenceTypeCacheEntry {
    paramTypes: Type[];
    returnType: Type;
}

export interface SignatureWithOffsets {
    type: FunctionType | OverloadedType;
    expressionOffsets: number[];
}

export interface FunctionDetailsPriv {
    // For __new__ and __init__ methods, the TypeVar scope ID of the
    // associated class.
    constructorTypeVarScopeId?: TypeVarScopeId | undefined;

    // A function type can be specialized (i.e. generic type
    // variables replaced by a concrete type).
    specializedTypes?: SpecializedFunctionTypes | undefined;

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

    // If this function is part of an overloaded function, this
    // refers back to the overloaded function type.
    overloaded?: OverloadedType;

    // If this function is created with a "Callable" annotation with
    // type arguments? This allows us to detect and report an error
    // when this is used in an isinstance call.
    isCallableWithTypeArgs?: boolean;
}

export interface FunctionType extends TypeBase<TypeCategory.Function> {
    shared: FunctionDetailsShared;
    priv: FunctionDetailsPriv;
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
        return create(name, name, '', additionalFlags | FunctionTypeFlags.SynthesizedMethod, TypeFlags.Instance);
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
            flags: typeFlags,
            props: undefined,
            cached: undefined,
            shared: {
                name,
                fullName,
                moduleName,
                flags: functionFlags,
                typeParams: [],
                parameters: [],
                declaredReturnType: undefined,
                declaration: undefined,
                typeVarScopeId: undefined,
                docString,
                deprecatedMessage: undefined,
                methodClass: undefined,
                decoratorDataClassBehaviors: undefined,
            },
            priv: {},
        };
        return newFunctionType;
    }

    // Creates a deep copy of the function type, including a fresh
    // version of _functionDetails.
    export function clone(type: FunctionType, stripFirstParam = false, boundToType?: ClassType): FunctionType {
        const newFunction = TypeBase.cloneType(type);

        newFunction.shared = { ...type.shared };
        newFunction.priv.preBoundFlags = newFunction.shared.flags;
        newFunction.priv.boundToType = boundToType;

        if (boundToType) {
            if (type.shared.name === '__new__' || type.shared.name === '__init__') {
                newFunction.priv.constructorTypeVarScopeId = boundToType.shared.typeVarScopeId;
            }
        }

        if (stripFirstParam) {
            if (type.shared.parameters.length > 0) {
                if (type.shared.parameters[0].category === ParamCategory.Simple) {
                    if (type.shared.parameters.length > 0) {
                        // Stash away the effective type of the first parameter or
                        // Any if it was inferred.
                        newFunction.priv.strippedFirstParamType = FunctionParam.isTypeInferred(
                            type.shared.parameters[0]
                        )
                            ? AnyType.create()
                            : getParamType(type, 0);
                    }
                    newFunction.shared.parameters = type.shared.parameters.slice(1);
                }
            } else {
                stripFirstParam = false;
            }
        }

        if (type.props?.typeAliasInfo) {
            TypeBase.setTypeAliasInfo(newFunction, type.props.typeAliasInfo);
        }

        if (type.priv.specializedTypes) {
            newFunction.priv.specializedTypes = {
                parameterTypes: stripFirstParam
                    ? type.priv.specializedTypes.parameterTypes.slice(1)
                    : type.priv.specializedTypes.parameterTypes,
                parameterDefaultTypes: stripFirstParam
                    ? type.priv.specializedTypes.parameterDefaultTypes?.slice(1)
                    : type.priv.specializedTypes.parameterDefaultTypes,
                returnType: type.priv.specializedTypes.returnType,
            };
        }

        newFunction.shared.inferredReturnType = type.shared.inferredReturnType;

        return newFunction;
    }

    export function cloneAsInstance(type: FunctionType): FunctionType {
        if (type.cached?.typeBaseInstanceType) {
            return type.cached.typeBaseInstanceType as FunctionType;
        }

        const newInstance = TypeBase.cloneTypeAsInstance(type, /* cache */ true);
        if (newInstance.props?.specialForm) {
            TypeBase.setSpecialForm(newInstance, undefined);
        }
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
    export function specialize(type: FunctionType, specializedTypes: SpecializedFunctionTypes): FunctionType {
        const newFunction = TypeBase.cloneType(type);

        assert(specializedTypes.parameterTypes.length === type.shared.parameters.length);
        if (specializedTypes.parameterDefaultTypes) {
            assert(specializedTypes.parameterDefaultTypes.length === type.shared.parameters.length);
        }

        newFunction.priv.specializedTypes = specializedTypes;
        return newFunction;
    }

    // Creates a new function based on the parameters of another function.
    export function applyParamSpecValue(type: FunctionType, paramSpecValue: FunctionType): FunctionType {
        const hasPositionalOnly = paramSpecValue.shared.parameters.some((param) => isPositionOnlySeparator(param));
        const newFunction = FunctionType.cloneRemoveParamSpecArgsKwargs(TypeBase.cloneType(type), hasPositionalOnly);
        const paramSpec = FunctionType.getParamSpecFromArgsKwargs(type);
        assert(paramSpec !== undefined);

        // Make a shallow clone of the details.
        newFunction.shared = { ...newFunction.shared };

        newFunction.shared.typeParams = newFunction.shared.typeParams.filter((t) => !isTypeSame(t, paramSpec));

        const prevParams = Array.from(newFunction.shared.parameters);

        newFunction.shared.parameters = [
            ...prevParams,
            ...paramSpecValue.shared.parameters.map((param, index) => {
                return FunctionParam.create(
                    param.category,
                    FunctionType.getParamType(paramSpecValue, index),
                    (param.flags & FunctionParamFlags.NameSynthesized) | FunctionParamFlags.TypeDeclared,
                    param.name,
                    FunctionType.getParamDefaultType(paramSpecValue, index),
                    param.defaultExpr
                );
            }),
        ];

        if (newFunction.shared.docString === undefined) {
            newFunction.shared.docString = paramSpecValue.shared.docString;
        }

        if (newFunction.shared.deprecatedMessage === undefined) {
            newFunction.shared.deprecatedMessage = paramSpecValue.shared.deprecatedMessage;
        }

        const origFlagsMask = FunctionTypeFlags.Overloaded | FunctionTypeFlags.ParamSpecValue;
        newFunction.shared.flags = type.shared.flags & origFlagsMask;

        const methodFlagsMask =
            FunctionTypeFlags.ClassMethod | FunctionTypeFlags.StaticMethod | FunctionTypeFlags.ConstructorMethod;

        // If the original function was a method, use its method type. Otherwise
        // use the method type of the param spec.
        if (type.shared.methodClass) {
            newFunction.shared.flags |= type.shared.flags & methodFlagsMask;
        } else {
            newFunction.shared.flags |= paramSpecValue.shared.flags & methodFlagsMask;
        }

        // Use the "..." flag from the param spec.
        newFunction.shared.flags |= paramSpecValue.shared.flags & FunctionTypeFlags.GradualCallableForm;

        // Mark the function as synthesized since there is no user-defined declaration for it.
        newFunction.shared.flags |= FunctionTypeFlags.SynthesizedMethod;
        if (newFunction.shared.declaration) {
            newFunction.shared.declaration = undefined;
        }

        // Update the specialized parameter types as well.
        const specializedTypes = newFunction.priv.specializedTypes;
        if (specializedTypes) {
            paramSpecValue.shared.parameters.forEach((_, index) => {
                specializedTypes.parameterTypes.push(FunctionType.getParamType(paramSpecValue, index));

                if (specializedTypes.parameterDefaultTypes) {
                    specializedTypes.parameterDefaultTypes?.push(
                        FunctionType.getParamDefaultType(paramSpecValue, index)
                    );
                }
            });
        }

        newFunction.priv.constructorTypeVarScopeId = paramSpecValue.priv.constructorTypeVarScopeId;

        if (!newFunction.shared.methodClass && paramSpecValue.shared.methodClass) {
            newFunction.shared.methodClass = paramSpecValue.shared.methodClass;
        }

        return newFunction;
    }

    export function cloneWithNewFlags(type: FunctionType, flags: FunctionTypeFlags): FunctionType {
        const newFunction = TypeBase.cloneType(type);

        // Make a shallow clone of the details.
        newFunction.shared = { ...type.shared };
        newFunction.shared.flags = flags;

        return newFunction;
    }

    export function cloneWithNewTypeVarScopeId(
        type: FunctionType,
        newScopeId: TypeVarScopeId | undefined,
        newConstructorScopeId: TypeVarScopeId | undefined,
        typeParams: TypeVarType[]
    ): FunctionType {
        const newFunction = TypeBase.cloneType(type);

        // Make a shallow clone of the details.
        newFunction.shared = { ...type.shared };
        newFunction.shared.typeVarScopeId = newScopeId;
        newFunction.priv.constructorTypeVarScopeId = newConstructorScopeId;
        newFunction.shared.typeParams = typeParams;

        return newFunction;
    }

    export function cloneWithDocString(type: FunctionType, docString?: string): FunctionType {
        const newFunction = TypeBase.cloneType(type);

        // Make a shallow clone of the details.
        newFunction.shared = { ...type.shared };

        newFunction.shared.docString = docString;

        return newFunction;
    }

    export function cloneWithDeprecatedMessage(type: FunctionType, deprecatedMessage?: string): FunctionType {
        const newFunction = TypeBase.cloneType(type);

        // Make a shallow clone of the details.
        newFunction.shared = { ...type.shared };

        newFunction.shared.deprecatedMessage = deprecatedMessage;

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
        const paramCount = type.shared.parameters.length;
        if (paramCount < 2) {
            return type;
        }

        const argsParam = type.shared.parameters[paramCount - 2];
        const kwargsParam = type.shared.parameters[paramCount - 1];

        if (argsParam.category !== ParamCategory.ArgsList || kwargsParam.category !== ParamCategory.KwargsDict) {
            return type;
        }

        const argsType = FunctionType.getParamType(type, paramCount - 2);
        const kwargsType = FunctionType.getParamType(type, paramCount - 1);
        if (!isParamSpec(argsType) || !isParamSpec(kwargsType) || !isTypeSame(argsType, kwargsType)) {
            return type;
        }

        const newFunction = TypeBase.cloneType(type);

        // Make a shallow clone of the details.
        newFunction.shared = { ...type.shared };
        const details = newFunction.shared;

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

        if (type.priv.specializedTypes) {
            newFunction.priv.specializedTypes = { ...type.priv.specializedTypes };
            newFunction.priv.specializedTypes.parameterTypes = newFunction.priv.specializedTypes.parameterTypes.slice(
                0,
                newFunction.priv.specializedTypes.parameterTypes.length - paramsToDrop
            );
            if (newFunction.priv.specializedTypes.parameterDefaultTypes) {
                newFunction.priv.specializedTypes.parameterDefaultTypes =
                    newFunction.priv.specializedTypes.parameterDefaultTypes.slice(
                        0,
                        newFunction.priv.specializedTypes.parameterDefaultTypes.length - paramsToDrop
                    );
            }
        }

        if (type.shared.inferredReturnType) {
            newFunction.shared.inferredReturnType = type.shared.inferredReturnType;
        }

        return newFunction;
    }

    // If the function ends with "*args: P.args, **kwargs: P.kwargs", this function
    // returns P. Otherwise, it returns undefined.
    export function getParamSpecFromArgsKwargs(type: FunctionType): ParamSpecType | undefined {
        const params = type.shared.parameters;
        if (params.length < 2) {
            return undefined;
        }

        const secondLastParam = params[params.length - 2];
        const secondLastParamType = FunctionType.getParamType(type, params.length - 2);
        const lastParam = params[params.length - 1];
        const lastParamType = FunctionType.getParamType(type, params.length - 1);

        if (
            secondLastParam.category === ParamCategory.ArgsList &&
            isParamSpec(secondLastParamType) &&
            secondLastParamType.priv.paramSpecAccess === 'args' &&
            lastParam.category === ParamCategory.KwargsDict &&
            isParamSpec(lastParamType) &&
            lastParamType.priv.paramSpecAccess === 'kwargs'
        ) {
            return TypeVarType.cloneForParamSpecAccess(secondLastParamType, /* access */ undefined);
        }

        return undefined;
    }

    export function addParamSpecVariadics(type: FunctionType, paramSpec: ParamSpecType) {
        FunctionType.addParam(
            type,
            FunctionParam.create(
                ParamCategory.ArgsList,
                TypeVarType.cloneForParamSpecAccess(paramSpec, 'args'),
                FunctionParamFlags.TypeDeclared,
                'args'
            )
        );

        FunctionType.addParam(
            type,
            FunctionParam.create(
                ParamCategory.KwargsDict,
                TypeVarType.cloneForParamSpecAccess(paramSpec, 'kwargs'),
                FunctionParamFlags.TypeDeclared,
                'kwargs'
            )
        );
    }

    export function addDefaultParams(type: FunctionType, useUnknown = false) {
        getDefaultParams(useUnknown).forEach((param) => {
            FunctionType.addParam(type, param);
        });
    }

    export function getDefaultParams(useUnknown = false): FunctionParam[] {
        return [
            FunctionParam.create(
                ParamCategory.ArgsList,
                useUnknown ? UnknownType.create() : AnyType.create(),
                useUnknown ? FunctionParamFlags.None : FunctionParamFlags.TypeDeclared,
                'args'
            ),
            FunctionParam.create(
                ParamCategory.KwargsDict,
                useUnknown ? UnknownType.create() : AnyType.create(),
                useUnknown ? FunctionParamFlags.None : FunctionParamFlags.TypeDeclared,
                'kwargs'
            ),
        ];
    }

    // Indicates whether the input signature consists of (*args: Any, **kwargs: Any).
    export function hasDefaultParams(functionType: FunctionType): boolean {
        let sawArgs = false;
        let sawKwargs = false;

        for (let i = 0; i < functionType.shared.parameters.length; i++) {
            const param = functionType.shared.parameters[i];

            // Ignore nameless separator parameters.
            if (!param.name) {
                continue;
            }

            if (param.category === ParamCategory.Simple) {
                return false;
            } else if (param.category === ParamCategory.ArgsList) {
                sawArgs = true;
            } else if (param.category === ParamCategory.KwargsDict) {
                sawKwargs = true;
            }

            if (!isAnyOrUnknown(FunctionType.getParamType(functionType, i))) {
                return false;
            }
        }

        return sawArgs && sawKwargs;
    }

    export function isInstanceMethod(type: FunctionType): boolean {
        return (
            (type.shared.flags &
                (FunctionTypeFlags.ConstructorMethod |
                    FunctionTypeFlags.StaticMethod |
                    FunctionTypeFlags.ClassMethod)) ===
            0
        );
    }

    export function isConstructorMethod(type: FunctionType): boolean {
        return (type.shared.flags & FunctionTypeFlags.ConstructorMethod) !== 0;
    }

    export function isStaticMethod(type: FunctionType): boolean {
        return (type.shared.flags & FunctionTypeFlags.StaticMethod) !== 0;
    }

    export function isClassMethod(type: FunctionType): boolean {
        return (type.shared.flags & FunctionTypeFlags.ClassMethod) !== 0;
    }

    export function isAbstractMethod(type: FunctionType): boolean {
        return (type.shared.flags & FunctionTypeFlags.AbstractMethod) !== 0;
    }

    export function isGenerator(type: FunctionType): boolean {
        return (type.shared.flags & FunctionTypeFlags.Generator) !== 0;
    }

    export function isSynthesizedMethod(type: FunctionType): boolean {
        return (type.shared.flags & FunctionTypeFlags.SynthesizedMethod) !== 0;
    }

    export function isTypeCheckOnly(type: FunctionType): boolean {
        return (type.shared.flags & FunctionTypeFlags.TypeCheckOnly) !== 0;
    }

    export function isOverloaded(type: FunctionType): boolean {
        return (type.shared.flags & FunctionTypeFlags.Overloaded) !== 0;
    }

    export function isDefaultParamCheckDisabled(type: FunctionType) {
        return (type.shared.flags & FunctionTypeFlags.DisableDefaultChecks) !== 0;
    }

    export function isAsync(type: FunctionType) {
        return (type.shared.flags & FunctionTypeFlags.Async) !== 0;
    }

    export function isStubDefinition(type: FunctionType) {
        return (type.shared.flags & FunctionTypeFlags.StubDefinition) !== 0;
    }

    export function isPyTypedDefinition(type: FunctionType) {
        return (type.shared.flags & FunctionTypeFlags.PyTypedDefinition) !== 0;
    }

    export function isFinal(type: FunctionType) {
        return (type.shared.flags & FunctionTypeFlags.Final) !== 0;
    }

    export function hasUnannotatedParams(type: FunctionType) {
        return (type.shared.flags & FunctionTypeFlags.UnannotatedParams) !== 0;
    }

    export function isGradualCallableForm(type: FunctionType) {
        return (type.shared.flags & FunctionTypeFlags.GradualCallableForm) !== 0;
    }

    export function isParamSpecValue(type: FunctionType) {
        return (type.shared.flags & FunctionTypeFlags.ParamSpecValue) !== 0;
    }

    export function isPartiallyEvaluated(type: FunctionType) {
        return !!(type.shared.flags & FunctionTypeFlags.PartiallyEvaluated);
    }

    export function isOverridden(type: FunctionType) {
        return !!(type.shared.flags & FunctionTypeFlags.Overridden);
    }

    export function isBuiltIn(type: FunctionType, name?: string | string[]) {
        if (!(type.shared.flags & FunctionTypeFlags.BuiltIn)) {
            return false;
        }

        if (name !== undefined) {
            const functionArray = Array.isArray(name) ? name : [name];
            return functionArray.some((name) => name === type.shared.name || name === type.shared.fullName);
        }

        return true;
    }

    export function getDeclaredParamType(type: FunctionType, index: number): Type {
        return type.shared.parameters[index]._type;
    }

    export function getParamType(type: FunctionType, index: number): Type {
        assert(index < type.shared.parameters.length, 'Parameter types array overflow');

        if (type.priv.specializedTypes && index < type.priv.specializedTypes.parameterTypes.length) {
            return type.priv.specializedTypes.parameterTypes[index];
        }

        return type.shared.parameters[index]._type;
    }

    export function getParamDefaultType(type: FunctionType, index: number): Type | undefined {
        assert(index < type.shared.parameters.length, 'Parameter types array overflow');

        if (
            type.priv.specializedTypes?.parameterDefaultTypes &&
            index < type.priv.specializedTypes.parameterDefaultTypes.length
        ) {
            const defaultArgType = type.priv.specializedTypes.parameterDefaultTypes[index];
            if (defaultArgType) {
                return defaultArgType;
            }
        }

        return type.shared.parameters[index]._defaultType;
    }

    export function addParam(type: FunctionType, param: FunctionParam) {
        type.shared.parameters.push(param);

        if (type.priv.specializedTypes) {
            type.priv.specializedTypes.parameterTypes.push(param._type);
        }
    }

    export function addPositionOnlyParamSeparator(type: FunctionType) {
        addParam(type, FunctionParam.create(ParamCategory.Simple, AnyType.create()));
    }

    export function addKeywordOnlyParamSeparator(type: FunctionType) {
        addParam(type, FunctionParam.create(ParamCategory.ArgsList, AnyType.create()));
    }

    export function getEffectiveReturnType(type: FunctionType, includeInferred = true): Type | undefined {
        if (type.priv.specializedTypes?.returnType) {
            return type.priv.specializedTypes.returnType;
        }

        if (type.shared.declaredReturnType) {
            return type.shared.declaredReturnType;
        }

        if (includeInferred) {
            return type.shared.inferredReturnType?.type;
        }

        return undefined;
    }
}

export interface OverloadedDetailsPriv {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    _overloads: FunctionType[];

    // eslint-disable-next-line @typescript-eslint/naming-convention
    _implementation: Type | undefined;
}

export interface OverloadedType extends TypeBase<TypeCategory.Overloaded> {
    priv: OverloadedDetailsPriv;
}

export namespace OverloadedType {
    export function create(overloads: FunctionType[], implementation?: Type): OverloadedType {
        const newType: OverloadedType = {
            category: TypeCategory.Overloaded,
            flags: TypeFlags.Instance,
            props: undefined,
            cached: undefined,
            shared: undefined,
            priv: {
                _overloads: [],
                _implementation: implementation,
            },
        };

        overloads.forEach((overload) => {
            OverloadedType.addOverload(newType, overload);
        });

        if (implementation && isFunction(implementation)) {
            implementation.priv.overloaded = newType;
        }

        return newType;
    }

    // Adds a new overload or an implementation.
    export function addOverload(type: OverloadedType, functionType: FunctionType) {
        functionType.priv.overloaded = type;
        type.priv._overloads.push(functionType);
    }

    export function getOverloads(type: OverloadedType): FunctionType[] {
        return type.priv._overloads;
    }

    export function getImplementation(type: OverloadedType): Type | undefined {
        return type.priv._implementation;
    }
}

export interface NeverDetailsPriv {
    isNoReturn: boolean;
}

export interface NeverType extends TypeBase<TypeCategory.Never> {
    priv: NeverDetailsPriv;
}

export namespace NeverType {
    const _neverInstance: NeverType = {
        category: TypeCategory.Never,
        flags: TypeFlags.Instance | TypeFlags.Instantiable,
        props: undefined,
        cached: undefined,
        shared: undefined,
        priv: { isNoReturn: false },
    };

    const _noReturnInstance: NeverType = {
        category: TypeCategory.Never,
        flags: TypeFlags.Instance | TypeFlags.Instantiable,
        props: undefined,
        cached: undefined,
        shared: undefined,
        priv: { isNoReturn: true },
    };

    export function createNever() {
        return _neverInstance;
    }

    export function createNoReturn() {
        return _noReturnInstance;
    }

    export function convertToInstance(type: NeverType): NeverType {
        // Remove the specialForm or typeForm if present. Otherwise return the existing type.
        if (!type.props?.specialForm && !type.props?.typeForm) {
            return type;
        }

        return type.priv.isNoReturn ? NeverType.createNoReturn() : NeverType.createNever();
    }
}

export interface AnyDetailsPriv {
    isEllipsis: boolean;
}

export interface AnyType extends TypeBase<TypeCategory.Any> {
    priv: AnyDetailsPriv;
}

export namespace AnyType {
    const _anyInstanceSpecialForm: AnyType = {
        category: TypeCategory.Any,
        flags: TypeFlags.Instance | TypeFlags.Instantiable,
        props: undefined,
        cached: undefined,
        shared: undefined,
        priv: { isEllipsis: false },
    };

    const _anyInstance: AnyType = {
        category: TypeCategory.Any,
        flags: TypeFlags.Instance | TypeFlags.Instantiable,
        props: undefined,
        cached: undefined,
        shared: undefined,
        priv: { isEllipsis: false },
    };

    const _ellipsisInstance: AnyType = {
        category: TypeCategory.Any,
        flags: TypeFlags.Instance | TypeFlags.Instantiable,
        props: undefined,
        cached: undefined,
        shared: undefined,
        priv: { isEllipsis: true },
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
        return type.props?.specialForm ? AnyType.create() : type;
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
        if (c1.typeVar.shared.name < c2.typeVar.shared.name) {
            return -1;
        } else if (c1.typeVar.shared.name > c2.typeVar.shared.name) {
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
                    c1.typeVar.priv.nameWithScope !== conditions2[index].typeVar.priv.nameWithScope ||
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
                if (c1.typeVar.priv.nameWithScope === c2.typeVar.priv.nameWithScope) {
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
    literalStrMap: Map<string, UnionableType> | undefined;
    literalIntMap: Map<bigint | number, UnionableType> | undefined;
    literalEnumMap: Map<string, UnionableType> | undefined;
}

export interface UnionDetailsPriv {
    subtypes: UnionableType[];
    literalInstances: LiteralTypes;
    literalClasses: LiteralTypes;
    typeAliasSources: Set<UnionType> | undefined;
    includesRecursiveTypeAlias: boolean;
}

export interface UnionType extends TypeBase<TypeCategory.Union> {
    priv: UnionDetailsPriv;
}

export namespace UnionType {
    export function create() {
        const newUnionType: UnionType = {
            category: TypeCategory.Union,
            flags: TypeFlags.Instance | TypeFlags.Instantiable,
            props: undefined,
            cached: undefined,
            shared: undefined,
            priv: {
                subtypes: [],
                literalInstances: {
                    literalStrMap: undefined,
                    literalIntMap: undefined,
                    literalEnumMap: undefined,
                },
                literalClasses: {
                    literalStrMap: undefined,
                    literalIntMap: undefined,
                    literalEnumMap: undefined,
                },
                typeAliasSources: undefined,
                includesRecursiveTypeAlias: false,
            },
        };

        return newUnionType;
    }

    export function addType(unionType: UnionType, newType: UnionableType) {
        // If we're adding a string, integer or enum literal, add it to the
        // corresponding literal map to speed up some operations. It's not
        // uncommon for unions to contain hundreds of literals.
        if (isClass(newType) && newType.priv.literalValue !== undefined && !newType.props?.condition) {
            const literalMaps = isClassInstance(newType)
                ? unionType.priv.literalInstances
                : unionType.priv.literalClasses;

            if (ClassType.isBuiltIn(newType, 'str')) {
                if (literalMaps.literalStrMap === undefined) {
                    literalMaps.literalStrMap = new Map<string, UnionableType>();
                }
                literalMaps.literalStrMap.set(newType.priv.literalValue as string, newType);
            } else if (ClassType.isBuiltIn(newType, 'int')) {
                if (literalMaps.literalIntMap === undefined) {
                    literalMaps.literalIntMap = new Map<bigint | number, UnionableType>();
                }
                literalMaps.literalIntMap.set(newType.priv.literalValue as number | bigint, newType);
            } else if (ClassType.isEnumClass(newType)) {
                if (literalMaps.literalEnumMap === undefined) {
                    literalMaps.literalEnumMap = new Map<string, UnionableType>();
                }
                const enumLiteral = newType.priv.literalValue as EnumLiteral;
                literalMaps.literalEnumMap.set(enumLiteral.getName(), newType);
            }
        }

        unionType.flags &= newType.flags;
        unionType.priv.subtypes.push(newType);

        if (isTypeVar(newType) && newType.shared.recursiveAlias?.name) {
            // Note that at least one recursive type alias was included in
            // this union. We'll need to expand it before the union is used.
            unionType.priv.includesRecursiveTypeAlias = true;
        }
    }

    // Determines whether the union contains a specified subtype. If exclusionSet is passed,
    // the method skips any subtype indexes that are in the set and adds a found index to
    // the exclusion set. This speeds up union type comparisons.
    export function containsType(
        unionType: UnionType,
        subtype: Type,
        options: TypeSameOptions = {},
        exclusionSet?: Set<number>,
        recursionCount = 0
    ): boolean {
        // Handle string literals as a special case because unions can sometimes
        // contain hundreds of string literal types.
        if (isClass(subtype) && subtype.props?.condition === undefined && subtype.priv.literalValue !== undefined) {
            const literalMaps = isClassInstance(subtype)
                ? unionType.priv.literalInstances
                : unionType.priv.literalClasses;

            if (ClassType.isBuiltIn(subtype, 'str') && literalMaps.literalStrMap !== undefined) {
                return literalMaps.literalStrMap.has(subtype.priv.literalValue as string);
            } else if (ClassType.isBuiltIn(subtype, 'int') && literalMaps.literalIntMap !== undefined) {
                return literalMaps.literalIntMap.has(subtype.priv.literalValue as number | bigint);
            } else if (ClassType.isEnumClass(subtype) && literalMaps.literalEnumMap !== undefined) {
                const enumLiteral = subtype.priv.literalValue as EnumLiteral;
                return literalMaps.literalEnumMap.has(enumLiteral.getName());
            }
        }

        const foundIndex = unionType.priv.subtypes.findIndex((t, i) => {
            if (exclusionSet?.has(i)) {
                return false;
            }

            return isTypeSame(t, subtype, options, recursionCount);
        });

        if (foundIndex < 0) {
            return false;
        }

        exclusionSet?.add(foundIndex);
        return true;
    }

    export function addTypeAliasSource(unionType: UnionType, typeAliasSource: Type) {
        if (typeAliasSource.category === TypeCategory.Union) {
            const sourcesToAdd = typeAliasSource.props?.typeAliasInfo
                ? [typeAliasSource]
                : typeAliasSource.priv.typeAliasSources;

            if (sourcesToAdd) {
                if (!unionType.priv.typeAliasSources) {
                    unionType.priv.typeAliasSources = new Set<UnionType>();
                }

                sourcesToAdd.forEach((source) => {
                    unionType.priv.typeAliasSources!.add(source);
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

export interface RecursiveAliasInfo {
    // Used for recursive type aliases.
    name: string;
    scopeId: TypeVarScopeId;
    isPep695Syntax: boolean;

    // Type parameters for a recursive type alias.
    typeParams: TypeVarType[] | undefined;
}

export enum TypeVarKind {
    TypeVar,
    TypeVarTuple,
    ParamSpec,
}

export interface TypeVarDetailsShared {
    kind: TypeVarKind;
    name: string;
    constraints: Type[];
    boundType: Type | undefined;
    isDefaultExplicit: boolean;
    defaultType: Type;

    declaredVariance: Variance;

    // Internally created (e.g. for pseudo-generic classes)
    isSynthesized: boolean;
    isSynthesizedSelf: boolean;
    synthesizedIndex: number | undefined;
    isExemptFromBoundCheck: boolean;

    // Does this type variable originate from PEP 695 type parameter syntax?
    isTypeParamSyntax: boolean;

    // Information about recursive type aliases.
    recursiveAlias: TypeAliasSharedInfo | undefined;
}

export type ParamSpecAccess = 'args' | 'kwargs';

export const enum TypeVarScopeType {
    Class,
    Function,
    TypeAlias,
}

export interface TypeVarDetailsPriv {
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

    // May be different from declaredVariance if declared as Auto
    computedVariance?: Variance;

    // When a TypeVar appears within an expected type during bidirectional
    // type inference, it needs to be solved along with the in-scope TypeVars.
    // This is done by cloning the TypeVar and making it a "unification"
    // variable.
    isUnificationVar?: boolean;

    // If the TypeVar is bound form of a TypeVar, this refers to
    // the corresponding free TypeVar.
    freeTypeVar?: TypeVarType | undefined;

    // Is this TypeVar or TypeVarTuple unpacked (i.e. Unpack or * operator applied)?
    isUnpacked?: boolean | undefined;
}

export interface TypeVarType extends TypeBase<TypeCategory.TypeVar> {
    shared: TypeVarDetailsShared;
    priv: TypeVarDetailsPriv;
}

export interface ParamSpecDetailsPriv extends TypeVarDetailsPriv {
    // Represents access to "args" or "kwargs" of a ParamSpec
    paramSpecAccess?: ParamSpecAccess;

    freeTypeVar?: ParamSpecType | undefined;
}

export interface ParamSpecType extends TypeVarType {
    shared: TypeVarDetailsShared & { kind: TypeVarKind.ParamSpec };
    priv: ParamSpecDetailsPriv;
}

export namespace ParamSpecType {
    // Returns the "Unknown" equivalent for a ParamSpec.
    export function getUnknown(): FunctionType {
        const newFunction = FunctionType.createInstance(
            '',
            '',
            '',
            FunctionTypeFlags.ParamSpecValue | FunctionTypeFlags.GradualCallableForm
        );
        FunctionType.addDefaultParams(newFunction);
        return newFunction;
    }
}

export interface TypeVarTupleDetailsPriv extends TypeVarDetailsPriv {
    // Is this TypeVarTuple included in a Union[]? This allows us to
    // differentiate between Unpack[Vs] and Union[Unpack[Vs]].
    isInUnion?: boolean | undefined;

    freeTypeVar?: TypeVarTupleType | undefined;
}

export interface TypeVarTupleType extends TypeVarType {
    shared: TypeVarDetailsShared & { kind: TypeVarKind.TypeVarTuple };
    priv: TypeVarTupleDetailsPriv;
}

export namespace TypeVarType {
    export function createInstance(name: string, kind: TypeVarKind = TypeVarKind.TypeVar) {
        return create(name, kind, TypeFlags.Instance);
    }

    export function createInstantiable(name: string, kind: TypeVarKind = TypeVarKind.TypeVar) {
        return create(name, kind, TypeFlags.Instantiable);
    }

    export function cloneAsInstance(type: TypeVarType): TypeVarType {
        assert(TypeBase.isInstantiable(type));

        if (type.cached?.typeBaseInstanceType) {
            return type.cached.typeBaseInstanceType as TypeVarType;
        }

        const newInstance = TypeBase.cloneTypeAsInstance(type, /* cache */ true);
        if (newInstance.props?.specialForm) {
            TypeBase.setSpecialForm(newInstance, undefined);
        }

        if (newInstance.priv.freeTypeVar) {
            newInstance.priv.freeTypeVar = TypeVarType.cloneAsInstance(newInstance.priv.freeTypeVar);
        }

        return newInstance;
    }

    export function cloneAsInstantiable(type: TypeVarType): TypeVarType {
        if (type.cached?.typeBaseInstantiableType) {
            return type.cached.typeBaseInstantiableType as TypeVarType;
        }

        const newInstance = TypeBase.cloneTypeAsInstantiable(type, /* cache */ true);

        if (newInstance.priv.freeTypeVar) {
            newInstance.priv.freeTypeVar = TypeVarType.cloneAsInstantiable(newInstance.priv.freeTypeVar);
        }

        return newInstance;
    }

    export function cloneForNewName(type: TypeVarType, name: string): TypeVarType {
        const newInstance = TypeBase.cloneType(type);
        newInstance.shared = { ...type.shared };
        newInstance.shared.name = name;

        if (newInstance.priv.scopeId) {
            newInstance.priv.nameWithScope = makeNameWithScope(
                name,
                newInstance.priv.scopeId,
                newInstance.priv.scopeName ?? ''
            );
        }

        return newInstance;
    }

    export function cloneForScopeId(
        type: TypeVarType,
        scopeId: string,
        scopeName: string | undefined,
        scopeType: TypeVarScopeType | undefined
    ): TypeVarType {
        const newInstance = TypeBase.cloneType(type);
        newInstance.priv.nameWithScope = makeNameWithScope(type.shared.name, scopeId, scopeName ?? '');
        newInstance.priv.scopeId = scopeId;
        newInstance.priv.scopeName = scopeName;
        newInstance.priv.scopeType = scopeType;
        return newInstance;
    }

    export function cloneForUnpacked(type: TypeVarType, isInUnion = false) {
        const newInstance = TypeBase.cloneType(type);
        newInstance.priv.isUnpacked = true;

        if (isTypeVarTuple(newInstance) && isInUnion) {
            newInstance.priv.isInUnion = isInUnion;
        }

        if (newInstance.priv.freeTypeVar) {
            newInstance.priv.freeTypeVar = TypeVarType.cloneForUnpacked(newInstance.priv.freeTypeVar, isInUnion);
        }
        return newInstance;
    }

    export function cloneForPacked(type: TypeVarType) {
        const newInstance = TypeBase.cloneType(type);
        newInstance.priv.isUnpacked = false;

        if (isTypeVarTuple(newInstance)) {
            newInstance.priv.isInUnion = false;
        }

        if (newInstance.priv.freeTypeVar) {
            newInstance.priv.freeTypeVar = TypeVarType.cloneForPacked(newInstance.priv.freeTypeVar);
        }
        return newInstance;
    }

    // Creates a "simplified" version of the TypeVar with invariance
    // and no bound or constraints. ParamSpecs and TypeVarTuples are left
    // unmodified. So are auto-variant type variables.
    export function cloneAsInvariant(type: TypeVarType): TypeVarType {
        if (isParamSpec(type) || isTypeVarTuple(type)) {
            return type;
        }

        if (type.shared.declaredVariance === Variance.Auto) {
            return type;
        }

        if (type.shared.declaredVariance === Variance.Invariant) {
            if (!TypeVarType.hasBound(type) && !TypeVarType.hasConstraints(type)) {
                return type;
            }
        }

        const newInstance = TypeBase.cloneType(type);
        newInstance.shared = { ...newInstance.shared };
        newInstance.shared.declaredVariance = Variance.Invariant;
        newInstance.shared.boundType = undefined;
        newInstance.shared.constraints = [];
        return newInstance;
    }

    export function cloneForParamSpecAccess(type: ParamSpecType, access: ParamSpecAccess | undefined): ParamSpecType {
        const newInstance = TypeBase.cloneType(type);
        newInstance.priv.paramSpecAccess = access;
        return newInstance;
    }

    export function cloneAsSpecializedSelf(type: TypeVarType, specializedBoundType: Type): TypeVarType {
        assert(TypeVarType.isSelf(type));
        const newInstance = TypeBase.cloneType(type);
        newInstance.shared = { ...newInstance.shared };
        newInstance.shared.boundType = specializedBoundType;
        return newInstance;
    }

    export function cloneAsUnificationVar(type: TypeVarType, usageOffset?: number): TypeVarType {
        if (TypeVarType.isUnification(type)) {
            return type;
        }

        // If the caller specified a usage offset, append it to the TypeVar
        // internal name. This allows us to distinguish it from other uses
        // of the same TypeVar. For example nested calls to a generic
        // function like `foo(foo(1))`.
        let newNameWithScope = type.priv.nameWithScope;
        if (usageOffset) {
            newNameWithScope = `${type.priv.nameWithScope}-${usageOffset}`;
        }

        const newInstance = TypeBase.cloneType(type);
        newInstance.priv.isUnificationVar = true;
        newInstance.priv.scopeId = UnificationScopeId;
        newInstance.priv.nameWithScope = newNameWithScope;
        return newInstance;
    }

    export function cloneWithComputedVariance(type: TypeVarType, computedVariance: Variance): TypeVarType {
        const newInstance = TypeBase.cloneType(type);
        newInstance.priv.computedVariance = computedVariance;
        return newInstance;
    }

    export function makeNameWithScope(name: string, scopeId: string, scopeName: string) {
        // We include the scopeName here even though it's normally already part
        // of the scopeId. There are cases where it can diverge, specifically
        // in scenarios involving higher-order functions that return generic
        // callable types. See adjustCallableReturnType for details.
        return `${name}.${scopeId}.${scopeName}`;
    }

    // When solving the TypeVars for a callable, we need to distinguish between
    // the externally-visible "free" type vars and the internal "bound" type vars.
    // The distinction is important for recursive calls (e.g. calling a constructor
    // for a generic class within the class implementation).
    export function makeBoundScopeId(scopeId: TypeVarScopeId): TypeVarScopeId;
    export function makeBoundScopeId(scopeId: TypeVarScopeId | undefined): TypeVarScopeId | undefined;
    export function makeBoundScopeId(scopeId: TypeVarScopeId | undefined): TypeVarScopeId | undefined {
        if (!scopeId) {
            return undefined;
        }

        // Append an asterisk to denote a bound scope.
        return `${scopeId}*`;
    }

    export function cloneAsBound(type: TypeVarType): TypeVarType {
        if (type.priv.scopeId === undefined || type.priv.freeTypeVar) {
            return type;
        }

        const clone = TypeVarType.cloneForScopeId(
            type,
            TypeVarType.makeBoundScopeId(type.priv.scopeId),
            type.priv.scopeName,
            type.priv.scopeType
        );

        clone.priv.freeTypeVar = type;

        return clone;
    }

    // Indicates that the type var is a "free" or unbound type var. Free
    // type variables can be solved whereas bound type vars are already bound
    // to a value.
    export function isBound(type: TypeVarType) {
        // If the type var has an associated free type var, then it's
        // considered bound. If it has no associated free var, then it's
        // considered free.
        return !!type.priv.freeTypeVar;
    }

    export function isUnification(type: TypeVarType) {
        return type.priv.isUnificationVar;
    }

    function create(name: string, kind: TypeVarKind, typeFlags: TypeFlags): TypeVarType {
        const newTypeVarType: TypeVarType = {
            category: TypeCategory.TypeVar,
            flags: typeFlags,
            props: undefined,
            cached: undefined,
            shared: {
                kind,
                name,
                constraints: [],
                boundType: undefined,
                isDefaultExplicit: false,
                defaultType: UnknownType.create(),
                declaredVariance: Variance.Invariant,
                isSynthesized: false,
                isSynthesizedSelf: false,
                synthesizedIndex: undefined,
                isExemptFromBoundCheck: false,
                isTypeParamSyntax: false,
                recursiveAlias: undefined,
            },
            priv: {},
        };
        return newTypeVarType;
    }

    export function addConstraint(type: TypeVarType, constraintType: Type) {
        type.shared.constraints.push(constraintType);
    }

    export function getNameWithScope(typeVarType: TypeVarType) {
        // If there is no name with scope, fall back on the (unscoped) name.
        return typeVarType.priv.nameWithScope || typeVarType.shared.name;
    }

    export function getReadableName(type: TypeVarType, includeScope = true) {
        if (type.priv.scopeName && includeScope) {
            return `${type.shared.name}@${type.priv.scopeName}`;
        }

        return type.shared.name;
    }

    export function getVariance(type: TypeVarType) {
        const variance = type.priv.computedVariance ?? type.shared.declaredVariance;

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
        return !!type.shared.recursiveAlias && !type.shared.boundType;
    }

    export function isSelf(type: TypeVarType) {
        return !!type.shared.isSynthesizedSelf;
    }

    export function hasConstraints(type: TypeVarType) {
        return type.shared.constraints.length > 0;
    }

    export function hasBound(type: TypeVarType) {
        return !!type.shared.boundType;
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
        return type.priv.subtypes.find((subtype) => !isAnyOrUnknown(subtype)) === undefined;
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
        return type.priv.subtypes.find((subtype) => isPossiblyUnbound(subtype)) !== undefined;
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

export function isParamSpec(type: Type): type is ParamSpecType {
    return type.category === TypeCategory.TypeVar && type.shared.kind === TypeVarKind.ParamSpec;
}

export function isTypeVarTuple(type: Type): type is TypeVarTupleType {
    return type.category === TypeCategory.TypeVar && type.shared.kind === TypeVarKind.TypeVarTuple;
}

export function isUnpackedTypeVarTuple(type: Type): type is TypeVarTupleType {
    return isTypeVarTuple(type) && !!type.priv.isUnpacked && !type.priv.isInUnion;
}

export function isUnpackedTypeVar(type: Type): type is TypeVarTupleType {
    return isTypeVar(type) && !isTypeVarTuple(type) && !!type.priv.isUnpacked;
}

export function isUnpackedClass(type: Type): type is ClassType {
    if (!isClass(type) || !type.priv.isUnpacked) {
        return false;
    }

    return true;
}

export function isUnpacked(type: Type): boolean {
    return isUnpackedTypeVarTuple(type) || isUnpackedTypeVar(type) || isUnpackedClass(type);
}

export function isFunction(type: Type): type is FunctionType {
    return type.category === TypeCategory.Function;
}

export function isOverloaded(type: Type): type is OverloadedType {
    return type.category === TypeCategory.Overloaded;
}

export function isFunctionOrOverloaded(type: Type): type is FunctionType | OverloadedType {
    return type.category === TypeCategory.Function || type.category === TypeCategory.Overloaded;
}

export function getTypeAliasInfo(type: Type) {
    if (type.props?.typeAliasInfo) {
        return type.props.typeAliasInfo;
    }

    if (
        isTypeVar(type) &&
        type.shared.recursiveAlias &&
        type.shared.boundType &&
        type.shared.boundType.props?.typeAliasInfo
    ) {
        return type.shared.boundType.props.typeAliasInfo;
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
        if ((type1.flags & TypeFlags.TypeCompatibilityMask) !== (type2.flags & TypeFlags.TypeCompatibilityMask)) {
            return false;
        }
    }

    if (recursionCount > maxTypeRecursionCount) {
        return true;
    }
    recursionCount++;

    if (options.honorTypeForm) {
        const typeForm1 = type1.props?.typeForm;
        const typeForm2 = type2.props?.typeForm;

        if (typeForm1) {
            if (!typeForm2) {
                return false;
            }

            if (!isTypeSame(typeForm1, typeForm2, options, recursionCount)) {
                return false;
            }
        } else if (typeForm2) {
            return false;
        }
    }

    switch (type1.category) {
        case TypeCategory.Class: {
            const classType2 = type2 as ClassType;

            // If the details are not the same it's not the same class.
            if (!ClassType.isSameGenericClass(type1, classType2, recursionCount)) {
                return false;
            }

            if (!options.ignoreConditions && !TypeCondition.isSame(type1.props?.condition, type2.props?.condition)) {
                return false;
            }

            if (!options.ignorePseudoGeneric || !ClassType.isPseudoGenericClass(type1)) {
                // Make sure the type args match.
                if (type1.priv.tupleTypeArgs && classType2.priv.tupleTypeArgs) {
                    const type1TupleTypeArgs = type1.priv.tupleTypeArgs || [];
                    const type2TupleTypeArgs = classType2.priv.tupleTypeArgs || [];
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
                    const type1TypeArgs = type1.priv.typeArgs || [];
                    const type2TypeArgs = classType2.priv.typeArgs || [];
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

            if (!type1.priv.isUnpacked !== !classType2.priv.isUnpacked) {
                return false;
            }

            if (!type1.priv.isTypedDictPartial !== !classType2.priv.isTypedDictPartial) {
                return false;
            }

            if (options.honorIsTypeArgExplicit) {
                if (!!type1.priv.isTypeArgExplicit !== !!classType2.priv.isTypeArgExplicit) {
                    return false;
                }
            }

            if (!options.ignoreTypedDictNarrowEntries && !ClassType.isTypedDictNarrowedEntriesSame(type1, classType2)) {
                return false;
            }

            return true;
        }

        case TypeCategory.Function: {
            // Make sure the parameter counts match.
            const functionType2 = type2 as FunctionType;
            const params1 = type1.shared.parameters;
            const params2 = functionType2.shared.parameters;

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

                const param1Type = FunctionType.getParamType(type1, i);
                const param2Type = FunctionType.getParamType(functionType2, i);
                if (!isTypeSame(param1Type, param2Type, { ...options, ignoreTypeFlags: false }, recursionCount)) {
                    return false;
                }
            }

            // Make sure the return types match.
            let return1Type = type1.shared.declaredReturnType;
            if (type1.priv.specializedTypes && type1.priv.specializedTypes.returnType) {
                return1Type = type1.priv.specializedTypes.returnType;
            }
            if (!return1Type && type1.shared.inferredReturnType) {
                return1Type = type1.shared.inferredReturnType?.type;
            }

            let return2Type = functionType2.shared.declaredReturnType;
            if (functionType2.priv.specializedTypes && functionType2.priv.specializedTypes.returnType) {
                return2Type = functionType2.priv.specializedTypes.returnType;
            }
            if (!return2Type && functionType2.shared.inferredReturnType) {
                return2Type = functionType2.shared.inferredReturnType?.type;
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

        case TypeCategory.Overloaded: {
            // Make sure the overload counts match.
            const functionType2 = type2 as OverloadedType;
            if (type1.priv._overloads.length !== functionType2.priv._overloads.length) {
                return false;
            }

            // We assume here that overloaded functions always appear
            // in the same order from one analysis pass to another.
            for (let i = 0; i < type1.priv._overloads.length; i++) {
                if (!isTypeSame(type1.priv._overloads[i], functionType2.priv._overloads[i], options, recursionCount)) {
                    return false;
                }
            }

            return true;
        }

        case TypeCategory.Union: {
            const unionType2 = type2 as UnionType;
            const subtypes1 = type1.priv.subtypes;
            const subtypes2 = unionType2.priv.subtypes;

            if (subtypes1.length !== subtypes2.length) {
                return false;
            }

            // The types do not have a particular order, so we need to
            // do the comparison in an order-independent manner.
            const exclusionSet = new Set<number>();
            return (
                findSubtype(
                    type1,
                    (subtype) => !UnionType.containsType(unionType2, subtype, options, exclusionSet, recursionCount)
                ) === undefined
            );
        }

        case TypeCategory.TypeVar: {
            const type2TypeVar = type2 as TypeVarType;

            if (type1.priv.scopeId !== type2TypeVar.priv.scopeId) {
                return false;
            }

            if (type1.priv.nameWithScope !== type2TypeVar.priv.nameWithScope) {
                return false;
            }

            // Handle the case where this is a generic recursive type alias. Make
            // sure that the type argument types match.
            if (type1.shared.recursiveAlias && type2TypeVar.shared.recursiveAlias) {
                const type1TypeArgs = type1?.props?.typeAliasInfo?.typeArgs || [];
                const type2TypeArgs = type2?.props?.typeAliasInfo?.typeArgs || [];
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

            if (isTypeVarTuple(type1) && isTypeVarTuple(type2TypeVar)) {
                if (!type1.priv.isInUnion !== !type2TypeVar.priv.isInUnion) {
                    return false;
                }
            }

            if (type1.shared === type2TypeVar.shared) {
                return true;
            }

            if (isParamSpec(type1) !== isParamSpec(type2TypeVar)) {
                return false;
            }

            if (isTypeVarTuple(type1) !== isTypeVarTuple(type2TypeVar)) {
                return false;
            }

            if (
                type1.shared.name !== type2TypeVar.shared.name ||
                type1.shared.isSynthesized !== type2TypeVar.shared.isSynthesized ||
                type1.shared.declaredVariance !== type2TypeVar.shared.declaredVariance ||
                type1.priv.scopeId !== type2TypeVar.priv.scopeId
            ) {
                return false;
            }

            const boundType1 = type1.shared.boundType;
            const boundType2 = type2TypeVar.shared.boundType;
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

            const constraints1 = type1.shared.constraints;
            const constraints2 = type2TypeVar.shared.constraints;
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
            if (type1.priv.fields === type2Module.priv.fields) {
                return true;
            }

            // If both symbol tables are empty, we can also assume
            // they're equal.
            if (type1.priv.fields.size === 0 && type2Module.priv.fields.size === 0) {
                return true;
            }

            return false;
        }

        case TypeCategory.Unknown: {
            const type2Unknown = type2 as UnknownType;

            return type1.priv.isIncomplete === type2Unknown.priv.isIncomplete;
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
        const remainingTypes = type.priv.subtypes.filter((t) => !removeFilter(t));
        if (remainingTypes.length < type.priv.subtypes.length) {
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
        return type.priv.subtypes.find((subtype) => {
            return filter(subtype);
        });
    }

    return filter(type) ? type : undefined;
}

export interface CombineTypesOptions {
    // By default, literals are elided (removed) from a union if the non-literal
    // subtype is present. Should this be skipped?
    skipElideRedundantLiterals?: boolean;

    // If specified, the maximum number of subtypes that should be allowed
    // in the union before it is converted to an "Any" type.
    maxSubtypeCount?: number;
}

// Combines multiple types into a single type. If the types are
// the same, only one is returned. If they differ, they
// are combined into a UnionType. NeverTypes are filtered out.
// If no types remain in the end, a NeverType is returned.
export function combineTypes(subtypes: Type[], options?: CombineTypesOptions): Type {
    let neverTypes: NeverType[];

    // Filter out any Never or NoReturn types.
    [neverTypes, subtypes] = partition<Type, NeverType>(subtypes, isNever);

    if (subtypes.length === 0) {
        if (neverTypes.length > 0) {
            // Prefer NoReturn over Never. This approach preserves type alias
            // information if present.
            return neverTypes.find((t) => t.priv.isNoReturn) ?? neverTypes[0];
        }

        return NeverType.createNever();
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
            expandedTypes = expandedTypes.concat(subtype.priv.subtypes);

            if (subtype.props?.typeAliasInfo) {
                typeAliasSources.add(subtype);
            } else if (subtype.priv.typeAliasSources) {
                subtype.priv.typeAliasSources.forEach((subtype) => {
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
        if (isClass(type1) && type1.priv.literalValue !== undefined) {
            return 1;
        }

        if (isClass(type2) && type2.priv.literalValue !== undefined) {
            return -1;
        }

        if (isClassInstance(type1) && type1.priv.isEmptyContainer) {
            return 1;
        } else if (isClassInstance(type2) && type2.priv.isEmptyContainer) {
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
        newUnionType.priv.typeAliasSources = typeAliasSources;
    }

    let hitMaxSubtypeCount = false;

    expandedTypes.forEach((subtype, index) => {
        if (index === 0) {
            UnionType.addType(newUnionType, subtype as UnionableType);
        } else {
            if (options?.maxSubtypeCount === undefined || newUnionType.priv.subtypes.length < options.maxSubtypeCount) {
                _addTypeIfUnique(newUnionType, subtype as UnionableType, !options?.skipElideRedundantLiterals);
            } else {
                hitMaxSubtypeCount = true;
            }
        }
    });

    if (hitMaxSubtypeCount) {
        return AnyType.create();
    }

    // If only one type remains, convert it from a union to a simple type.
    if (newUnionType.priv.subtypes.length === 1) {
        return newUnionType.priv.subtypes[0];
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

    if (isInstantiableClass(srcType) && srcType.priv.literalValue !== undefined) {
        // Strip the literal.
        srcType = ClassType.cloneWithLiteral(srcType, /* value */ undefined);
        return isTypeSame(destType, srcType);
    }

    if (isClassInstance(srcType) && srcType.priv.literalValue !== undefined) {
        // Strip the literal.
        srcType = ClassType.cloneWithLiteral(srcType, /* value */ undefined);
        return isTypeSame(destType, srcType, { ignoreConditions: true });
    }

    return false;
}

function _addTypeIfUnique(unionType: UnionType, typeToAdd: UnionableType, elideRedundantLiterals: boolean) {
    // Handle the addition of a string literal in a special manner to
    // avoid n^2 behavior in unions that contain hundreds of string
    // literal types. Skip this for constrained types.
    if (isClass(typeToAdd) && !typeToAdd.props?.condition) {
        const literalMaps = isClassInstance(typeToAdd)
            ? unionType.priv.literalInstances
            : unionType.priv.literalClasses;

        if (
            ClassType.isBuiltIn(typeToAdd, 'str') &&
            typeToAdd.priv.literalValue !== undefined &&
            literalMaps.literalStrMap !== undefined
        ) {
            if (!literalMaps.literalStrMap.has(typeToAdd.priv.literalValue as string)) {
                UnionType.addType(unionType, typeToAdd);
            }
            return;
        } else if (
            ClassType.isBuiltIn(typeToAdd, 'int') &&
            typeToAdd.priv.literalValue !== undefined &&
            literalMaps.literalIntMap !== undefined
        ) {
            if (!literalMaps.literalIntMap.has(typeToAdd.priv.literalValue as number | bigint)) {
                UnionType.addType(unionType, typeToAdd);
            }
            return;
        } else if (
            ClassType.isEnumClass(typeToAdd) &&
            typeToAdd.priv.literalValue !== undefined &&
            literalMaps.literalEnumMap !== undefined
        ) {
            const enumLiteral = typeToAdd.priv.literalValue as EnumLiteral;
            if (!literalMaps.literalEnumMap.has(enumLiteral.getName())) {
                UnionType.addType(unionType, typeToAdd);
            }
            return;
        }
    }

    const isPseudoGeneric = isClass(typeToAdd) && ClassType.isPseudoGenericClass(typeToAdd);

    for (let i = 0; i < unionType.priv.subtypes.length; i++) {
        const type = unionType.priv.subtypes[i];

        // Does this type already exist in the types array?
        if (isTypeSame(type, typeToAdd, { honorTypeForm: true })) {
            return;
        }

        // Handle the case where pseudo-generic classes with different
        // type arguments are being combined. Rather than add multiple
        // specialized types, we will replace them with a single specialized
        // type that is specialized with Unknowns. This is important because
        // we can hit recursive cases (where a pseudo-generic class is
        // parameterized with its own class) ad infinitum.
        if (isPseudoGeneric) {
            if (isTypeSame(type, typeToAdd, { ignorePseudoGeneric: true, honorTypeForm: true })) {
                unionType.priv.subtypes[i] = ClassType.specialize(
                    typeToAdd,
                    typeToAdd.shared.typeParams.map(() => UnknownType.create())
                );
                return;
            }
        }

        if (isClassInstance(type) && isClassInstance(typeToAdd)) {
            // If the typeToAdd is a literal value and there's already
            // a non-literal type that matches, don't add the literal value.
            if (elideRedundantLiterals && isSameWithoutLiteralValue(type, typeToAdd)) {
                if (type.priv.literalValue === undefined) {
                    return;
                }
            }

            // If we're adding Literal[False] or Literal[True] to its
            // opposite, combine them into a non-literal 'bool' type.
            if (
                ClassType.isBuiltIn(type, 'bool') &&
                !type.props?.condition &&
                ClassType.isBuiltIn(typeToAdd, 'bool') &&
                !typeToAdd.props?.condition
            ) {
                if (
                    typeToAdd.priv.literalValue !== undefined &&
                    !typeToAdd.priv.literalValue === type.priv.literalValue
                ) {
                    unionType.priv.subtypes[i] = ClassType.cloneWithLiteral(type, /* value */ undefined);
                    return;
                }
            }

            // If the typeToAdd is a TypedDict that is the same class as the
            // existing type, see if one of them is a proper subset of the other.
            if (ClassType.isTypedDictClass(type) && ClassType.isSameGenericClass(type, typeToAdd)) {
                // Do not proceed if the TypedDicts are generic and have different type arguments.
                if (!type.priv.typeArgs && !typeToAdd.priv.typeArgs) {
                    if (ClassType.isTypedDictNarrower(typeToAdd, type)) {
                        return;
                    } else if (ClassType.isTypedDictNarrower(type, typeToAdd)) {
                        unionType.priv.subtypes[i] = typeToAdd;
                        return;
                    }
                }
            }
        }

        // If the typeToAdd is an empty container and there's already
        // non-empty container of the same type, don't add the empty container.
        if (isClassInstance(typeToAdd) && typeToAdd.priv.isEmptyContainer) {
            if (isClassInstance(type) && ClassType.isSameGenericClass(type, typeToAdd)) {
                return;
            }
        }
    }

    UnionType.addType(unionType, typeToAdd);
}
