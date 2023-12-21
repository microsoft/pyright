/*
 * importResult.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Interface that describes the output of the import resolver.
 */

import { Uri } from '../common/uri/uri';
import { PyTypedInfo } from './pyTypedUtils';

export const enum ImportType {
    BuiltIn,
    ThirdParty,
    Local,
}

export interface ImplicitImport {
    isStubFile: boolean;
    isNativeLib: boolean;
    name: string;
    uri: Uri;
    pyTypedInfo?: PyTypedInfo | undefined;
}

export interface ImportResult {
    // The formatted import name. Useful for error messages.
    importName: string;

    // Indicates whether the import name was relative (starts
    // with one or more dots).
    isRelative: boolean;

    // True if import was resolved to a module or file.
    isImportFound: boolean;

    // The specific submodule was not found but a part of
    // its path was resolved.
    isPartlyResolved: boolean;

    // True if the import refers to a namespace package (a
    // folder without an __init__.py(i) file at the last level).
    // To determine if any intermediate level is a namespace
    // package, look at the resolvedPaths array. Namespace package
    // entries will have an empty string for the resolvedPath.
    isNamespacePackage: boolean;

    // True if there is an __init__.py(i) file in the final
    // directory resolved.
    isInitFilePresent: boolean;

    // Did it resolve to a stub within a stub package?
    isStubPackage: boolean;

    // If isImportFound is false, may contain strings that help
    // diagnose the import resolution failure.
    importFailureInfo?: string[];

    // Type of import (built-in, local, third-party).
    importType: ImportType;

    // The resolved absolute paths for each of the files in the module name.
    // Parts that have no files (e.g. directories within a namespace
    // package) have empty strings for a resolvedPath.
    resolvedUris: Uri[];

    // For absolute imports, the search path that was used to resolve
    // (or partially resolve) the module.
    searchPath?: Uri;

    // True if resolved file is a type hint (.pyi) file rather than
    // a python (.py) file.
    isStubFile: boolean;

    // True if resolved file is a native DLL.
    isNativeLib: boolean;

    // True if the resolved file is a type hint (.pyi) file that comes
    // from typeshed in the stdlib or third-party stubs.
    isStdlibTypeshedFile?: boolean;
    isThirdPartyTypeshedFile?: boolean;

    // True if the resolved file is a type hint (.pyi) file that comes
    // from the configured typings directory.
    isLocalTypingsFile?: boolean;

    // List of files within the final resolved path that are implicitly
    // imported as part of the package - used for both traditional and
    // namespace packages.
    implicitImports: Map<string, ImplicitImport>;

    // Implicit imports that have been filtered to include only
    // those symbols that are explicitly imported in a "from x import y"
    // statement.
    filteredImplicitImports: Map<string, ImplicitImport>;

    // If resolved from a type hint (.pyi), then store the import result
    // from .py here.
    nonStubImportResult?: ImportResult | undefined;

    // Is there a "py.typed" file (as described in PEP 561) present in
    // the package that was used to resolve the import?
    pyTypedInfo?: PyTypedInfo | undefined;

    // The directory of the package, if found.
    packageDirectory?: Uri | undefined;
}
