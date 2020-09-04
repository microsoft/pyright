/*
 * importResult.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Interface that describes the output of the import resolver.
 */

export const enum ImportType {
    BuiltIn,
    ThirdParty,
    Local,
}

export interface ImplicitImport {
    isStubFile: boolean;
    name: string;
    path: string;
}

export interface ImportResult {
    // The formatted import name. Useful for error messages.
    importName: string;

    // Indicates whether the import name was relative (starts
    // with one or more dots).
    isRelative: boolean;

    // True if import was resolved to a module or file.
    isImportFound: boolean;

    // True if the import refers to a namespace package (a
    // folder without an __init__.py file).
    isNamespacePackage: boolean;

    // If isImportFound is false, may contain strings that help
    // diagnose the import resolution failure.
    importFailureInfo?: string[];

    // Type of import (built-in, local, third-party).
    importType: ImportType;

    // The resolved absolute paths for each of the files in the module name.
    // Parts that have no files (e.g. directories within a namespace
    // package) have empty strings for a resolvedPath.
    resolvedPaths: string[];

    // For absolute imports, the search path that was used to resolve
    // (or partially resolve) the module.
    searchPath?: string;

    // True if resolved file is a type hint (.pyi) file rather than
    // a python (.py) file.
    isStubFile: boolean;

    // True if resolved file is a native DLL.
    isNativeLib: boolean;

    // True if the resolved file is a type hint (.pyi) file that comes
    // from typeshed.
    isTypeshedFile?: boolean;

    // True if the resolved file is a type hint (.pyi) file that comes
    // from the configured typings directory.
    isLocalTypingsFile?: boolean;

    // List of files within the final resolved path that are implicitly
    // imported as part of the package - used for both traditional and
    // namespace packages.
    implicitImports: ImplicitImport[];

    // If resolved from a type hint (.pyi), then store the import result
    // from .py here.
    nonStubImportResult?: ImportResult;

    // Is there a "py.typed" file (as described in PEP 561) present in
    // the package that was used to resolve the import?
    isPyTypedPresent?: boolean;

    // The directory of the package, if found.
    packageDirectory?: string;
}
