/*
 * typeServerProtocol.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Defines the interfaces and types for the type server protocol. A Type Server is a module that provides type information
 * for code, such as type definitions, member information, and diagnostics.
 *
 * It's Python specific at the moment, but may be made generic in the future.
 *
 * This protocol is used to communicate between the type server and the client (e.g., a language server or an IDE).
 *
 * All the types in this file should be JSON serializable, as they are sent over the wire.
 * The protocol is designed to be extensible, allowing for future additions of new requests and notifications.
 *
 * Single source of truth:
 * - Within Pyright, this `.ts` file is authoritative. The sibling `tsp.json` and
 *   `tsp.schema.json` are GENERATED from it by `generate_json.py` (run that script
 *   after editing this file); do not hand-edit the JSON artifacts.
 * - Across repos, this file is a synchronized copy of the canonical shared Type Server
 *   Protocol also consumed by Pylance. Version negotiation
 *   (`TypeServerVersion.current`) guards against gross cross-version mismatches, but it
 *   does NOT detect silent field-level drift within a version. Any wire-level change
 *   must be mirrored in the other repo's copy and coordinated cross-repo so the two
 *   cannot diverge.
 */
import {
    MessageDirection,
    ProtocolNotificationType,
    ProtocolRequestType,
    ProtocolRequestType0,
    Range,
} from 'vscode-languageserver-protocol';

export namespace TypeServerProtocol {
    export const ReturnSymbolName = '__return__'; // Special name for the return value of a function or method.
    export const InvalidHandle = -1; // Special value for an invalid handle. This is used to indicate that a type or declaration is not valid.

    /**
     * Represents a location in source code (a node in the AST).
     * Used to point to specific declarations, expressions, or statements in Python source files.
     *
     * Used for:
     * - Pointing to where a type is declared
     * - Identifying the location of expressions for type inference
     * - Error reporting and diagnostics
     * - Linking types back to their source definitions
     *
     * Examples:
     * - For `def foo():`, the node points to the function declaration
     * - For a variable `x = 42`, the node points to the assignment
     * - For default parameter values in functions
     */
    export interface Node {
        // URI of the source file containing this node.
        uri: string;
        // The range of the node in the source file.
        // This is a zero-based range, meaning the start and end positions are both zero-based
        // The range uses character offsets the same way the LSP does.
        range: Range;
    }

    /**
     * Version of the type server protocol.
     * Used for protocol negotiation between client and server to ensure compatibility.
     *
     * The version follows semantic versioning (semver), with the usual 0.x caveat:
     * - Major version changes indicate breaking changes to the protocol
     * - While the protocol is 0.x, minor version changes may indicate breaking changes
     * - Patch version changes remain backward compatible
     *
     * Clients should check the server's supported version before making requests.
     */
    export enum TypeServerVersion {
        v0_1_0 = '0.1.0', // Initial protocol version
        v0_2_0 = '0.2.0', // Added new request types and fields
        v0_3_0 = '0.3.0', // Switch to more complex types
        v0_4_0 = '0.4.0', // Switch to Type union and using stubs
        current = '0.4.1', // Add multi-connection negotiation and control requests
    }

    /**
     * Built-in transport kinds supported by the multi-connection protocol.
     *
     * The main connection may use any transport the server supports, but extra
     * dynamically-opened connections are negotiated separately and are currently
     * limited to local IPC.
     */
    export enum ConnectionTransportKind {
        Ipc = 'ipc',
    }

    /**
     * Capability shape exchanged via the LSP initialize request/response under
     * `capabilities.experimental.typeServerMultiConnection`.
     */
    export interface TypeServerMultiConnectionCapability {
        supportedTransports: ConnectionTransportKind[];
    }

    /**
     * Main-connection-only control request used to open or close extra read-only
     * TSP channels after LSP initialization has completed.
     */
    export interface ConnectionRequestParams {
        type: 'open' | 'close';
        kind: ConnectionTransportKind;
        args?: string[];
    }

    export interface ConnectionRequestResult {
        success: boolean;
        message?: string;
    }

    // Flags that describe the characteristics of a type.
    // These flags can be combined using bitwise operations.
    export const enum TypeFlags {
        None = 0,
        Instantiable = 1 << 0, // Indicates if the type can be instantiated.
        Instance = 1 << 1, // Indicates if the type represents an instance (as opposed to a class or type itself).
        Callable = 1 << 2, // Indicates if an instance of the type can be called like a function. (It has a `__call__` method).
        Literal = 1 << 3, // Indicates if the instance is a literal (like `42`, `"hello"`, etc.).
        Interface = 1 << 4, // Indicates if the type is an interface (a type that defines a set of methods and properties). In Python this would be a Protocol.
        Generic = 1 << 5, // Indicates if the type is a generic type (a type that can be parameterized with other types).
        FromAlias = 1 << 6, // Indicates if the type came from an alias (a type that refers to another type).
        Unpacked = 1 << 7, // Indicates if the type is unpacked (used with TypeVarTuple).
        Optional = 1 << 8, // Indicates if the type is optional (used with Tuple type arguments).
        Unbound = 1 << 9, // Indicates if the type is unbound (used with *args in tuple type arguments).
    }

    /**
     * Represents a Python module name, handling both absolute and relative imports.
     *
     * Used for:
     * - Import statement resolution
     * - Tracking module dependencies
     * - Resolving relative imports (from . import, from .. import)
     *
     * Examples:
     * - `import os.path`: leadingDots=0, nameParts=['os', 'path']
     * - `from . import utils`: leadingDots=1, nameParts=['utils']
     * - `from ...parent import module`: leadingDots=3, nameParts=['parent', 'module']
     * - `import mymodule`: leadingDots=0, nameParts=['mymodule']
     */
    export interface ModuleName {
        // The leading dots in the module name. This is used to determine the relative import level.
        leadingDots: number;
        // The parts of the module name, split by dots. For example, for `my_module.sub_module`, this would be `['my_module', 'sub_module']`.
        nameParts: string[];
    }
    // Represents the category of a declaration in the type system.
    // This is used to classify declarations such as variables, functions, classes, etc.
    export const enum DeclarationCategory {
        Intrinsic, // An intrinsic refers to a symbol that has no actual declaration in the source code, such as built-in types or functions. One such example is a '__class__' declaration.
        Variable, // A variable is a named storage location that can hold a value.
        Param, // A parameter is a variable that is passed to a function or method.
        TypeParam, // This is for PEP 695 type parameters.
        TypeAlias, // This is for PEP 695 type aliases.
        Function, // A function is any construct that begins with the `def` keyword and has a body, which can be called with arguments.
        Class, // A class is any construct that begins with the `class` keyword and has a body, which can be instantiated.
        Import, // An import declaration, which is a reference to another module.
    }

    /**
     * Options for customizing import resolution behavior.
     * Controls how the type server resolves import statements and accesses imported symbols.
     *
     * Used for:
     * - Fine-tuning import resolution during type checking
     * - Controlling access to private/hidden module members
     * - Optimizing resolution by skipping file checks
     *
     * TODO: See if we can remove this as these are pretty specific to Pyright at the moment.
     *
     * Examples:
     * ```python
     * # resolveLocalNames affects whether local assignments are resolved:
     * from module import name
     * name = something_else  # Does 'name' refer to import or local assignment?
     *
     * # allowExternallyHiddenAccess affects access to _private names:
     * from module import _internal_function  # Normally hidden from external access
     * ```
     */
    export interface ResolveImportOptions {
        // Whether to resolve local names in the import declaration.
        // When true, considers local variable assignments that shadow imports.
        resolveLocalNames?: boolean;

        // Whether to allow access to members that are hidden by external modules.
        // When true, permits access to symbols marked as private (e.g., _private or not in __all__).
        allowExternallyHiddenAccess?: boolean;

        // Whether to skip checking if the file is needed for the import resolution.
        // When true, optimizes by not verifying file existence/validity.
        skipFileNeededCheck?: boolean;
    }

    /**
     * Parameters for the ResolveImportRequest.
     * Provides the context needed to resolve a Python import statement to its file location.
     *
     * Used when:
     * - Resolving `import` or `from...import` statements
     * - Finding the file that contains an imported module
     * - Navigating to imported symbols
     *
     * Examples:
     * ```python
     * # In file.py:
     * from os.path import join  # sourceUri = file.py, moduleDescriptor = os.path
     * import mymodule          # sourceUri = file.py, moduleDescriptor = mymodule
     * from . import utils      # sourceUri = file.py, moduleDescriptor = .utils (relative)
     * ```
     */
    export interface ResolveImportParams {
        // The URI of the source file where the import is referenced.
        // Used to resolve relative imports and determine the import context.
        sourceUri: string;

        // The descriptor of the imported module.
        // Contains the module name parts and leading dots for relative imports.
        moduleDescriptor: ModuleName;

        // Snapshot version of the type server.
        // Type server should throw a ServerCanceled exception if this snapshot is no longer current.
        snapshot: number;
    }

    /**
     * Parameters for the GetPythonSearchPathsRequest.
     * Requests the list of directories that Python searches for modules and packages.
     *
     * The search paths include:
     * - Standard library directories
     * - Site-packages directories (third-party packages)
     * - Virtual environment paths (if active)
     * - Project-specific paths (PYTHONPATH, src directories)
     *
     * Used for:
     * - Resolving import statements to find module files
     * - Auto-import suggestions
     * - Determining which packages are available
     *
     * Example search paths:
     * ```
     * [
     *   "/usr/lib/python3.11",              # Standard library
     *   "/venv/lib/python3.11/site-packages",  # Virtual env packages
     *   "/project/src"                       # Project source
     * ]
     * ```
     */
    export interface GetPythonSearchPathsParams {
        // Root folder to get search paths from.
        // Determines the Python environment and project context for path resolution.
        fromUri: string;

        // Snapshot version of the type server.
        // Type server should throw a ServerCanceled exception if this snapshot is no longer current.
        snapshot: number;
    }

    /**
     * Represents specialized (concrete) types for a generic function's parameters and return type.
     * Used when generic type parameters are substituted with actual types.
     *
     * Fields:
     * - parameterTypes: Concrete types for each parameter after type variable substitution
     * - parameterDefaultTypes: Specialized types for default values (if different from declared)
     * - returnType: Specialized return type after type variable substitution
     *
     * Examples:
     * ```python
     * # Generic function
     * def identity[T](x: T) -> T:
     *     return x
     *
     * # When called as identity[int](42):
     * # - parameterTypes = [int] (T substituted with int)
     * # - returnType = int (T substituted with int)
     *
     * # For list.append bound to list[str]:
     * # - parameterTypes = [str] (specialized from generic T)
     * ```
     */
    export interface SpecializedFunctionTypes {
        // Specialized types for each of the parameters in the "parameters" array.
        // Array matches the parameters array, with type variables replaced by concrete types.
        // Example: For `def foo[T](x: T)` specialized to `T=int`, parameterTypes=[int].
        parameterTypes: Type[];

        // Specialized types of default arguments for each parameter in
        // the "parameters" array. If an entry is undefined or the entire array
        // is missing, there is no specialized type, and the original "defaultType"
        // should be used.
        // Example: For a generic default value that depends on T, this contains the specialized version.
        parameterDefaultTypes: (Type | undefined)[] | undefined;

        // Specialized type of the declared return type. Undefined if there is
        // no declared return type.
        // Example: For `def foo[T](x: T) -> T` specialized to `T=int`, returnType=int.
        returnType: Type | undefined;
    }

    /**
     * Represents a literal value from an Enum.
     * Used to track specific enum members as literal types.
     *
     * Fields:
     * - className: Name of the enum class
     * - itemName: Name of the specific enum member
     * - itemType: Type of the enum member's value
     *
     * Examples:
     * ```python
     * from enum import Enum
     *
     * class Color(Enum):
     *     RED = 1
     *     GREEN = 2
     *     BLUE = 3
     *
     * # Color.RED is an EnumLiteral:
     * # className="Color", itemName="RED", itemType=int (for value 1)
     *
     * def process(color: Literal[Color.RED]) -> None:
     *     pass  # EnumLiteral tracks that it's specifically Color.RED
     * ```
     */
    export interface EnumLiteral {
        // Name of the enum class.
        // Example: "Color" for the Color enum.
        className: string;

        // Name of the specific enum member.
        // Example: "RED" for Color.RED.
        itemName: string;

        // Type of the enum member's value.
        // Example: int type if the enum values are integers.
        itemType: Type;
    }

    /**
     * Represents a sentinel value (a unique object used as a marker).
     * Used for special singleton values that act as sentinels in APIs.
     *
     * Fields:
     * - classNode: AST node where the sentinel class is defined
     * - moduleName: Module containing the sentinel
     * - className: Name of the sentinel class
     *
     * Examples:
     * ```python
     * # Common sentinel pattern
     * class _Sentinel:
     *     pass
     * MISSING = _Sentinel()
     *
     * def get_value(key: str, default: int | _Sentinel = MISSING) -> int:
     *     ...
     *
     * # MISSING is a SentinelLiteral pointing to the _Sentinel class instance
     *
     * # Used in standard library (e.g., dataclasses.MISSING)
     * from dataclasses import field, MISSING
     * # MISSING is tracked as a SentinelLiteral
     * ```
     */
    export interface SentinelLiteral {
        // AST node pointing to the sentinel class definition.
        // Used to locate the class in source code.
        classNode: Node;

        // Fully qualified module name where the sentinel is defined.
        // Example: "dataclasses" for dataclasses.MISSING.
        moduleName: string;

        // Name of the sentinel class.
        // Example: "_MISSING_TYPE" for the class of dataclasses.MISSING.
        className: string;
    }

    /**
     * Represents the value of a literal type in Python.
     * A literal type has a specific, known value at type-checking time.
     *
     * Literal types include:
     * - Primitive literals: numbers, booleans, strings
     * - Enum members: specific values from an Enum class
     * - Sentinel values: unique marker objects (e.g., dataclasses.MISSING)
     *
     * Used for:
     * - Type narrowing with specific values
     * - Overload resolution based on literal arguments
     * - TypedDict key validation
     * - Literal types in function signatures
     *
     * Examples:
     * ```python
     * # Primitive literals
     * x: Literal[42] = 42                    # number literal
     * y: Literal["hello"] = "hello"          # string literal
     * z: Literal[True] = True                # boolean literal
     * big: Literal[999999999999999] = 999999999999999  # bigint literal
     *
     * # Enum literal
     * class Color(Enum):
     *     RED = 1
     * color: Literal[Color.RED] = Color.RED  # EnumLiteral
     *
     * # Sentinel literal
     * from dataclasses import MISSING
     * def field(default=MISSING): ...        # SentinelLiteral
     * ```
     */
    export type LiteralValue = number | bigint | boolean | string | EnumLiteral | SentinelLiteral;

    /**
     * Discriminator for the Union type.
     * Identifies which variant of Type is being used.
     *
     * Used for type narrowing when processing Type objects:
     * ```typescript
     * if (handle.kind === TypeKind.Function) {
     *     // TypeScript knows this is FunctionType
     *     const returnType = handle.returnType;
     * }
     * ```
     *
     * Categories:
     * - BuiltIn: Special types (unknown, any, never, etc.)
     * - Declared: Base type for source declarations (rarely used directly)
     * - Function: Function or method types from def statements
     * - Class: Class types from class statements
     * - Union: Multiple types combined (T1 | T2 | ...)
     * - Module: Python module types
     * - TypeVar: Generic type parameters (T, P, Ts)
     * - Overloaded: Functions with @overload decorators
     * - Synthesized: Generated stub content for type server created types
     * - TypeReference: Reference to another type by ID
     */
    export const enum TypeKind {
        BuiltIn, // unknown, any, never, etc.
        Declared, // Base for source-declared types (rarely used directly)
        Function, // Functions and methods from def statements
        Class, // Classes from class statements
        Union, // int | str | None
        Module, // import os -> os is ModuleType
        TypeVar, // T, P, Ts in generics
        Overloaded, // Functions with multiple @overload signatures
        Synthesized, // Types that are synthesized by the type checker
        TypeReference, // Reference by ID for deduplication
    }

    /**
     * Discriminator for the Declaration union type.
     * Distinguishes between declarations that exist in source code versus those created by the type checker.
     *
     * Used to determine whether a declaration:
     * - Has an actual AST node in the parse tree (Regular)
     * - Was created implicitly by the type system (Synthesized)
     *
     * Examples:
     * - Regular: `def my_function():` - has source code node
     * - Synthesized: `__init__` method generated by @dataclass - no source node
     * - Regular: `class MyClass:` - has source code node
     * - Synthesized: Built-in `len` function - no user source code
     */
    export const enum DeclarationKind {
        Regular, // Declaration exists in source code with AST node
        Synthesized, // Declaration created by type checker (no source node)
    }

    /**
     * Base interface for all declaration types.
     * Provides the discriminator field for the Declaration union.
     *
     * This is a generic interface that is extended by:
     * - RegularDeclaration (kind = Regular)
     * - SynthesizedDeclaration (kind = Synthesized)
     *
     * The type parameter T ensures that the kind field matches the implementing interface.
     *
     * Used for type-safe discrimination:
     * ```typescript
     * if (declaration.kind === DeclarationKind.Regular) {
     *     // TypeScript knows this is RegularDeclaration
     *     const node = declaration.node;
     * }
     * ```
     */
    export interface DeclarationBase<T extends DeclarationKind> {
        // Discriminator field that determines which declaration variant this is.
        // Regular: Has source code and AST node
        // Synthesized: Created by type checker, no source node
        kind: T;
    }

    /**
     * Represents a declaration that exists in source code.
     * Points to the actual AST node where a symbol is declared.
     *
     * Fields:
     * - category: Type of declaration (Variable, Function, Class, etc.)
     * - node: AST node pointing to the declaration location
     * - name: Name of the declared symbol (undefined for anonymous/implicit declarations)
     *
     * Examples:
     * ```python
     * def my_function(x: int) -> str:  # Function declaration
     *     return str(x)
     *
     * class MyClass:  # Class declaration
     *     x: int      # Variable declaration
     *
     * T = TypeVar('T')  # TypeParam declaration
     * ```
     */
    export interface RegularDeclaration extends DeclarationBase<DeclarationKind.Regular> {
        // Category of the declaration (Variable, Function, Class, etc.).
        // Determines how the declaration should be interpreted.
        // Example: DeclarationCategory.Function for `def foo():`.
        category: DeclarationCategory;

        // AST node pointing to the declaration location in source code.
        // Contains file URI and range information.
        // Example: Points to the `def` keyword and function name for function declarations.
        node: Node;

        // Name of the declared symbol, or undefined for anonymous declarations.
        // Example: "foo" for `def foo():`, undefined for lambda functions.
        name: string | undefined;
    }

    /**
     * Represents a synthesized declaration (not in source code).
     * Used for implicitly created symbols like built-in types or decorator-generated members.
     *
     * Fields:
     * - uri: The file URI where this is conceptually declared (often the module using it)
     *
     * Examples:
     * ```python
     * # Built-in functions have synthesized declarations
     * len([1, 2, 3])  # len is synthesized, not from source
     *
     * # @dataclass generates __init__, __eq__, etc. - synthesized declarations
     * @dataclass
     * class Point:
     *     x: int
     *     y: int
     * # Point.__init__ is synthesized
     * ```
     */
    export interface SynthesizedDeclaration extends DeclarationBase<DeclarationKind.Synthesized> {
        // URI of the file where this symbol is conceptually declared.
        // For built-ins, this might be a special URI; for decorator-generated code,
        // it's the file containing the decorator.
        // Example: File URI of a @dataclass-decorated class for synthesized __init__.
        uri: string;
    }

    /**
     * Union type representing any kind of declaration.
     * A declaration describes where and how a symbol (variable, function, class, etc.) is defined.
     *
     * Contains either:
     * - RegularDeclaration: For declarations in source code with AST nodes
     * - SynthesizedDeclaration: For declarations created by the type checker
     *
     * Used for:
     * - Tracking where symbols are defined
     * - Navigating to declaration locations (Go to Definition)
     * - Distinguishing user code from generated/built-in code
     * - Providing context for type information
     *
     * Examples:
     * ```python
     * # Regular declaration
     * def my_function(x: int) -> str:  # RegularDeclaration
     *     return str(x)
     *
     * # Synthesized declaration
     * @dataclass
     * class Point:
     *     x: int
     *     y: int
     * # Point.__init__ has SynthesizedDeclaration (generated by @dataclass)
     *
     * # Built-in function
     * len([1, 2, 3])  # len has SynthesizedDeclaration
     * ```
     */
    export type Declaration = RegularDeclaration | SynthesizedDeclaration;

    /**
     * Describes the variance of a type parameter in a generic type.
     * Variance controls how subtyping relationships work with generic types.
     *
     * Variance rules:
     * - Covariant: If A is a subtype of B, then Generic[A] is a subtype of Generic[B]
     *   - Used when the type parameter appears only in output positions (return types)
     *   - Example: Tuple[T] is covariant in T
     *
     * - Contravariant: If A is a subtype of B, then Generic[B] is a subtype of Generic[A]
     *   - Used when the type parameter appears only in input positions (parameters)
     *   - Example: Callable[[T], None] is contravariant in T
     *
     * - Invariant: No subtyping relationship exists regardless of T
     *   - Used when the type parameter appears in both input and output positions
     *   - Example: List[T] is invariant in T
     *
     * Examples:
     * ```python
     * from typing import TypeVar, Generic
     *
     * T_co = TypeVar('T_co', covariant=True)      # Covariant
     * T_contra = TypeVar('T_contra', contravariant=True)  # Contravariant
     * T = TypeVar('T')  # Invariant by default
     *
     * class Container(Generic[T_co]):  # Covariant
     *     def get(self) -> T_co: ...   # T_co in output position only
     *
     * class Consumer(Generic[T_contra]):  # Contravariant
     *     def accept(self, value: T_contra) -> None: ...  # T_contra in input only
     * ```
     */
    export const enum Variance {
        Auto, // Variance not yet determined, will be inferred
        Unknown, // Variance cannot be determined
        Invariant, // No subtyping relationship (default for mutable types)
        Covariant, // Preserves subtyping: Generic[Child] <: Generic[Parent]
        Contravariant, // Reverses subtyping: Generic[Parent] <: Generic[Child]
    }

    /**
     * Contains metadata about a type alias.
     * Used when a type is created through a type alias statement (PEP 613) or traditional assignment.
     *
     * Fields:
     * - name: Short name of the alias
     * - fullName: Fully qualified name including module path
     * - moduleName: Module where the alias is defined
     * - fileUri: File location of the alias definition
     * - scopeId: Scope identifier for the alias (for scoped type variables)
     * - isTypeAliasType: True if this uses the `type` keyword (PEP 695)
     * - typeParams: Generic type parameters declared by the alias
     * - typeArgs: Concrete type arguments when the alias is specialized
     * - computedVariance: Inferred variance for type parameters
     *
     * Examples:
     * ```python
     * # PEP 695 style (isTypeAliasType=true)
     * type IntList = list[int]
     *
     * # Traditional style (isTypeAliasType=false)
     * IntList = list[int]
     *
     * # Generic alias with type parameters
     * type Pair[T] = tuple[T, T]
     * # typeParams=[T], can be specialized to Pair[int]
     *
     * # Using typing.TypeAlias
     * from typing import TypeAlias
     * UserId: TypeAlias = int
     * ```
     */
    export interface TypeAliasInfo {
        // Short name of the type alias.
        // Example: "IntList" for `type IntList = list[int]`.
        readonly name: string;

        // Fully qualified name including module path.
        // Example: "mymodule.IntList".
        readonly fullName: string;

        // Module where the type alias is defined.
        // Example: "mymodule" for a type defined in mymodule.py.
        readonly moduleName: string;

        // URI of the file containing the type alias definition.
        // Example: "file:///path/to/mymodule.py".
        readonly fileUri: string;

        // Scope identifier for type variables used in this alias.
        // Ensures type variables are scoped to this alias definition.
        // Example: Different aliases can use the same type variable name 'T' without conflict.
        readonly scopeId: string;

        // True if this alias uses the `type` keyword (PEP 695), false for traditional assignment.
        // Example: true for `type X = int`, false for `X = int`.
        readonly isTypeAliasType: boolean;

        // Generic type parameters declared by this alias.
        // Example: [T] for `type Pair[T] = tuple[T, T]`.
        readonly typeParams?: Type[];

        // Concrete type arguments when this alias is specialized.
        // Example: [int] when `Pair[int]` is used (specializing Pair[T]).
        readonly typeArgs?: Type[];

        // Computed variance for each type parameter.
        // Inferred based on how type parameters are used in the alias definition.
        // Example: [Covariant] if the type parameter only appears in return positions.
        readonly computedVariance?: Variance[];
    }

    /**
     * Base interface for all Type variants.
     * Provides common fields shared by all type representations in the protocol.
     *
     * This is the foundation interface extended by all Type types:
     * - BuiltInType
     * - RegularType (and its subclasses FunctionType, ClassType)
     * - UnionType
     * - ModuleType
     * - TypeVarType
     * - OverloadedType
     * - SynthesizedType
     * - TypeReference
     *
     * The type parameter T constrains the `kind` field to match the implementing type.
     *
     * Common fields:
     * - id: Unique identifier for cycle detection and caching
     * - kind: Discriminator for the Type union
     * - flags: Characteristics of the type (Instantiable, Instance, Callable, etc.)
     * - typeAliasInfo: Optional alias information if type comes from a type alias
     *
     * Used throughout the protocol to represent Python types in a serializable format.
     */
    export interface TypeBase<T extends TypeKind> {
        // Unique identifier for this type instance. Used to detect cycles and cache type lookups.
        // Example: During recursive type resolution, the id is checked to avoid infinite loops.
        readonly id: number;

        // Discriminator field that determines which Type variant this is.
        // Used for type narrowing when processing Type unions.
        // Example: `if (type.kind === TypeKind.BuiltIn) { ... }`
        readonly kind: T;

        // Bitfield of TypeFlags that describe characteristics of the type.
        // Common flags: Instantiable (can create instances), Instance (is an instance),
        // Callable (has __call__), Literal (is a literal value), Generic (has type parameters).
        // Example: Check if type is callable: `(flags & TypeFlags.Callable) !== 0`
        readonly flags: TypeFlags;

        // Information about type aliases. Present when this type was created from a type alias.
        // Contains the alias name, module, file location, type parameters, and type arguments.
        // Example: `type MyList = list[int]` - typeAliasInfo contains name="MyList", typeArgs=[int]
        readonly typeAliasInfo?: TypeAliasInfo;
    }

    /**
     * Represents special built-in types that are fundamental to Python's type system.
     * These are not regular classes but represent special semantic meanings.
     *
     * Used for:
     * - Type inference failures (unknown)
     * - Gradual typing (any)
     * - Uninitialized variables (unbound)
     * - Special literals (ellipsis for ...)
     * - Non-returning functions (never/noreturn)
     *
     * Examples:
     * - `unknown`: `x` in `def foo(x):` with no type hints and no usage to infer from
     * - `any`: Explicit `Any` annotation or from untyped imports
     * - `unbound`: Variable declared but not yet assigned: `x: int` (before assignment)
     * - `ellipsis`: The `...` in `def foo(...): ...` or `Tuple[int, ...]`
     * - `never`: `def raise_error() -> Never:` or function with only raise statements
     */
    export interface BuiltInType extends TypeBase<TypeKind.BuiltIn> {
        // Optional declaration information for built-in types (usually undefined for true built-ins).
        // Example: Some built-ins like __class__ have synthesized declarations.
        readonly declaration?: Declaration;

        // The name of the built-in type. Limited to specific known built-in types.
        // 'unknown': Type cannot be determined
        // 'any': Accepts any value (gradual typing)
        // 'unbound': Variable not yet bound to a value
        // 'ellipsis': The ... literal
        // 'never': Type that never occurs (e.g., function that always raises)
        // 'noreturn': Function that doesn't return (alias for never)
        readonly name: 'unknown' | 'any' | 'unbound' | 'ellipsis' | 'never' | 'noreturn';

        // For 'unknown' types, this may contain a possible type based on context.
        // Used when type inference has partial information but can't fully determine the type.
        // Example: In `if isinstance(x, int): ...` the possibleType of unknown x might be int
        readonly possibleType?: Type;
    }

    /**
     * Base type for symbols that have a declaration in source code.
     * This is the common parent for FunctionType and ClassType when the type
     * comes from an actual declaration node in the parse tree.
     *
     * The type parameter T allows subtypes to specify their own TypeKind
     * (e.g., Function or Class) while sharing the common declaration field.
     *
     * Used for:
     * - Functions and methods with actual `def` statements (TypeKind.Function)
     * - Classes with actual `class` statements (TypeKind.Class)
     * - Variables with declarations in source (TypeKind.Declared)
     *
     * Not used for:
     * - Synthesized types (use SynthesizedType)
     * - Built-in types (use BuiltInType)
     *
     * Example:
     * ```python
     * def my_function(x: int) -> str:  # FunctionType with TypeKind.Function
     *     return str(x)
     * class MyClass:  # ClassType with TypeKind.Class
     *     pass
     * ```
     */
    export interface DeclaredType<T extends TypeKind = TypeKind.Declared> extends TypeBase<T> {
        // Declaration node information (source location, category, name).
        // Points to where this type was declared in the source code.
        // Example: For a function, this contains the node pointing to the 'def' keyword and function name.
        readonly declaration: Declaration;
    }

    /**
     * Represents a function or method that has a declaration in the source code.
     * Used for functions parsed from actual `def` statements.
     *
     * Uses TypeKind.Function for discrimination from ClassType and other types.
     *
     * Binding behavior:
     * - boundToType: Contains the class/instance the method is bound to.
     *
     * Used for:
     * - User-defined functions with `def` statements
     * - Methods declared in source classes
     * - Lambda functions (though simple ones)
     *
     * Not used for:
     * - Built-in functions like `len`, `print` (use SynthesizedType)
     * - Synthesized methods from decorators like @dataclass (use SynthesizedType)
     *
     * Example:
     * ```python
     * def calculate(x: int, y: int) -> int:
     *     return x + y
     *
     * class MyClass:
     *     def method(self, value: str) -> None:
     *         pass
     * ```
     */
    export interface FunctionType extends DeclaredType<TypeKind.Function> {
        // The return type annotation of the function.
        // Example: In `def foo() -> int:`, returnType is the int type.
        readonly returnType?: Type;

        // Specialized versions of parameter types and return type when the function has type parameters.
        // Contains concrete types substituted for generic type variables.
        // Example: When calling `list[int].append(1)`, the self parameter is specialized to list[int].
        readonly specializedTypes?: SpecializedFunctionTypes;

        // The class or object instance that this method is bound to.
        // Example: In `obj.method`, boundToType is the type of `obj`.
        readonly boundToType?: Type;
    }

    /**
     * Represents a class or class instance that has a declaration in the source code.
     * Used for classes parsed from actual `class` statements.
     *
     * Uses TypeKind.Class for discrimination from FunctionType and other types.
     *
     * Used for:
     * - User-defined classes with `class` statements
     * - Class instances (instances of user-defined classes)
     * - Specialized generic classes (e.g., `MyClass[int]`)
     * - Literal instances (e.g., the number `42` is an instance of `int`)
     *
     * Not used for:
     * - Built-in classes like `int`, `str`, `list` (use SynthesizedType)
     * - Classes synthesized by decorators (use SynthesizedType)
     *
     * Example:
     * ```python
     * class Point:
     *     x: int
     *     y: int
     *
     * class Container[T]:
     *     value: T
     *
     * # point has ClassType (instance of Point)
     * point = Point()
     * # container has ClassType with typeArgs=[int]
     * container: Container[int] = Container()
     * ```
     */
    export interface ClassType extends DeclaredType<TypeKind.Class> {
        // The literal value if this class represents a literal (e.g., int literal 42, str literal "hello").
        // Can be a primitive value, enum member, or sentinel object.
        // Example: For the literal `42`, literalValue = 42.
        readonly literalValue?: LiteralValue;

        // Type arguments when this class is a specialized generic type.
        // Example: For `list[int]`, typeArgs = [int].
        readonly typeArgs?: Type[];
    }

    /**
     * Represents a union of multiple types (Type1 | Type2 | ...).
     * Used when a value can be one of several different types.
     *
     * Used for:
     * - Explicit union type annotations using `|` or `Union[...]`
     * - Optional types (which are unions with None)
     * - Type narrowing results (e.g., after isinstance checks)
     * - Inferred types from multiple branches
     *
     * Examples:
     * ```python
     * # Explicit union annotation
     * def process(value: int | str) -> None:
     *     pass
     *
     * # Optional (union with None)
     * def find(key: str) -> str | None:
     *     return None
     *
     * # Inferred union from branches
     * if condition:
     *     x = 42        # int
     * else:
     *     x = "hello"  # str
     * # x has type int | str
     * ```
     */
    export interface UnionType extends TypeBase<TypeKind.Union> {
        // Array of types that make up this union.
        // Example: For `int | str | None`, subTypes = [int, str, None].
        readonly subTypes: Type[];
    }

    /**
     * Represents a Python module as a type.
     * Used when a module object itself is referenced (not its contents).
     *
     * Used for:
     * - Module imports: `import os` makes `os` a ModuleType
     * - Module attributes accessed via __file__, __name__, etc.
     * - Submodule references: `os.path` is also a ModuleType
     *
     * The loaderFields contain all the symbols exported by the module that would
     * be accessible via attribute access (module.symbol_name).
     *
     * Examples:
     * ```python
     * import os
     * import os.path as path
     * from typing import Protocol
     *
     * # `os` has ModuleType with loaderFields containing {"path": ..., "getcwd": ..., etc.}
     * # `path` has ModuleType for the os.path module
     * # In type stubs, Protocol is a module symbol that gets loaded
     * ```
     */
    export interface ModuleType extends TypeBase<TypeKind.Module> {
        // Fully qualified name of the module.
        // Example: "os.path" for the os.path module.
        readonly moduleName: string;

        // URI of the module's source file.
        // Example: "file:///path/to/module.py" or "<builtin>" for built-in modules.
        readonly uri: string;
    }

    /**
     * Represents a type variable (generic type parameter).
     * Used for generic programming where types are parameterized.
     *
     * Used for:
     * - Explicit TypeVar declarations: `T = TypeVar('T')`
     * - PEP 695 type parameters: `def func[T](x: T) -> T`
     * - ParamSpec for callable signatures: `P = ParamSpec('P')`
     * - TypeVarTuple for variadic generics: `Ts = TypeVarTuple('Ts')`
     * - Constrained type variables: `T = TypeVar('T', int, str)`
     * - Bounded type variables: `T = TypeVar('T', bound=Number)`
     *
     * Examples:
     * ```python
     * # Classic TypeVar
     * T = TypeVar('T')
     * def identity[T](x: T) -> T:
     *     return x
     *
     * # Bounded TypeVar
     * T_num = TypeVar('T_num', bound=int)
     * def double[T_num](x: T_num) -> T_num:
     *     return x * 2
     *
     * # Constrained TypeVar
     * T_str_or_bytes = TypeVar('T_str_or_bytes', str, bytes)
     *
     * # ParamSpec
     * P = ParamSpec('P')
     * def decorator(func: Callable[P, R]) -> Callable[P, R]:
     *     ...
     * ```
     */
    export type TypeVarType = DeclaredType<TypeKind.TypeVar>;

    /**
     * Represents an overloaded function with multiple signatures.
     * Used when a function has multiple `@overload` decorators defining different call signatures.
     *
     * Used for:
     * - Functions with @overload decorators
     * - Built-in functions with multiple signatures (e.g., `range(stop)` vs `range(start, stop, step)`)
     * - Methods with different signatures for different argument types
     *
     * The `overloads` array contains all the @overload signatures, and `implementation`
     * contains the actual implementation (if present).
     *
     * Examples:
     * ```python
     * from typing import overload
     *
     * @overload
     * def process(value: int) -> str: ...
     * @overload
     * def process(value: str) -> int: ...
     * def process(value: int | str) -> int | str:
     *     if isinstance(value, int):
     *         return str(value)
     *     return len(value)
     *
     * # The type of `process` is OverloadedType with:
     * # - overloads = [signature for (int)->str, signature for (str)->int]
     * # - implementation = signature for (int|str)->(int|str)
     * ```
     */
    export interface OverloadedType extends TypeBase<TypeKind.Overloaded> {
        // List of overload signatures for this overloaded function.
        // Each overload represents a different way the function can be called.
        // Example: For a function with @overload decorators, each overload is in this array.
        overloads: Type[];

        // The implementation signature (if present).
        // This is the actual function body, as opposed to the @overload declarations.
        // Example: The non-decorated function definition after all @overload decorators.
        implementation?: Type;
    }

    /**
     * Metadata about a synthesized type that provides additional context.
     * This information is used by the client to enhance IntelliSense and type checking.
     */
    export interface SynthesizedTypeMetadata {
        /**
         * Module where the synthesized type is defined.
         * Used to provide context about the origin of the synthesized type.
         *
         * Examples:
         * - For a synthesized `__init__` method from a @dataclass, this is the module containing the dataclass.
         * - For a NewType declaration, this is the module where the NewType is defined.
         */
        module: ModuleType;

        /**
         * Character offset into the stubContent where the primary/target definition starts.
         * When the stub contains multiple definitions (e.g., base classes and the main class,
         * or a class with multiple methods), this points to the specific definition that
         * represents the synthesized type.
         *
         * The offset is a zero-based character index from the start of stubContent.
         *
         * Examples:
         * - For a function stub, points to the 'def' keyword
         * - For a class stub, points to the 'class' keyword of the target class
         * - For a method in a class, points to the 'def' keyword of that method
         * - For a NewType assignment, points to the start of the assignment
         *
         * Example:
         * ```python
         * # stubContent:
         * from typing import NewType
         * UserId = NewType('UserId', int)
         * # ^offset points here (start of 'UserId')
         * ```
         */
        primaryDefinitionOffset: number;
    }

    /**
     * Represents synthesized/generated types.
     *
     * When the type server generates its own types that do not directly correspond
     * to source code declarations, it uses this handle.
     *
     * The stub content should be a complete, valid Python stub (.pyi) that includes:
     * 1. All necessary imports (typing module, collections.abc, etc.)
     * 2. TypeVar and ParamSpec declarations used in the type
     * 3. Type aliases or class definitions
     * 4. Function signatures with full parameter and return type annotations
     *
     * This approach is particularly useful for:
     * - Synthesized methods from decorators like @dataclass.__init__
     * - NewType declarations
     * - Generic type specializations
     *
     * Examples:
     *
     * # Example 1: Synthesized dataclass __init__
     * from dataclasses import dataclass
     * @dataclass
     * class Point:
     *     x: int
     *     y: int
     * # Stub content for Point.__init__:
     * """
     * def __init__(self, x: int, y: int) -> None:
     *     '''Initialize Point'''
     * """
     * # metadata: { primaryDefinitionOffset: 0 }
     *
     * # Example 2: Generic function with TypeVar
     * from typing import TypeVar
     * T = TypeVar('T')
     * def identity(x: T) -> T:
     *     return x
     * # Stub content:
     * """
     * from typing import TypeVar
     * T = TypeVar('T')
     * def identity(x: T) -> T: ...
     * """
     * # metadata: { primaryDefinitionOffset: 45 } (offset points to 'def')
     *
     * # Example 3: ParamSpec function
     * from typing import ParamSpec, Callable
     * P = ParamSpec('P')
     * def wrapper(func: Callable[P, int]) -> Callable[P, str]:
     *     ...
     * # Stub content:
     * """
     * from typing import ParamSpec, Callable
     * P = ParamSpec('P')
     * def wrapper(func: Callable[P, int]) -> Callable[P, str]: ...
     * """
     * # metadata: { primaryDefinitionOffset: 67 }
     *
     * # Example 4: NewType
     * from typing import NewType
     * UserId = NewType('UserId', int)
     * # Stub content:
     * """
     * from typing import NewType
     * UserId = NewType('UserId', int)
     * """
     * # metadata: { primaryDefinitionOffset: 25 } (offset points to 'UserId')
     *
     * # Example 5: Complex generic specialization with ParamSpec
     * class Wrapper[P, R]:
     *     func: Callable[P, R]
     * def example(x: int, y: str) -> bool: ...
     * w: Wrapper[(x: int, y: str), bool] = Wrapper()
     * # Stub content for Wrapper[(x: int, y: str), bool]:
     * """
     * from typing import ParamSpec, TypeVar, Generic, Callable
     * P = ParamSpec('P')
     * R = TypeVar('R')
     * class Wrapper(Generic[P, R]):
     *     func: Callable[P, R]
     * """
     * # metadata: { primaryDefinitionOffset: 87 } (offset points to 'class Wrapper')
     * ```
     *
     * Important: The stub content is used to reconstruct the type on the client side by:
     * 1. Parsing the stub as a Python type stub file
     * 2. Evaluating the type expressions within the stub
     * 3. Extracting the resulting type for use in type checking and IntelliSense
     */
    export interface SynthesizedType extends TypeBase<TypeKind.Synthesized> {
        /**
         * Python stub file content (.pyi format) generated for this type.
         *
         * Must include:
         * - Import statements for all typing constructs used (TypeVar, ParamSpec, Callable, etc.)
         * - TypeVar/ParamSpec declarations that appear in the type signature
         * - The complete type definition (function, class, or type alias)
         * - Proper Python stub syntax with ellipsis (...) for function bodies
         *
         * The stub should be minimal but complete - include only what's necessary to
         * reconstruct the type. Avoid including unrelated definitions.
         *
         * Example for a generic function:
         * ```
         * from typing import TypeVar
         * T = TypeVar('T')
         * def identity(x: T) -> T: ...
         * ```
         *
         * Example for a dataclass synthesized method:
         * ```
         * def __init__(self, x: int, y: int, z: str = "") -> None: ...
         * ```
         */
        readonly stubContent: string;

        /**
         * Additional metadata about the synthesized type.
         */
        readonly metadata: SynthesizedTypeMetadata;
    }

    /**
     * Represents a reference to another type by its ID.
     * Used to avoid duplicating large type structures and to handle forward references.
     *
     * Used for:
     * - Deduplication: When the same type appears multiple times, subsequent occurrences
     *   can reference the first occurrence instead of duplicating all fields
     * - Cyclic references: Breaking cycles in recursive type definitions
     * - Large types: Reducing payload size for complex types used repeatedly
     *
     * This is an optimization mechanism in the protocol to keep type handles compact
     * when transmitting over the wire.
     *
     * Examples:
     * ```python
     * # Recursive type definition
     * class Node:
     *     value: int
     *     next: Node | None  # 'Node' references back to itself
     *
     * # When serializing the type of 'next', the second occurrence of Node
     * # uses TypeReferenceType pointing to the first Node's ID
     *
     * # Repeated complex type
     * def process_lists(
     *     list1: list[dict[str, int]],
     *     list2: list[dict[str, int]],  # Can reference the type from list1
     *     list3: list[dict[str, int]]   # Can reference the type from list1
     * ) -> None:
     *     pass
     * ```
     */
    export interface TypeReferenceType extends TypeBase<TypeKind.TypeReference> {
        // Identifier that references another Type by its id.
        // Used to avoid duplicating large type structures and handle forward references.
        // Example: When a type appears multiple times, later occurrences use TypeReference
        // pointing to the first occurrence's id.
        readonly typeReferenceId: number;
    }

    export type Type =
        | BuiltInType
        | DeclaredType
        | FunctionType
        | ClassType
        | UnionType
        | ModuleType
        | TypeVarType
        | OverloadedType
        | SynthesizedType
        | TypeReferenceType;

    // Requests and notifications for the type server protocol.

    // Request for the computed type of a declaration or node. Computed type is the type that is inferred based on the code flow.
    //
    // Example:
    // def foo(a: int | str):
    //     if instanceof(a, int):
    //        b = a + 1  # Computed type of 'b' is 'int'
    export namespace GetComputedTypeRequest {
        export const method = 'typeServer/getComputedType' as const;
        export const messageDirection = MessageDirection.clientToServer;
        export const type = new ProtocolRequestType<
            { arg: Declaration | Node; snapshot: number },
            Type | undefined,
            never,
            void,
            void
        >(method);
    }

    // Request for the declared type of a declaration or node. Declared type is the type that is explicitly declared in the source code.
    //
    // Example:
    // def foo(a: int | str): # Declared type of parameter 'a' is 'int | str'
    //     pass
    export namespace GetDeclaredTypeRequest {
        export const method = 'typeServer/getDeclaredType' as const;
        export const messageDirection = MessageDirection.clientToServer;
        export const type = new ProtocolRequestType<
            { arg: Declaration | Node; snapshot: number },
            Type | undefined,
            never,
            void,
            void
        >(method);
    }

    // Request for the expected type of a declaration or node. Expected type is the type that the context expects.
    //
    // Example:
    // def foo(a: int | str):
    //     pass
    // foo(4)  # Expected type of argument 'a' is 'int | str'
    export namespace GetExpectedTypeRequest {
        export const method = 'typeServer/getExpectedType' as const;
        export const messageDirection = MessageDirection.clientToServer;
        export const type = new ProtocolRequestType<
            { arg: Declaration | Node; snapshot: number },
            Type | undefined,
            never,
            void,
            void
        >(method);
    }

    /**
     * Request to get the search paths that the type server uses for Python modules.
     */
    export namespace GetPythonSearchPathsRequest {
        export const method = 'typeServer/getPythonSearchPaths' as const;
        export const messageDirection = MessageDirection.clientToServer;
        export const type = new ProtocolRequestType<
            GetPythonSearchPathsParams,
            string[] | undefined,
            never,
            void,
            void
        >(method);
    }

    /**
     * Request from client to get the current snapshot of the type server.
     * A snapshot is a point-in-time representation of the type server's state, including all loaded files and their types.
     * A type server should change its snapshot whenever any type it might have returned is no longer valid. Meaning types are
     * only usable for the snapshot they were returned with.
     *
     * Snapshots are not meant to survive any changes that would make the type server throw away its internal cache. They are merely an
     * identifier to indicate to the client that the type server will accept requests for types from that snapshot.
     */
    export namespace GetSnapshotRequest {
        export const method = 'typeServer/getSnapshot' as const;
        export const messageDirection = MessageDirection.clientToServer;
        export const type = new ProtocolRequestType0<number, never, void, void>(method);
    }

    /**
     * Request to get the version of the protocol the type server supports.
     *
     * Returns a string representation of the protocol version (should be semver format)
     */
    export namespace GetSupportedProtocolVersionRequest {
        export const method = 'typeServer/getSupportedProtocolVersion' as const;
        export const messageDirection = MessageDirection.clientToServer;
        export const type = new ProtocolRequestType0<string, never, void, void>(method);
    }

    /**
     * Request to resolve an import. This is used to resolve the import name to its location in the file system.
     */
    export namespace ResolveImportRequest {
        export const method = 'typeServer/resolveImport' as const;
        export const messageDirection = MessageDirection.clientToServer;
        export const type = new ProtocolRequestType<ResolveImportParams, string | undefined, never, void, void>(method);
    }

    /**
     * Main-connection-only request used to open or close an extra TSP transport.
     * Extra transports must remain read-only and must not be used for LSP traffic.
     */
    export namespace ConnectionRequest {
        export const method = 'typeServer/connection' as const;
        export const messageDirection = MessageDirection.clientToServer;
        export const type = new ProtocolRequestType<
            ConnectionRequestParams,
            ConnectionRequestResult,
            never,
            void,
            void
        >(method);
    }

    /**
     * Notification sent by the server to indicate any outstanding snapshots are invalid.
     */
    export namespace SnapshotChangedNotification {
        export const method = 'typeServer/snapshotChanged' as const;
        export const messageDirection = MessageDirection.serverToClient;
        export const type = new ProtocolNotificationType<{ old: number; new: number }, void>(method);
    }
}
