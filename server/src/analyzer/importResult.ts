/*
* importResult.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Interface that describes the output of the import resolver.
*/

export enum ImportType {
    BuiltIn,
    Local,
    ThirdParty
}

export interface ImplicitImport {
    isStubFile: boolean;
    name: string;
    path: string;
}

export interface ImportResult {
    // The formatted import name. Useful for error messages.
    importName: string;

    // True if import was resolved to a module or file.
    importFound: boolean;

    // Type of import (built-in, local, third-party).
    importType: ImportType;

    // The resolved absolute paths for each of the elements in the module name.
    resolvedPaths: string[];

    // Indicates whether the import is a traditional package (with an
    // __init__.py in it) or a "namespace" package (defined by PEP-420).
    isNamespacePackage: boolean;

    // For absolute imports, the search path that was used to resolve
    // (or partially resolve) the module.
    searchPath?: string;

    // True if resolved file is a type hint (.pyi) file rather than
    // a python (.py) file.
    isStubFile: boolean;

    // True if the resolved file is a type hint (.pyi) file that comes
    // from typeshed.
    isTypeshedFile?: boolean;

    // List of files within the final resolved path that are implicitly
    // imported as part of the package — used for both traditional and
    // namespace packages.
    implicitImports: ImplicitImport[];
}
