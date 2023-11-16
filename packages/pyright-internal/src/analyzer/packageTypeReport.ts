/*
 * packageTypeReport.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Encapsulates the output of the package type verifier,
 * storing information about the public symbols and whether
 * they have known types.
 */

import { Diagnostic, DiagnosticWithinFile } from '../common/diagnostic';
import { Uri } from '../common/uri/uri';
import { ScopeType } from './scope';

export enum SymbolCategory {
    Indeterminate,
    Module,
    Class,
    Variable,
    Constant,
    Function,
    Method,
    TypeVar,
    TypeAlias,
}

// The order of these is important. Status values with higher numbers are
// considered "worse" than status values with lower numbers.
export const enum TypeKnownStatus {
    Known = 0, // Type is fully known (declared)
    Ambiguous = 1, // Type is inferred and potentially ambiguous (may differ by type checker)
    PartiallyUnknown = 2, // Part of the type is unknown
    Unknown = 3, // The type is completely unknown
}

export interface SymbolInfo {
    category: SymbolCategory;
    name: string;
    fullName: string;
    fileUri: Uri;
    isExported: boolean;
    typeKnownStatus: TypeKnownStatus;
    referenceCount: number;
    diagnostics: DiagnosticWithinFile[];
    scopeType: ScopeType;
}

export interface ModuleInfo {
    name: string;
    uri: Uri;
    isExported: boolean;
}

export type AlternateSymbolNameMap = Map<string, string[]>;

export interface PackageTypeReport {
    packageName: string;
    moduleName: string;
    ignoreExternal: boolean;
    packageRootDirectoryUri: Uri | undefined;
    moduleRootDirectoryUri: Uri | undefined;
    isModuleSingleFile: boolean;
    pyTypedPathUri: Uri | undefined;
    missingFunctionDocStringCount: number;
    missingClassDocStringCount: number;
    missingDefaultParamCount: number;

    // Tracks types that are re-exported from other modules
    // and therefore have "aliased" full names that don't
    // match the full name of the original declaration.
    alternateSymbolNames: AlternateSymbolNameMap;

    // Information about each module in the package and
    // imported by modules in the package.
    modules: Map<string, ModuleInfo>;

    // Diagnostics that are not related to specific types
    // (e.g. missing py.typed file).
    generalDiagnostics: Diagnostic[];

    // Information about all public symbols and the symbols
    // they depend upon, indexed by the full name.
    symbols: Map<string, SymbolInfo>;
}

export function getEmptyReport(
    packageName: string,
    packageRootUri: Uri,
    moduleName: string,
    moduleRootUri: Uri,
    isModuleSingleFile: boolean,
    ignoreExternal: boolean
) {
    const report: PackageTypeReport = {
        packageName,
        ignoreExternal,
        packageRootDirectoryUri: packageRootUri,
        moduleName,
        moduleRootDirectoryUri: moduleRootUri,
        isModuleSingleFile,
        pyTypedPathUri: undefined,
        missingFunctionDocStringCount: 0,
        missingClassDocStringCount: 0,
        missingDefaultParamCount: 0,
        alternateSymbolNames: new Map<string, string[]>(),
        modules: new Map<string, ModuleInfo>(),
        generalDiagnostics: [],
        symbols: new Map<string, SymbolInfo>(),
    };
    return report;
}
