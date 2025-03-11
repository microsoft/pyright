/*
 * declaration.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Tracks the location within the code where a named entity
 * is declared and its associated declared type (if the type
 * is explicitly declared).
 */

import { Range } from '../common/textRange';
import { Uri } from '../common/uri/uri';
import {
    ClassNode,
    ExpressionNode,
    FunctionNode,
    ImportAsNode,
    ImportFromAsNode,
    ImportFromNode,
    ModuleNode,
    NameNode,
    ParameterNode,
    ParseNode,
    RaiseNode,
    ReturnNode,
    StringListNode,
    TypeAliasNode,
    TypeAnnotationNode,
    TypeParameterNode,
    YieldFromNode,
    YieldNode,
} from '../parser/parseNodes';

export const UnresolvedModuleMarker = Uri.constant('*** unresolved module ***');

export const enum DeclarationType {
    Intrinsic,
    Variable,
    Param,
    TypeParam,
    TypeAlias,
    Function,
    Class,
    SpecialBuiltInClass,
    Alias,
}

export type IntrinsicType =
    | 'Any'
    | 'str'
    | 'str | None'
    | 'int'
    | 'MutableSequence[str]'
    | 'type[self]'
    | 'Dict[str, Any]';

export interface DeclarationBase {
    // Category of this symbol (function, variable, etc.).
    // Used by hover provider to display helpful text.
    type: DeclarationType;

    // Parse node associated with the declaration. Does not necessarily match
    // the path and range.
    node: ParseNode;

    // The file and range within that file that
    // contains the declaration. Unless this is an alias, then uri refers to the
    // file the alias is referring to.
    uri: Uri;
    range: Range;

    // The dot-separated import name for the file that
    // contains the declaration (may not be definitive
    // because a source file can be accessed via different
    // import names in some cases).
    moduleName: string;

    // The declaration is within an except clause of a try
    // statement. We may want to ignore such declarations.
    isInExceptSuite: boolean;

    // This declaration is within an inlined TypedDict definition.
    isInInlinedTypedDict?: boolean;
}

export interface IntrinsicDeclaration extends DeclarationBase {
    type: DeclarationType.Intrinsic;
    node: ModuleNode | FunctionNode | ClassNode;
    intrinsicType: IntrinsicType;
}

export interface ClassDeclaration extends DeclarationBase {
    type: DeclarationType.Class;
    node: ClassNode;
}

// This declaration form is used only for a few special
// built-in class types defined in typing.pyi.
export interface SpecialBuiltInClassDeclaration extends DeclarationBase {
    type: DeclarationType.SpecialBuiltInClass;
    node: TypeAnnotationNode;
}

export interface FunctionDeclaration extends DeclarationBase {
    type: DeclarationType.Function;
    node: FunctionNode;
    isMethod: boolean;
    isGenerator: boolean;
    returnStatements?: ReturnNode[];
    yieldStatements?: (YieldNode | YieldFromNode)[];
    raiseStatements?: RaiseNode[];
}

export interface ParamDeclaration extends DeclarationBase {
    type: DeclarationType.Param;
    node: ParameterNode;

    // Inferred parameters can be inferred from pieces of an actual NameNode, so this
    // value represents the actual 'name' as the user thinks of it.
    inferredName?: string;

    // Nodes that potentially makeup the type of an inferred parameter.
    inferredTypeNodes?: ExpressionNode[];
}

export interface TypeParamDeclaration extends DeclarationBase {
    type: DeclarationType.TypeParam;
    node: TypeParameterNode;
}

export interface TypeAliasDeclaration extends DeclarationBase {
    type: DeclarationType.TypeAlias;
    node: TypeAliasNode;

    // If a docstring (based on PEP 258) is present...
    docString?: string | undefined;
}

export interface VariableDeclaration extends DeclarationBase {
    type: DeclarationType.Variable;
    node: NameNode | StringListNode;

    // An explicit type annotation, if provided
    typeAnnotationNode?: ExpressionNode | undefined;

    // A source of the inferred type
    inferredTypeSource?: ParseNode | undefined;

    // Is the declaration considered "constant" (i.e.
    // reassignment is not permitted)?
    isConstant?: boolean | undefined;

    // Is the declaration considered "final" (similar to
    // constant in that reassignment is not permitted)?
    isFinal?: boolean;

    // Is the declaration an entry in __slots__?
    isDefinedBySlots?: boolean;

    // For most symbols in a "py.typed" file, type inference is not
    // allowed. But in certain cases (as with __match_args__ or __slots__),
    // inference is permitted.
    isInferenceAllowedInPyTyped?: boolean;

    // Is the declaration using a runtime-evaluated type expression
    // rather than an annotation? This is used for TypedDicts, NamedTuples,
    // and other complex (more dynamic) class definitions with typed variables.
    isRuntimeTypeExpression?: boolean;

    // If the declaration is a type alias, points to the alias name.
    typeAliasName?: NameNode | undefined;

    // Is the declaration a class or instance variable defined
    // by a member access, or is it a direct variable declaration
    // within the class?
    isDefinedByMemberAccess?: boolean;

    // If an "attribute docstring" (as defined in PEP 258) is present...
    docString?: string | undefined;

    // If set, indicates an alternative node to use to determine the type of the variable.
    alternativeTypeNode?: ExpressionNode;

    // Is the declaration an assignment through an explicit nonlocal or global binding?
    isExplicitBinding?: boolean;
}

// Alias declarations are used for imports. They are resolved
// after the binding phase.
export interface AliasDeclaration extends DeclarationBase {
    type: DeclarationType.Alias;
    node: ImportAsNode | ImportFromAsNode | ImportFromNode;

    // Does this declaration use a local name or use the
    // imported symbol directly? This is used to find and
    // rename references.
    usesLocalName: boolean;

    // Indicate whether symbols can be loaded from the path.
    loadSymbolsFromPath: boolean;

    // The name of the symbol being imported (used for "from X import Y"
    // statements, not applicable to "import X" statements).
    symbolName?: string | undefined;

    // If there is a symbol name that can't be resolved within
    // the target module (defined by "path"), the symbol might
    // refer to a submodule with the same name.
    submoduleFallback?: AliasDeclaration | undefined;

    // The first part of the multi-part name used in the import
    // statement (e.g. for "import a.b.c", firstNamePart would
    // be "a").
    firstNamePart?: string | undefined;

    // If the alias is targeting a module, multiple other modules
    // may also need to be resolved and inserted implicitly into
    // the module's namespace to emulate the behavior of the python
    // module loader. This can be recursive (e.g. in the case of
    // an "import a.b.c.d" statement).
    implicitImports?: Map<string, ModuleLoaderActions>;

    // Is this a dummy entry for an unresolved import?
    isUnresolved?: boolean;

    // Is this a dummy entry for an import that cannot be resolved
    // directly because it targets a native library?
    isNativeLib?: boolean;
}

// This interface represents a set of actions that the python loader
// performs when a module import is encountered.
export interface ModuleLoaderActions {
    // The resolved uri of the implicit import. This can be empty
    // if the resolved uri doesn't reference a module (e.g. it's
    // a directory).
    uri: Uri;

    // Is this a dummy entry for an unresolved import?
    isUnresolved?: boolean;

    // Indicate whether symbols can be loaded from the path.
    loadSymbolsFromPath: boolean;

    // See comment for "implicitImports" field in AliasDeclaration.
    implicitImports?: Map<string, ModuleLoaderActions>;
}

export type Declaration =
    | IntrinsicDeclaration
    | ClassDeclaration
    | SpecialBuiltInClassDeclaration
    | FunctionDeclaration
    | ParamDeclaration
    | TypeParamDeclaration
    | TypeAliasDeclaration
    | VariableDeclaration
    | AliasDeclaration;

export function isFunctionDeclaration(decl: Declaration): decl is FunctionDeclaration {
    return decl.type === DeclarationType.Function;
}

export function isClassDeclaration(decl: Declaration): decl is ClassDeclaration {
    return decl.type === DeclarationType.Class;
}

export function isParamDeclaration(decl: Declaration): decl is ParamDeclaration {
    return decl.type === DeclarationType.Param;
}

export function isTypeParamDeclaration(decl: Declaration): decl is TypeParamDeclaration {
    return decl.type === DeclarationType.TypeParam;
}

export function isTypeAliasDeclaration(decl: Declaration): decl is TypeAliasDeclaration {
    return decl.type === DeclarationType.TypeAlias;
}

export function isVariableDeclaration(decl: Declaration): decl is VariableDeclaration {
    return decl.type === DeclarationType.Variable;
}

export function isAliasDeclaration(decl: Declaration): decl is AliasDeclaration {
    return decl.type === DeclarationType.Alias;
}

export function isSpecialBuiltInClassDeclaration(decl: Declaration): decl is SpecialBuiltInClassDeclaration {
    return decl.type === DeclarationType.SpecialBuiltInClass;
}

export function isIntrinsicDeclaration(decl: Declaration): decl is IntrinsicDeclaration {
    return decl.type === DeclarationType.Intrinsic;
}

export function isUnresolvedAliasDeclaration(decl: Declaration): boolean {
    return isAliasDeclaration(decl) && decl.uri.equals(UnresolvedModuleMarker);
}
