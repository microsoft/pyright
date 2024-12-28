/*
 * configOptions.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Class that holds the configuration options for the analyzer.
 */

import { isAbsolute } from 'path';

import { getPathsFromPthFiles } from '../analyzer/pythonPathUtils';
import * as pathConsts from '../common/pathConsts';
import { appendArray } from './collectionUtils';
import {
    DiagnosticBooleanOverridesMap,
    DiagnosticSeverityOverrides,
    DiagnosticSeverityOverridesMap,
    getDiagnosticSeverityOverrides,
} from './commandLineOptions';
import { ConsoleInterface, NullConsole } from './console';
import { isBoolean } from './core';
import { TaskListToken } from './diagnostic';
import { DiagnosticRule } from './diagnosticRules';
import { FileSystem } from './fileSystem';
import { Host } from './host';
import { PythonVersion, latestStablePythonVersion } from './pythonVersion';
import { ServiceKeys } from './serviceKeys';
import { ServiceProvider } from './serviceProvider';
import { Uri } from './uri/uri';
import { FileSpec, getFileSpec, isDirectory } from './uri/uriUtils';

export enum PythonPlatform {
    Darwin = 'Darwin',
    Windows = 'Windows',
    Linux = 'Linux',
}

export class ExecutionEnvironment {
    // Root directory for execution.
    // Undefined if this is a rootless environment (e.g., open file mode).
    root?: Uri;

    // Name of a virtual environment if there is one, otherwise
    // just the path to the python executable.
    name: string;

    // Always default to the latest stable version of the language.
    pythonVersion: PythonVersion;

    // Default to no platform.
    pythonPlatform?: string | undefined;

    // Default to no extra paths.
    extraPaths: Uri[] = [];

    // Diagnostic rules with overrides.
    diagnosticRuleSet: DiagnosticRuleSet;

    // Skip import resolution attempts for native libraries. These can
    // be expensive and are not needed for some use cases (e.g. web-based
    // tools or playgrounds).
    skipNativeLibraries: boolean;

    // Default to "." which indicates every file in the project.
    constructor(
        name: string,
        root: Uri,
        defaultDiagRuleSet: DiagnosticRuleSet,
        defaultPythonVersion: PythonVersion | undefined,
        defaultPythonPlatform: string | undefined,
        defaultExtraPaths: Uri[] | undefined,
        skipNativeLibraries = false
    ) {
        this.name = name;
        this.root = root;
        this.pythonVersion = defaultPythonVersion ?? latestStablePythonVersion;
        this.pythonPlatform = defaultPythonPlatform;
        this.extraPaths = Array.from(defaultExtraPaths ?? []);
        this.diagnosticRuleSet = { ...defaultDiagRuleSet };
        this.skipNativeLibraries = skipNativeLibraries;
    }
}

export type DiagnosticLevel = 'none' | 'information' | 'warning' | 'error';

export enum SignatureDisplayType {
    compact = 'compact',
    formatted = 'formatted',
}

export interface DiagnosticRuleSet {
    // Should "Unknown" types be reported as "Any"?
    printUnknownAsAny: boolean;

    // Should type arguments to a generic class be omitted
    // when printed if all arguments are Unknown?
    omitTypeArgsIfUnknown: boolean;

    // Should parameter type be omitted if it is not annotated?
    omitUnannotatedParamType: boolean;

    // Indicate when a type is conditional based on a constrained
    // type variable type?
    omitConditionalConstraint: boolean;

    // Should Union and Optional types be printed in PEP 604 format?
    pep604Printing: boolean;

    // Use strict inference rules for list expressions?
    strictListInference: boolean;

    // Use strict inference rules for set expressions?
    strictSetInference: boolean;

    // Use strict inference rules for dictionary expressions?
    strictDictionaryInference: boolean;

    // Analyze functions and methods that have no annotations?
    analyzeUnannotatedFunctions: boolean;

    // Use strict type rules for parameters assigned default of None?
    strictParameterNoneValue: boolean;

    // Enable experimental features that are not yet part of the
    // official Python typing spec?
    enableExperimentalFeatures: boolean;

    // Enable support for type: ignore comments?
    enableTypeIgnoreComments: boolean;

    // Use tagged hints to identify unreachable code via type analysis?
    enableReachabilityAnalysis: boolean;

    // Treat old typing aliases as deprecated if pythonVersion >= 3.9?
    deprecateTypingAliases: boolean;

    // No longer treat bytearray and memoryview as subclasses of bytes?
    disableBytesTypePromotions: boolean;

    // Report general type issues?
    reportGeneralTypeIssues: DiagnosticLevel;

    // Report mismatch in types between property getter and setter?
    reportPropertyTypeMismatch: DiagnosticLevel;

    // Report the use of unknown member accesses on function objects?
    reportFunctionMemberAccess: DiagnosticLevel;

    // Report missing imports?
    reportMissingImports: DiagnosticLevel;

    // Report missing imported module source files?
    reportMissingModuleSource: DiagnosticLevel;

    // Report invalid type annotation forms?
    reportInvalidTypeForm: DiagnosticLevel;

    // Report missing type stub files?
    reportMissingTypeStubs: DiagnosticLevel;

    // Report cycles in import graph?
    reportImportCycles: DiagnosticLevel;

    // Report imported symbol that is not accessed?
    reportUnusedImport: DiagnosticLevel;

    // Report private class that is not accessed?
    reportUnusedClass: DiagnosticLevel;

    // Report private function or method that is not accessed?
    reportUnusedFunction: DiagnosticLevel;

    // Report variable that is not accessed?
    reportUnusedVariable: DiagnosticLevel;

    // Report symbol or module that is imported more than once?
    reportDuplicateImport: DiagnosticLevel;

    // Report use of wildcard import for non-local imports?
    reportWildcardImportFromLibrary: DiagnosticLevel;

    // Report use of abstract method or variable?
    reportAbstractUsage: DiagnosticLevel;

    // Report argument type incompatibilities?
    reportArgumentType: DiagnosticLevel;

    // Report failure of assert_type call?
    reportAssertTypeFailure: DiagnosticLevel;

    // Report type incompatibility for assignments?
    reportAssignmentType: DiagnosticLevel;

    // Report issues related to attribute access expressions?
    reportAttributeAccessIssue: DiagnosticLevel;

    // Report issues related to call expressions?
    reportCallIssue: DiagnosticLevel;

    // Report inconsistencies with function overload signatures?
    reportInconsistentOverload: DiagnosticLevel;

    // Report issues with index operations and expressions?
    reportIndexIssue: DiagnosticLevel;

    // Report invalid type argument usage?
    reportInvalidTypeArguments: DiagnosticLevel;

    // Report missing overloaded function implementation?
    reportNoOverloadImplementation: DiagnosticLevel;

    // Report issues related to the use of unary or binary operators?
    reportOperatorIssue: DiagnosticLevel;

    // Report attempts to subscript (index) an Optional type?
    reportOptionalSubscript: DiagnosticLevel;

    // Report attempts to access members on a Optional type?
    reportOptionalMemberAccess: DiagnosticLevel;

    // Report attempts to call a Optional type?
    reportOptionalCall: DiagnosticLevel;

    // Report attempts to use an Optional type as an iterable?
    reportOptionalIterable: DiagnosticLevel;

    // Report attempts to use an Optional type in a "with" statement?
    reportOptionalContextManager: DiagnosticLevel;

    // Report attempts to use an Optional type in a binary or unary operation?
    reportOptionalOperand: DiagnosticLevel;

    // Report attempts to redeclare the type of a symbol?
    reportRedeclaration: DiagnosticLevel;

    // Report return type mismatches?
    reportReturnType: DiagnosticLevel;

    // Report accesses to non-required TypedDict fields?
    reportTypedDictNotRequiredAccess: DiagnosticLevel;

    // Report untyped function decorators that obscure the function type?
    reportUntypedFunctionDecorator: DiagnosticLevel;

    // Report untyped class decorators that obscure the class type?
    reportUntypedClassDecorator: DiagnosticLevel;

    // Report untyped base class that obscure the class type?
    reportUntypedBaseClass: DiagnosticLevel;

    // Report use of untyped namedtuple factory method?
    reportUntypedNamedTuple: DiagnosticLevel;

    // Report usage of private variables and functions outside of
    // the owning class or module?
    reportPrivateUsage: DiagnosticLevel;

    // Report usage of deprecated type comments.
    reportTypeCommentUsage: DiagnosticLevel;

    // Report usage of an import from a py.typed module that is
    // not meant to be re-exported from that module.
    reportPrivateImportUsage: DiagnosticLevel;

    // Report attempts to redefine variables that are in all-caps.
    reportConstantRedefinition: DiagnosticLevel;

    // Report use of deprecated classes or functions.
    reportDeprecated: DiagnosticLevel;

    // Report usage of method override that is incompatible with
    // the base class method of the same name?
    reportIncompatibleMethodOverride: DiagnosticLevel;

    // Report usage of variable override that is incompatible with
    // the base class symbol of the same name?
    reportIncompatibleVariableOverride: DiagnosticLevel;

    // Report inconsistencies between __init__ and __new__ signatures.
    reportInconsistentConstructor: DiagnosticLevel;

    // Report function overloads that overlap in signature but have
    // incompatible return types.
    reportOverlappingOverload: DiagnosticLevel;

    // Report usage of possibly unbound variables.
    reportPossiblyUnboundVariable: DiagnosticLevel;

    // Report failure to call super().__init__() in __init__ method.
    reportMissingSuperCall: DiagnosticLevel;

    // Report instance variables that are not initialized within
    // the constructor.
    reportUninitializedInstanceVariable: DiagnosticLevel;

    // Report usage of invalid escape sequences in string literals?
    reportInvalidStringEscapeSequence: DiagnosticLevel;

    // Report usage of unknown input or return parameters for functions?
    reportUnknownParameterType: DiagnosticLevel;

    // Report usage of unknown arguments for function calls?
    reportUnknownArgumentType: DiagnosticLevel;

    // Report usage of unknown input or return parameters for lambdas?
    reportUnknownLambdaType: DiagnosticLevel;

    // Report usage of unknown input or return parameters?
    reportUnknownVariableType: DiagnosticLevel;

    // Report usage of unknown input or return parameters?
    reportUnknownMemberType: DiagnosticLevel;

    // Report input parameters that are missing type annotations?
    reportMissingParameterType: DiagnosticLevel;

    // Report usage of generic class without explicit type arguments?
    reportMissingTypeArgument: DiagnosticLevel;

    // Report improper usage of type variables within function signatures?
    reportInvalidTypeVarUse: DiagnosticLevel;

    // Report usage of function call within default value
    // initialization expression?
    reportCallInDefaultInitializer: DiagnosticLevel;

    // Report calls to isinstance or issubclass that are statically determined
    // to always be true.
    reportUnnecessaryIsInstance: DiagnosticLevel;

    // Report calls to cast that are statically determined
    // to always unnecessary.
    reportUnnecessaryCast: DiagnosticLevel;

    // Report == or != operators that always evaluate to True or False.
    reportUnnecessaryComparison: DiagnosticLevel;

    // Report 'in' operations that always evaluate to True or False.
    reportUnnecessaryContains: DiagnosticLevel;

    // Report assert expressions that will always evaluate to true.
    reportAssertAlwaysTrue: DiagnosticLevel;

    // Report when "self" or "cls" parameter is missing or is misnamed.
    reportSelfClsParameterName: DiagnosticLevel;

    // Report implicit concatenation of string literals.
    reportImplicitStringConcatenation: DiagnosticLevel;

    // Report usage of undefined variables.
    reportUndefinedVariable: DiagnosticLevel;

    // Report usage of unbound variables.
    reportUnboundVariable: DiagnosticLevel;

    // Report use of unhashable type in a dictionary.
    reportUnhashable: DiagnosticLevel;

    // Report statements that are syntactically correct but
    // have no semantic meaning within a type stub file.
    reportInvalidStubStatement: DiagnosticLevel;

    // Report usage of __getattr__ at the module level in a stub.
    reportIncompleteStub: DiagnosticLevel;

    // Report operations on __all__ symbol that are not supported
    // by a static type checker.
    reportUnsupportedDunderAll: DiagnosticLevel;

    // Report cases where a call expression's return result is not
    // None and is not used in any way.
    reportUnusedCallResult: DiagnosticLevel;

    // Report cases where a call expression's return result is Coroutine
    // and is not used in any way.
    reportUnusedCoroutine: DiagnosticLevel;

    // Report except clause that is unreachable.
    reportUnusedExcept: DiagnosticLevel;

    // Report cases where a simple expression result is not used in any way.
    reportUnusedExpression: DiagnosticLevel;

    // Report cases where the removal of a "# type: ignore" or "# pyright: ignore"
    // comment would have no effect.
    reportUnnecessaryTypeIgnoreComment: DiagnosticLevel;

    // Report cases where the a "match" statement is not exhaustive in
    // covering all possible cases.
    reportMatchNotExhaustive: DiagnosticLevel;

    // Report files that match stdlib modules.
    reportShadowedImports: DiagnosticLevel;

    // Report missing @override decorator.
    reportImplicitOverride: DiagnosticLevel;
}

export function cloneDiagnosticRuleSet(diagSettings: DiagnosticRuleSet): DiagnosticRuleSet {
    // Create a shallow copy of the existing object.
    return Object.assign({}, diagSettings);
}

// Returns a list of the diagnostic rules that are configured with
// a true or false value.
export function getBooleanDiagnosticRules(includeNonOverridable = false) {
    const boolRules = [
        DiagnosticRule.strictListInference,
        DiagnosticRule.strictSetInference,
        DiagnosticRule.strictDictionaryInference,
        DiagnosticRule.analyzeUnannotatedFunctions,
        DiagnosticRule.strictParameterNoneValue,
        DiagnosticRule.enableExperimentalFeatures,
        DiagnosticRule.deprecateTypingAliases,
        DiagnosticRule.disableBytesTypePromotions,
    ];

    if (includeNonOverridable) {
        // Do not include these because we don't
        // want to override it in strict mode or support
        // it within pyright comments.
        boolRules.push(DiagnosticRule.enableTypeIgnoreComments);
        boolRules.push(DiagnosticRule.enableReachabilityAnalysis);
    }

    return boolRules;
}

// Returns a list of the diagnostic rules that are configured with
// a diagnostic level ('none', 'error', etc.).
export function getDiagLevelDiagnosticRules() {
    return [
        DiagnosticRule.reportGeneralTypeIssues,
        DiagnosticRule.reportPropertyTypeMismatch,
        DiagnosticRule.reportFunctionMemberAccess,
        DiagnosticRule.reportMissingImports,
        DiagnosticRule.reportMissingModuleSource,
        DiagnosticRule.reportInvalidTypeForm,
        DiagnosticRule.reportMissingTypeStubs,
        DiagnosticRule.reportImportCycles,
        DiagnosticRule.reportUnusedImport,
        DiagnosticRule.reportUnusedClass,
        DiagnosticRule.reportUnusedFunction,
        DiagnosticRule.reportUnusedVariable,
        DiagnosticRule.reportDuplicateImport,
        DiagnosticRule.reportWildcardImportFromLibrary,
        DiagnosticRule.reportAbstractUsage,
        DiagnosticRule.reportArgumentType,
        DiagnosticRule.reportAssertTypeFailure,
        DiagnosticRule.reportAssignmentType,
        DiagnosticRule.reportAttributeAccessIssue,
        DiagnosticRule.reportCallIssue,
        DiagnosticRule.reportInconsistentOverload,
        DiagnosticRule.reportIndexIssue,
        DiagnosticRule.reportInvalidTypeArguments,
        DiagnosticRule.reportNoOverloadImplementation,
        DiagnosticRule.reportOperatorIssue,
        DiagnosticRule.reportOptionalSubscript,
        DiagnosticRule.reportOptionalMemberAccess,
        DiagnosticRule.reportOptionalCall,
        DiagnosticRule.reportOptionalIterable,
        DiagnosticRule.reportOptionalContextManager,
        DiagnosticRule.reportOptionalOperand,
        DiagnosticRule.reportRedeclaration,
        DiagnosticRule.reportReturnType,
        DiagnosticRule.reportTypedDictNotRequiredAccess,
        DiagnosticRule.reportUntypedFunctionDecorator,
        DiagnosticRule.reportUntypedClassDecorator,
        DiagnosticRule.reportUntypedBaseClass,
        DiagnosticRule.reportUntypedNamedTuple,
        DiagnosticRule.reportPrivateUsage,
        DiagnosticRule.reportTypeCommentUsage,
        DiagnosticRule.reportPrivateImportUsage,
        DiagnosticRule.reportConstantRedefinition,
        DiagnosticRule.reportDeprecated,
        DiagnosticRule.reportIncompatibleMethodOverride,
        DiagnosticRule.reportIncompatibleVariableOverride,
        DiagnosticRule.reportInconsistentConstructor,
        DiagnosticRule.reportOverlappingOverload,
        DiagnosticRule.reportPossiblyUnboundVariable,
        DiagnosticRule.reportMissingSuperCall,
        DiagnosticRule.reportUninitializedInstanceVariable,
        DiagnosticRule.reportInvalidStringEscapeSequence,
        DiagnosticRule.reportUnknownParameterType,
        DiagnosticRule.reportUnknownArgumentType,
        DiagnosticRule.reportUnknownLambdaType,
        DiagnosticRule.reportUnknownVariableType,
        DiagnosticRule.reportUnknownMemberType,
        DiagnosticRule.reportMissingParameterType,
        DiagnosticRule.reportMissingTypeArgument,
        DiagnosticRule.reportInvalidTypeVarUse,
        DiagnosticRule.reportCallInDefaultInitializer,
        DiagnosticRule.reportUnnecessaryIsInstance,
        DiagnosticRule.reportUnnecessaryCast,
        DiagnosticRule.reportUnnecessaryComparison,
        DiagnosticRule.reportUnnecessaryContains,
        DiagnosticRule.reportAssertAlwaysTrue,
        DiagnosticRule.reportSelfClsParameterName,
        DiagnosticRule.reportImplicitStringConcatenation,
        DiagnosticRule.reportUndefinedVariable,
        DiagnosticRule.reportUnhashable,
        DiagnosticRule.reportUnboundVariable,
        DiagnosticRule.reportInvalidStubStatement,
        DiagnosticRule.reportIncompleteStub,
        DiagnosticRule.reportUnsupportedDunderAll,
        DiagnosticRule.reportUnusedCallResult,
        DiagnosticRule.reportUnusedCoroutine,
        DiagnosticRule.reportUnusedExcept,
        DiagnosticRule.reportUnusedExpression,
        DiagnosticRule.reportUnnecessaryTypeIgnoreComment,
        DiagnosticRule.reportMatchNotExhaustive,
        DiagnosticRule.reportShadowedImports,
        DiagnosticRule.reportImplicitOverride,
    ];
}

export function getStrictModeNotOverriddenRules() {
    // In strict mode, the value in the user config file should be honored and
    // not overwritten by the value from the strict rule set.
    return [DiagnosticRule.reportMissingModuleSource];
}

export function getOffDiagnosticRuleSet(): DiagnosticRuleSet {
    const diagSettings: DiagnosticRuleSet = {
        printUnknownAsAny: true,
        omitTypeArgsIfUnknown: true,
        omitUnannotatedParamType: true,
        omitConditionalConstraint: true,
        pep604Printing: true,
        strictListInference: false,
        strictSetInference: false,
        strictDictionaryInference: false,
        analyzeUnannotatedFunctions: true,
        strictParameterNoneValue: true,
        enableExperimentalFeatures: false,
        enableTypeIgnoreComments: true,
        enableReachabilityAnalysis: false,
        deprecateTypingAliases: false,
        disableBytesTypePromotions: true,
        reportGeneralTypeIssues: 'none',
        reportPropertyTypeMismatch: 'none',
        reportFunctionMemberAccess: 'none',
        reportMissingImports: 'warning',
        reportMissingModuleSource: 'warning',
        reportInvalidTypeForm: 'warning',
        reportMissingTypeStubs: 'none',
        reportImportCycles: 'none',
        reportUnusedImport: 'none',
        reportUnusedClass: 'none',
        reportUnusedFunction: 'none',
        reportUnusedVariable: 'none',
        reportDuplicateImport: 'none',
        reportWildcardImportFromLibrary: 'none',
        reportAbstractUsage: 'none',
        reportArgumentType: 'none',
        reportAssertTypeFailure: 'none',
        reportAssignmentType: 'none',
        reportAttributeAccessIssue: 'none',
        reportCallIssue: 'none',
        reportInconsistentOverload: 'none',
        reportIndexIssue: 'none',
        reportInvalidTypeArguments: 'none',
        reportNoOverloadImplementation: 'none',
        reportOperatorIssue: 'none',
        reportOptionalSubscript: 'none',
        reportOptionalMemberAccess: 'none',
        reportOptionalCall: 'none',
        reportOptionalIterable: 'none',
        reportOptionalContextManager: 'none',
        reportOptionalOperand: 'none',
        reportRedeclaration: 'none',
        reportReturnType: 'none',
        reportTypedDictNotRequiredAccess: 'none',
        reportUntypedFunctionDecorator: 'none',
        reportUntypedClassDecorator: 'none',
        reportUntypedBaseClass: 'none',
        reportUntypedNamedTuple: 'none',
        reportPrivateUsage: 'none',
        reportTypeCommentUsage: 'none',
        reportPrivateImportUsage: 'none',
        reportConstantRedefinition: 'none',
        reportDeprecated: 'none',
        reportIncompatibleMethodOverride: 'none',
        reportIncompatibleVariableOverride: 'none',
        reportInconsistentConstructor: 'none',
        reportOverlappingOverload: 'none',
        reportPossiblyUnboundVariable: 'none',
        reportMissingSuperCall: 'none',
        reportUninitializedInstanceVariable: 'none',
        reportInvalidStringEscapeSequence: 'none',
        reportUnknownParameterType: 'none',
        reportUnknownArgumentType: 'none',
        reportUnknownLambdaType: 'none',
        reportUnknownVariableType: 'none',
        reportUnknownMemberType: 'none',
        reportMissingParameterType: 'none',
        reportMissingTypeArgument: 'none',
        reportInvalidTypeVarUse: 'none',
        reportCallInDefaultInitializer: 'none',
        reportUnnecessaryIsInstance: 'none',
        reportUnnecessaryCast: 'none',
        reportUnnecessaryComparison: 'none',
        reportUnnecessaryContains: 'none',
        reportAssertAlwaysTrue: 'none',
        reportSelfClsParameterName: 'none',
        reportImplicitStringConcatenation: 'none',
        reportUnboundVariable: 'none',
        reportUnhashable: 'none',
        reportUndefinedVariable: 'warning',
        reportInvalidStubStatement: 'none',
        reportIncompleteStub: 'none',
        reportUnsupportedDunderAll: 'none',
        reportUnusedCallResult: 'none',
        reportUnusedCoroutine: 'none',
        reportUnusedExcept: 'none',
        reportUnusedExpression: 'none',
        reportUnnecessaryTypeIgnoreComment: 'none',
        reportMatchNotExhaustive: 'none',
        reportShadowedImports: 'none',
        reportImplicitOverride: 'none',
    };

    return diagSettings;
}

export function getBasicDiagnosticRuleSet(): DiagnosticRuleSet {
    const diagSettings: DiagnosticRuleSet = {
        printUnknownAsAny: false,
        omitTypeArgsIfUnknown: false,
        omitUnannotatedParamType: true,
        omitConditionalConstraint: false,
        pep604Printing: true,
        strictListInference: false,
        strictSetInference: false,
        strictDictionaryInference: false,
        analyzeUnannotatedFunctions: true,
        strictParameterNoneValue: true,
        enableExperimentalFeatures: false,
        enableTypeIgnoreComments: true,
        enableReachabilityAnalysis: true,
        deprecateTypingAliases: false,
        disableBytesTypePromotions: true,
        reportGeneralTypeIssues: 'error',
        reportPropertyTypeMismatch: 'none',
        reportFunctionMemberAccess: 'none',
        reportMissingImports: 'error',
        reportMissingModuleSource: 'warning',
        reportInvalidTypeForm: 'error',
        reportMissingTypeStubs: 'none',
        reportImportCycles: 'none',
        reportUnusedImport: 'none',
        reportUnusedClass: 'none',
        reportUnusedFunction: 'none',
        reportUnusedVariable: 'none',
        reportDuplicateImport: 'none',
        reportWildcardImportFromLibrary: 'warning',
        reportAbstractUsage: 'error',
        reportArgumentType: 'error',
        reportAssertTypeFailure: 'error',
        reportAssignmentType: 'error',
        reportAttributeAccessIssue: 'error',
        reportCallIssue: 'error',
        reportInconsistentOverload: 'error',
        reportIndexIssue: 'error',
        reportInvalidTypeArguments: 'error',
        reportNoOverloadImplementation: 'error',
        reportOperatorIssue: 'error',
        reportOptionalSubscript: 'error',
        reportOptionalMemberAccess: 'error',
        reportOptionalCall: 'error',
        reportOptionalIterable: 'error',
        reportOptionalContextManager: 'error',
        reportOptionalOperand: 'error',
        reportRedeclaration: 'error',
        reportReturnType: 'error',
        reportTypedDictNotRequiredAccess: 'error',
        reportUntypedFunctionDecorator: 'none',
        reportUntypedClassDecorator: 'none',
        reportUntypedBaseClass: 'none',
        reportUntypedNamedTuple: 'none',
        reportPrivateUsage: 'none',
        reportTypeCommentUsage: 'none',
        reportPrivateImportUsage: 'error',
        reportConstantRedefinition: 'none',
        reportDeprecated: 'none',
        reportIncompatibleMethodOverride: 'none',
        reportIncompatibleVariableOverride: 'none',
        reportInconsistentConstructor: 'none',
        reportOverlappingOverload: 'none',
        reportPossiblyUnboundVariable: 'none',
        reportMissingSuperCall: 'none',
        reportUninitializedInstanceVariable: 'none',
        reportInvalidStringEscapeSequence: 'warning',
        reportUnknownParameterType: 'none',
        reportUnknownArgumentType: 'none',
        reportUnknownLambdaType: 'none',
        reportUnknownVariableType: 'none',
        reportUnknownMemberType: 'none',
        reportMissingParameterType: 'none',
        reportMissingTypeArgument: 'none',
        reportInvalidTypeVarUse: 'warning',
        reportCallInDefaultInitializer: 'none',
        reportUnnecessaryIsInstance: 'none',
        reportUnnecessaryCast: 'none',
        reportUnnecessaryComparison: 'none',
        reportUnnecessaryContains: 'none',
        reportAssertAlwaysTrue: 'warning',
        reportSelfClsParameterName: 'warning',
        reportImplicitStringConcatenation: 'none',
        reportUnboundVariable: 'error',
        reportUnhashable: 'error',
        reportUndefinedVariable: 'error',
        reportInvalidStubStatement: 'none',
        reportIncompleteStub: 'none',
        reportUnsupportedDunderAll: 'warning',
        reportUnusedCallResult: 'none',
        reportUnusedCoroutine: 'error',
        reportUnusedExcept: 'error',
        reportUnusedExpression: 'warning',
        reportUnnecessaryTypeIgnoreComment: 'none',
        reportMatchNotExhaustive: 'none',
        reportShadowedImports: 'none',
        reportImplicitOverride: 'none',
    };

    return diagSettings;
}

export function getStandardDiagnosticRuleSet(): DiagnosticRuleSet {
    const diagSettings: DiagnosticRuleSet = {
        printUnknownAsAny: false,
        omitTypeArgsIfUnknown: false,
        omitUnannotatedParamType: true,
        omitConditionalConstraint: false,
        pep604Printing: true,
        strictListInference: false,
        strictSetInference: false,
        strictDictionaryInference: false,
        analyzeUnannotatedFunctions: true,
        strictParameterNoneValue: true,
        enableExperimentalFeatures: false,
        enableTypeIgnoreComments: true,
        enableReachabilityAnalysis: true,
        deprecateTypingAliases: false,
        disableBytesTypePromotions: true,
        reportGeneralTypeIssues: 'error',
        reportPropertyTypeMismatch: 'none',
        reportFunctionMemberAccess: 'error',
        reportMissingImports: 'error',
        reportMissingModuleSource: 'warning',
        reportInvalidTypeForm: 'error',
        reportMissingTypeStubs: 'none',
        reportImportCycles: 'none',
        reportUnusedImport: 'none',
        reportUnusedClass: 'none',
        reportUnusedFunction: 'none',
        reportUnusedVariable: 'none',
        reportDuplicateImport: 'none',
        reportWildcardImportFromLibrary: 'warning',
        reportAbstractUsage: 'error',
        reportArgumentType: 'error',
        reportAssertTypeFailure: 'error',
        reportAssignmentType: 'error',
        reportAttributeAccessIssue: 'error',
        reportCallIssue: 'error',
        reportInconsistentOverload: 'error',
        reportIndexIssue: 'error',
        reportInvalidTypeArguments: 'error',
        reportNoOverloadImplementation: 'error',
        reportOperatorIssue: 'error',
        reportOptionalSubscript: 'error',
        reportOptionalMemberAccess: 'error',
        reportOptionalCall: 'error',
        reportOptionalIterable: 'error',
        reportOptionalContextManager: 'error',
        reportOptionalOperand: 'error',
        reportRedeclaration: 'error',
        reportReturnType: 'error',
        reportTypedDictNotRequiredAccess: 'error',
        reportUntypedFunctionDecorator: 'none',
        reportUntypedClassDecorator: 'none',
        reportUntypedBaseClass: 'none',
        reportUntypedNamedTuple: 'none',
        reportPrivateUsage: 'none',
        reportTypeCommentUsage: 'none',
        reportPrivateImportUsage: 'error',
        reportConstantRedefinition: 'none',
        reportDeprecated: 'none',
        reportIncompatibleMethodOverride: 'error',
        reportIncompatibleVariableOverride: 'error',
        reportInconsistentConstructor: 'none',
        reportOverlappingOverload: 'error',
        reportPossiblyUnboundVariable: 'error',
        reportMissingSuperCall: 'none',
        reportUninitializedInstanceVariable: 'none',
        reportInvalidStringEscapeSequence: 'warning',
        reportUnknownParameterType: 'none',
        reportUnknownArgumentType: 'none',
        reportUnknownLambdaType: 'none',
        reportUnknownVariableType: 'none',
        reportUnknownMemberType: 'none',
        reportMissingParameterType: 'none',
        reportMissingTypeArgument: 'none',
        reportInvalidTypeVarUse: 'warning',
        reportCallInDefaultInitializer: 'none',
        reportUnnecessaryIsInstance: 'none',
        reportUnnecessaryCast: 'none',
        reportUnnecessaryComparison: 'none',
        reportUnnecessaryContains: 'none',
        reportAssertAlwaysTrue: 'warning',
        reportSelfClsParameterName: 'warning',
        reportImplicitStringConcatenation: 'none',
        reportUnboundVariable: 'error',
        reportUnhashable: 'error',
        reportUndefinedVariable: 'error',
        reportInvalidStubStatement: 'none',
        reportIncompleteStub: 'none',
        reportUnsupportedDunderAll: 'warning',
        reportUnusedCallResult: 'none',
        reportUnusedCoroutine: 'error',
        reportUnusedExcept: 'error',
        reportUnusedExpression: 'warning',
        reportUnnecessaryTypeIgnoreComment: 'none',
        reportMatchNotExhaustive: 'none',
        reportShadowedImports: 'none',
        reportImplicitOverride: 'none',
    };

    return diagSettings;
}

export function getStrictDiagnosticRuleSet(): DiagnosticRuleSet {
    const diagSettings: DiagnosticRuleSet = {
        printUnknownAsAny: false,
        omitTypeArgsIfUnknown: false,
        omitUnannotatedParamType: false,
        omitConditionalConstraint: false,
        pep604Printing: true,
        strictListInference: true,
        strictSetInference: true,
        strictDictionaryInference: true,
        analyzeUnannotatedFunctions: true,
        strictParameterNoneValue: true,
        enableExperimentalFeatures: false,
        enableTypeIgnoreComments: true, // Not overridden by strict mode
        enableReachabilityAnalysis: true, // Not overridden by strict mode
        deprecateTypingAliases: false,
        disableBytesTypePromotions: true,
        reportGeneralTypeIssues: 'error',
        reportPropertyTypeMismatch: 'none',
        reportFunctionMemberAccess: 'error',
        reportMissingImports: 'error',
        reportMissingModuleSource: 'warning', // Not overridden by strict mode
        reportInvalidTypeForm: 'error',
        reportMissingTypeStubs: 'error',
        reportImportCycles: 'none',
        reportUnusedImport: 'error',
        reportUnusedClass: 'error',
        reportUnusedFunction: 'error',
        reportUnusedVariable: 'error',
        reportDuplicateImport: 'error',
        reportWildcardImportFromLibrary: 'error',
        reportAbstractUsage: 'error',
        reportArgumentType: 'error',
        reportAssertTypeFailure: 'error',
        reportAssignmentType: 'error',
        reportAttributeAccessIssue: 'error',
        reportCallIssue: 'error',
        reportInconsistentOverload: 'error',
        reportIndexIssue: 'error',
        reportInvalidTypeArguments: 'error',
        reportNoOverloadImplementation: 'error',
        reportOperatorIssue: 'error',
        reportOptionalSubscript: 'error',
        reportOptionalMemberAccess: 'error',
        reportOptionalCall: 'error',
        reportOptionalIterable: 'error',
        reportOptionalContextManager: 'error',
        reportOptionalOperand: 'error',
        reportRedeclaration: 'error',
        reportReturnType: 'error',
        reportTypedDictNotRequiredAccess: 'error',
        reportUntypedFunctionDecorator: 'error',
        reportUntypedClassDecorator: 'error',
        reportUntypedBaseClass: 'error',
        reportUntypedNamedTuple: 'error',
        reportPrivateUsage: 'error',
        reportTypeCommentUsage: 'error',
        reportPrivateImportUsage: 'error',
        reportConstantRedefinition: 'error',
        reportDeprecated: 'error',
        reportIncompatibleMethodOverride: 'error',
        reportIncompatibleVariableOverride: 'error',
        reportInconsistentConstructor: 'error',
        reportOverlappingOverload: 'error',
        reportPossiblyUnboundVariable: 'error',
        reportMissingSuperCall: 'none',
        reportUninitializedInstanceVariable: 'none',
        reportInvalidStringEscapeSequence: 'error',
        reportUnknownParameterType: 'error',
        reportUnknownArgumentType: 'error',
        reportUnknownLambdaType: 'error',
        reportUnknownVariableType: 'error',
        reportUnknownMemberType: 'error',
        reportMissingParameterType: 'error',
        reportMissingTypeArgument: 'error',
        reportInvalidTypeVarUse: 'error',
        reportCallInDefaultInitializer: 'none',
        reportUnnecessaryIsInstance: 'error',
        reportUnnecessaryCast: 'error',
        reportUnnecessaryComparison: 'error',
        reportUnnecessaryContains: 'error',
        reportAssertAlwaysTrue: 'error',
        reportSelfClsParameterName: 'error',
        reportImplicitStringConcatenation: 'none',
        reportUnboundVariable: 'error',
        reportUnhashable: 'error',
        reportUndefinedVariable: 'error',
        reportInvalidStubStatement: 'error',
        reportIncompleteStub: 'error',
        reportUnsupportedDunderAll: 'error',
        reportUnusedCallResult: 'none',
        reportUnusedCoroutine: 'error',
        reportUnusedExcept: 'error',
        reportUnusedExpression: 'error',
        reportUnnecessaryTypeIgnoreComment: 'none',
        reportMatchNotExhaustive: 'error',
        reportShadowedImports: 'none',
        reportImplicitOverride: 'none',
    };

    return diagSettings;
}

export function matchFileSpecs(configOptions: ConfigOptions, uri: Uri, isFile = true) {
    for (const includeSpec of configOptions.include) {
        if (FileSpec.matchIncludeFileSpec(includeSpec.regExp, configOptions.exclude, uri, isFile)) {
            return true;
        }
    }

    return false;
}

// Internal configuration options. These are derived from a combination
// of the command line and from a JSON-based config file.
export class ConfigOptions {
    // Absolute directory of project. All relative paths in the config
    // are based on this path.
    projectRoot: Uri;

    // Path to python interpreter.
    pythonPath?: Uri | undefined;

    // Name of the python environment.
    pythonEnvironmentName?: string | undefined;

    // Path to use for typeshed definitions.
    typeshedPath?: Uri | undefined;

    // Path to custom typings (stub) modules.
    stubPath?: Uri | undefined;

    // A list of file specs to include in the analysis. Can contain
    // directories, in which case all "*.py" files within those directories
    // are included.
    include: FileSpec[] = [];

    // A list of file specs to exclude from the analysis (overriding include
    // if necessary). Can contain directories, in which case all "*.py" files
    // within those directories are included.
    exclude: FileSpec[] = [];

    // Automatically detect virtual environment folders and exclude them.
    // This property is for internal use and not exposed externally
    // as a config setting.
    // It is used to store whether the user has specified directories in
    // the exclude setting, which is later modified to include a default set.
    // This setting is true when user has not specified any exclude.
    autoExcludeVenv?: boolean | undefined;

    // A list of file specs whose errors and warnings should be ignored even
    // if they are included in the transitive closure of included files.
    ignore: FileSpec[] = [];

    // A list of file specs that should be analyzed using "strict" mode.
    strict: FileSpec[] = [];

    // A set of defined constants that are used by the binder to determine
    // whether runtime conditions should evaluate to True or False.
    defineConstant = new Map<string, boolean | string>();

    // Emit verbose information to console?
    verboseOutput?: boolean | undefined;

    // Perform type checking and report diagnostics only for open files?
    checkOnlyOpenFiles?: boolean | undefined;

    // In the absence of type stubs, use library implementations to extract
    // type information?
    useLibraryCodeForTypes?: boolean | undefined;

    // Offer auto-import completions.
    autoImportCompletions = true;

    // Use indexing.
    indexing = false;

    // Use type evaluator call tracking
    logTypeEvaluationTime = false;

    // Minimum threshold for type eval logging
    typeEvaluationTimeThreshold = 50;

    // Was this config initialized from JSON (pyrightconfig/pyproject)?
    initializedFromJson = false;

    // Filter out any hint diagnostics with tags?
    disableTaggedHints = false;

    //---------------------------------------------------------------
    // Diagnostics Rule Set

    diagnosticRuleSet: DiagnosticRuleSet;

    //---------------------------------------------------------------
    // TaskList tokens used by diagnostics

    taskListTokens?: TaskListToken[] | undefined;

    //---------------------------------------------------------------
    // Parsing and Import Resolution Settings

    // Parameters that specify the execution environment for
    // the files being analyzed.
    executionEnvironments: ExecutionEnvironment[] = [];

    // Path to a directory containing one or more virtual environment
    // directories. This is used in conjunction with the "venv" name in
    // the config file to identify the python environment used for resolving
    // third-party modules.
    venvPath?: Uri | undefined;

    // Default venv environment.
    venv?: string | undefined;

    // Default pythonVersion. Can be overridden by executionEnvironment.
    defaultPythonVersion?: PythonVersion | undefined;

    // Default pythonPlatform. Can be overridden by executionEnvironment.
    defaultPythonPlatform?: string | undefined;

    // Default extraPaths. Can be overridden by executionEnvironment.
    defaultExtraPaths?: Uri[] | undefined;

    // Should native library import resolutions be skipped?
    skipNativeLibraries?: boolean;

    //---------------------------------------------------------------
    // Internal-only switches

    // Run additional analysis as part of test cases?
    internalTestMode?: boolean | undefined;

    // Run program in index generation mode.
    indexGenerationMode?: boolean | undefined;

    // When a symbol cannot be resolved from an import, should it be
    // treated as Any rather than Unknown?
    evaluateUnknownImportsAsAny?: boolean;

    // Controls how hover and completion function signatures are displayed.
    functionSignatureDisplay: SignatureDisplayType;

    // Determines if has a config file (pyrightconfig.json or pyproject.toml) or not.
    configFileSource?: Uri | undefined;

    // Determines the effective default type checking mode.
    effectiveTypeCheckingMode: 'strict' | 'basic' | 'off' | 'standard' = 'standard';

    constructor(projectRoot: Uri) {
        this.projectRoot = projectRoot;
        this.diagnosticRuleSet = ConfigOptions.getDiagnosticRuleSet();
        this.functionSignatureDisplay = SignatureDisplayType.formatted;
    }

    static getDiagnosticRuleSet(typeCheckingMode?: string): DiagnosticRuleSet {
        if (typeCheckingMode === 'strict') {
            return getStrictDiagnosticRuleSet();
        }

        if (typeCheckingMode === 'basic') {
            return getBasicDiagnosticRuleSet();
        }

        if (typeCheckingMode === 'off') {
            return getOffDiagnosticRuleSet();
        }

        return getStandardDiagnosticRuleSet();
    }

    getDefaultExecEnvironment(): ExecutionEnvironment {
        return new ExecutionEnvironment(
            this._getEnvironmentName(),
            this.projectRoot,
            this.diagnosticRuleSet,
            this.defaultPythonVersion,
            this.defaultPythonPlatform,
            this.defaultExtraPaths,
            this.skipNativeLibraries
        );
    }

    // Finds the best execution environment for a given file uri. The
    // specified file path should be absolute.
    // If no matching execution environment can be found, a default
    // execution environment is used.
    findExecEnvironment(file: Uri): ExecutionEnvironment {
        return (
            this.executionEnvironments.find((env) => {
                const envRoot = Uri.is(env.root) ? env.root : this.projectRoot.resolvePaths(env.root || '');
                return file.startsWith(envRoot);
            }) ?? this.getDefaultExecEnvironment()
        );
    }

    getExecutionEnvironments(): ExecutionEnvironment[] {
        if (this.executionEnvironments.length > 0) {
            return this.executionEnvironments;
        }

        return [this.getDefaultExecEnvironment()];
    }

    initializeTypeCheckingMode(
        typeCheckingMode: string | undefined,
        severityOverrides?: DiagnosticSeverityOverridesMap
    ) {
        this.diagnosticRuleSet = ConfigOptions.getDiagnosticRuleSet(typeCheckingMode);
        this.effectiveTypeCheckingMode = typeCheckingMode as 'strict' | 'basic' | 'off' | 'standard';

        if (severityOverrides) {
            this.applyDiagnosticOverrides(severityOverrides);
        }
    }

    // Initialize the structure from a JSON object.
    initializeFromJson(configObj: any, configDirUri: Uri, serviceProvider: ServiceProvider, host: Host) {
        this.initializedFromJson = true;
        const console = serviceProvider.tryGet(ServiceKeys.console) ?? new NullConsole();

        // Read the "include" entry.
        if (configObj.include !== undefined) {
            if (!Array.isArray(configObj.include)) {
                console.error(`Config "include" entry must contain an array.`);
            } else {
                this.include = [];
                const filesList = configObj.include as string[];
                filesList.forEach((fileSpec, index) => {
                    if (typeof fileSpec !== 'string') {
                        console.error(`Index ${index} of "include" array should be a string.`);
                    } else if (isAbsolute(fileSpec)) {
                        console.error(`Ignoring path "${fileSpec}" in "include" array because it is not relative.`);
                    } else {
                        this.include.push(getFileSpec(configDirUri, fileSpec));
                    }
                });
            }
        }

        // Read the "exclude" entry.
        if (configObj.exclude !== undefined) {
            if (!Array.isArray(configObj.exclude)) {
                console.error(`Config "exclude" entry must contain an array.`);
            } else {
                this.exclude = [];
                const filesList = configObj.exclude as string[];
                filesList.forEach((fileSpec, index) => {
                    if (typeof fileSpec !== 'string') {
                        console.error(`Index ${index} of "exclude" array should be a string.`);
                    } else if (isAbsolute(fileSpec)) {
                        console.error(`Ignoring path "${fileSpec}" in "exclude" array because it is not relative.`);
                    } else {
                        this.exclude.push(getFileSpec(configDirUri, fileSpec));
                    }
                });
            }
        }

        // Read the "ignore" entry.
        if (configObj.ignore !== undefined) {
            if (!Array.isArray(configObj.ignore)) {
                console.error(`Config "ignore" entry must contain an array.`);
            } else {
                this.ignore = [];
                const filesList = configObj.ignore as string[];
                filesList.forEach((fileSpec, index) => {
                    if (typeof fileSpec !== 'string') {
                        console.error(`Index ${index} of "ignore" array should be a string.`);
                    } else {
                        // We'll allow absolute paths in the ignore list. While it
                        // is not recommended to use absolute paths anywhere in
                        // the config file, there are a few legit use cases for ignore
                        // paths when the conf file is used with a language server.
                        this.ignore.push(getFileSpec(configDirUri, fileSpec));
                    }
                });
            }
        }

        // Read the "strict" entry.
        if (configObj.strict !== undefined) {
            if (!Array.isArray(configObj.strict)) {
                console.error(`Config "strict" entry must contain an array.`);
            } else {
                this.strict = [];
                const filesList = configObj.strict as string[];
                filesList.forEach((fileSpec, index) => {
                    if (typeof fileSpec !== 'string') {
                        console.error(`Index ${index} of "strict" array should be a string.`);
                    } else if (isAbsolute(fileSpec)) {
                        console.error(`Ignoring path "${fileSpec}" in "strict" array because it is not relative.`);
                    } else {
                        this.strict.push(getFileSpec(configDirUri, fileSpec));
                    }
                });
            }
        }

        // If there is a "typeCheckingMode", it can override the provided setting.
        if (configObj.typeCheckingMode !== undefined) {
            if (
                configObj.typeCheckingMode === 'off' ||
                configObj.typeCheckingMode === 'basic' ||
                configObj.typeCheckingMode === 'standard' ||
                configObj.typeCheckingMode === 'strict'
            ) {
                this.initializeTypeCheckingMode(configObj.typeCheckingMode);
            } else {
                console.error(`Config "typeCheckingMode" entry must contain "off", "basic", "standard", or "strict".`);
            }
        }

        if (configObj.useLibraryCodeForTypes !== undefined) {
            if (typeof configObj.useLibraryCodeForTypes === 'boolean') {
                this.useLibraryCodeForTypes = configObj.useLibraryCodeForTypes;
            } else {
                console.error(`Config "useLibraryCodeForTypes" entry must be true or false.`);
            }
        }

        // Apply overrides from the config file for the boolean rules.
        const configRuleSet = { ...this.diagnosticRuleSet };
        getBooleanDiagnosticRules(/* includeNonOverridable */ true).forEach((ruleName) => {
            (configRuleSet as any)[ruleName] = this._convertBoolean(
                configObj[ruleName],
                ruleName,
                configRuleSet[ruleName] as boolean
            );
        });

        // Apply overrides from the config file for the diagnostic level rules.
        getDiagLevelDiagnosticRules().forEach((ruleName) => {
            (configRuleSet as any)[ruleName] = this._convertDiagnosticLevel(
                configObj[ruleName],
                ruleName,
                configRuleSet[ruleName] as DiagnosticLevel
            );
        });
        this.diagnosticRuleSet = { ...configRuleSet };

        // Read the "venvPath".
        if (configObj.venvPath !== undefined) {
            if (typeof configObj.venvPath !== 'string') {
                console.error(`Config "venvPath" field must contain a string.`);
            } else {
                this.venvPath = configDirUri.resolvePaths(configObj.venvPath);
            }
        }

        // Read the "venv" name.
        if (configObj.venv !== undefined) {
            if (typeof configObj.venv !== 'string') {
                console.error(`Config "venv" field must contain a string.`);
            } else {
                this.venv = configObj.venv;
            }
        }

        // Read the config "extraPaths".
        const configExtraPaths: Uri[] = [];
        if (configObj.extraPaths !== undefined) {
            if (!Array.isArray(configObj.extraPaths)) {
                console.error(`Config "extraPaths" field must contain an array.`);
            } else {
                const pathList = configObj.extraPaths as string[];
                pathList.forEach((path, pathIndex) => {
                    if (typeof path !== 'string') {
                        console.error(`Config "extraPaths" field ${pathIndex} must be a string.`);
                    } else {
                        configExtraPaths!.push(configDirUri.resolvePaths(path));
                    }
                });
                this.defaultExtraPaths = [...configExtraPaths];
            }
        }

        // Read the default "pythonVersion".
        if (configObj.pythonVersion !== undefined) {
            if (typeof configObj.pythonVersion === 'string') {
                const version = PythonVersion.fromString(configObj.pythonVersion);
                if (version) {
                    this.defaultPythonVersion = version;
                } else {
                    console.error(`Config "pythonVersion" field contains unsupported version.`);
                }
            } else {
                console.error(`Config "pythonVersion" field must contain a string.`);
            }
        }

        // Read the default "pythonPlatform".
        if (configObj.pythonPlatform !== undefined) {
            if (typeof configObj.pythonPlatform !== 'string') {
                console.error(`Config "pythonPlatform" field must contain a string.`);
            } else {
                this.defaultPythonPlatform = configObj.pythonPlatform;
            }
        }

        // Read the skipNativeLibraries flag. This isn't officially documented
        // or supported. It was added specifically to improve initialization
        // performance for playgrounds or web-based environments where native
        // libraries will not be present.
        if (configObj.skipNativeLibraries) {
            if (typeof configObj.skipNativeLibraries === 'boolean') {
                this.skipNativeLibraries = configObj.skipNativeLibraries;
            } else {
                console.error(`Config "skipNativeLibraries" field must contain a boolean.`);
            }
        }

        // Read the "typeshedPath" setting.
        if (configObj.typeshedPath !== undefined) {
            if (typeof configObj.typeshedPath !== 'string') {
                console.error(`Config "typeshedPath" field must contain a string.`);
            } else {
                this.typeshedPath = configObj.typeshedPath
                    ? configDirUri.resolvePaths(configObj.typeshedPath)
                    : undefined;
            }
        }

        // Read the "stubPath" setting.

        // Keep this for backward compatibility
        if (configObj.typingsPath !== undefined) {
            if (typeof configObj.typingsPath !== 'string') {
                console.error(`Config "typingsPath" field must contain a string.`);
            } else {
                console.error(`Config "typingsPath" is now deprecated. Please, use stubPath instead.`);
                this.stubPath = configDirUri.resolvePaths(configObj.typingsPath);
            }
        }

        if (configObj.stubPath !== undefined) {
            if (typeof configObj.stubPath !== 'string') {
                console.error(`Config "stubPath" field must contain a string.`);
            } else {
                this.stubPath = configDirUri.resolvePaths(configObj.stubPath);
            }
        }

        // Read the "verboseOutput" setting.
        // Don't initialize to a default value because we want the command-line "verbose"
        // switch to apply if this setting isn't specified in the config file.
        if (configObj.verboseOutput !== undefined) {
            if (typeof configObj.verboseOutput !== 'boolean') {
                console.error(`Config "verboseOutput" field must be true or false.`);
            } else {
                this.verboseOutput = configObj.verboseOutput;
            }
        }

        // Read the "defineConstant" setting.
        if (configObj.defineConstant !== undefined) {
            if (typeof configObj.defineConstant !== 'object' || Array.isArray(configObj.defineConstant)) {
                console.error(`Config "defineConstant" field must contain a map indexed by constant names.`);
            } else {
                const keys = Object.getOwnPropertyNames(configObj.defineConstant);
                keys.forEach((key) => {
                    const value = configObj.defineConstant[key];
                    const valueType = typeof value;
                    if (valueType !== 'boolean' && valueType !== 'string') {
                        console.error(`Defined constant "${key}" must be associated with a boolean or string value.`);
                    } else {
                        this.defineConstant.set(key, value);
                    }
                });
            }
        }

        // Read the "useLibraryCodeForTypes" setting.
        if (configObj.useLibraryCodeForTypes !== undefined) {
            if (typeof configObj.useLibraryCodeForTypes !== 'boolean') {
                console.error(`Config "useLibraryCodeForTypes" field must be true or false.`);
            } else {
                this.useLibraryCodeForTypes = configObj.useLibraryCodeForTypes;
            }
        }

        // Read the "autoImportCompletions" setting.
        if (configObj.autoImportCompletions !== undefined) {
            if (typeof configObj.autoImportCompletions !== 'boolean') {
                console.error(`Config "autoImportCompletions" field must be true or false.`);
            } else {
                this.autoImportCompletions = configObj.autoImportCompletions;
            }
        }

        // Read the "indexing" setting.
        if (configObj.indexing !== undefined) {
            if (typeof configObj.indexing !== 'boolean') {
                console.error(`Config "indexing" field must be true or false.`);
            } else {
                this.indexing = configObj.indexing;
            }
        }

        // Read the "logTypeEvaluationTime" setting.
        if (configObj.logTypeEvaluationTime !== undefined) {
            if (typeof configObj.logTypeEvaluationTime !== 'boolean') {
                console.error(`Config "logTypeEvaluationTime" field must be true or false.`);
            } else {
                this.logTypeEvaluationTime = configObj.logTypeEvaluationTime;
            }
        }

        // Read the "typeEvaluationTimeThreshold" setting.
        if (configObj.typeEvaluationTimeThreshold !== undefined) {
            if (typeof configObj.typeEvaluationTimeThreshold !== 'number') {
                console.error(`Config "typeEvaluationTimeThreshold" field must be a number.`);
            } else {
                this.typeEvaluationTimeThreshold = configObj.typeEvaluationTimeThreshold;
            }
        }

        // Read the "functionSignatureDisplay" setting.
        if (configObj.functionSignatureDisplay !== undefined) {
            if (typeof configObj.functionSignatureDisplay !== 'string') {
                console.error(`Config "functionSignatureDisplay" field must be true or false.`);
            } else {
                if (
                    configObj.functionSignatureDisplay === 'compact' ||
                    configObj.functionSignatureDisplay === 'formatted'
                ) {
                    this.functionSignatureDisplay = configObj.functionSignatureDisplay as SignatureDisplayType;
                }
            }
        }
    }

    static resolveExtends(configObj: any, configDirUri: Uri): Uri | undefined {
        if (configObj.extends !== undefined) {
            if (typeof configObj.extends !== 'string') {
                console.error(`Config "extends" field must contain a string.`);
            } else {
                return configDirUri.resolvePaths(configObj.extends);
            }
        }

        return undefined;
    }

    ensureDefaultPythonPlatform(host: Host, console: ConsoleInterface) {
        // If no default python platform was specified, assume that the
        // user wants to use the current platform.
        if (this.defaultPythonPlatform !== undefined) {
            return;
        }

        this.defaultPythonPlatform = host.getPythonPlatform();
        if (this.defaultPythonPlatform !== undefined) {
            console.log(`Assuming Python platform ${this.defaultPythonPlatform}`);
        }
    }

    ensureDefaultPythonVersion(host: Host, console: ConsoleInterface) {
        // If no default python version was specified, retrieve the version
        // from the currently-selected python interpreter.
        if (this.defaultPythonVersion !== undefined) {
            return;
        }

        const importFailureInfo: string[] = [];
        this.defaultPythonVersion = host.getPythonVersion(this.pythonPath, importFailureInfo);
        if (this.defaultPythonVersion !== undefined) {
            console.info(`Assuming Python version ${PythonVersion.toString(this.defaultPythonVersion)}`);
        }

        for (const log of importFailureInfo) {
            console.info(log);
        }
    }

    ensureDefaultExtraPaths(fs: FileSystem, autoSearchPaths: boolean, extraPaths: string[] | undefined) {
        const paths: Uri[] = [];

        if (autoSearchPaths) {
            // Auto-detect the common scenario where the sources are under the src folder
            const srcPath = this.projectRoot.resolvePaths(pathConsts.src);
            if (fs.existsSync(srcPath) && !fs.existsSync(srcPath.resolvePaths('__init__.py'))) {
                paths.push(fs.realCasePath(srcPath));
            }
        }

        if (extraPaths && extraPaths.length > 0) {
            for (const p of extraPaths) {
                const path = this.projectRoot.resolvePaths(p);
                paths.push(fs.realCasePath(path));
                if (isDirectory(fs, path)) {
                    appendArray(paths, getPathsFromPthFiles(fs, path));
                }
            }
        }

        if (paths.length > 0) {
            this.defaultExtraPaths = paths;
        }
    }

    applyDiagnosticOverrides(
        diagnosticOverrides: DiagnosticSeverityOverridesMap | DiagnosticBooleanOverridesMap | undefined
    ) {
        if (!diagnosticOverrides) {
            return;
        }

        for (const ruleName of getDiagLevelDiagnosticRules()) {
            const severity = diagnosticOverrides[ruleName];
            if (severity !== undefined && !isBoolean(severity) && getDiagnosticSeverityOverrides().includes(severity)) {
                (this.diagnosticRuleSet as any)[ruleName] = severity;
            }
        }

        for (const ruleName of getBooleanDiagnosticRules(/* includeNonOverridable */ true)) {
            const value = diagnosticOverrides[ruleName];
            if (value !== undefined && isBoolean(value)) {
                (this.diagnosticRuleSet as any)[ruleName] = value;
            }
        }
    }

    setupExecutionEnvironments(configObj: any, configDirUri: Uri, console: ConsoleInterface) {
        // Read the "executionEnvironments" array. This should be done at the end
        // after we've established default values.
        if (configObj.executionEnvironments !== undefined) {
            if (!Array.isArray(configObj.executionEnvironments)) {
                console.error(`Config "executionEnvironments" field must contain an array.`);
            } else {
                this.executionEnvironments = [];

                const execEnvironments = configObj.executionEnvironments as ExecutionEnvironment[];

                execEnvironments.forEach((env, index) => {
                    const execEnv = this._initExecutionEnvironmentFromJson(
                        env,
                        configDirUri,
                        index,
                        console,
                        this.diagnosticRuleSet,
                        this.defaultPythonVersion,
                        this.defaultPythonPlatform,
                        this.defaultExtraPaths || []
                    );

                    if (execEnv) {
                        this.executionEnvironments.push(execEnv);
                    }
                });
            }
        }
    }

    private _getEnvironmentName(): string {
        return this.pythonEnvironmentName || this.pythonPath?.toString() || 'python';
    }

    private _convertBoolean(value: any, fieldName: string, defaultValue: boolean): boolean {
        if (value === undefined) {
            return defaultValue;
        } else if (typeof value === 'boolean') {
            return value ? true : false;
        }

        console.log(`Config "${fieldName}" entry must be true or false.`);
        return defaultValue;
    }

    private _convertDiagnosticLevel(value: any, fieldName: string, defaultValue: DiagnosticLevel): DiagnosticLevel {
        if (value === undefined) {
            return defaultValue;
        } else if (typeof value === 'boolean') {
            return value ? 'error' : 'none';
        } else if (typeof value === 'string') {
            if (value === 'error' || value === 'warning' || value === 'information' || value === 'none') {
                return value;
            }
        }

        console.log(`Config "${fieldName}" entry must be true, false, "error", "warning", "information" or "none".`);
        return defaultValue;
    }

    private _initExecutionEnvironmentFromJson(
        envObj: any,
        configDirUri: Uri,
        index: number,
        console: ConsoleInterface,
        configDiagnosticRuleSet: DiagnosticRuleSet,
        configPythonVersion: PythonVersion | undefined,
        configPythonPlatform: string | undefined,
        configExtraPaths: Uri[]
    ): ExecutionEnvironment | undefined {
        try {
            const newExecEnv = new ExecutionEnvironment(
                this._getEnvironmentName(),
                configDirUri,
                configDiagnosticRuleSet,
                configPythonVersion,
                configPythonPlatform,
                configExtraPaths
            );

            // Validate the root.
            if (envObj.root && typeof envObj.root === 'string') {
                newExecEnv.root = configDirUri.resolvePaths(envObj.root);
            } else {
                console.error(`Config executionEnvironments index ${index}: missing root value.`);
            }

            // Validate the extraPaths.
            if (envObj.extraPaths) {
                if (!Array.isArray(envObj.extraPaths)) {
                    console.error(
                        `Config executionEnvironments index ${index}: extraPaths field must contain an array.`
                    );
                } else {
                    // If specified, this overrides the default extra paths inherited
                    // from the top-level config.
                    newExecEnv.extraPaths = [];

                    const pathList = envObj.extraPaths as string[];
                    pathList.forEach((path, pathIndex) => {
                        if (typeof path !== 'string') {
                            console.error(
                                `Config executionEnvironments index ${index}:` +
                                    ` extraPaths field ${pathIndex} must be a string.`
                            );
                        } else {
                            newExecEnv.extraPaths.push(configDirUri.resolvePaths(path));
                        }
                    });
                }
            }

            // Validate the pythonVersion.
            if (envObj.pythonVersion) {
                if (typeof envObj.pythonVersion === 'string') {
                    const version = PythonVersion.fromString(envObj.pythonVersion);
                    if (version) {
                        newExecEnv.pythonVersion = version;
                    } else {
                        console.warn(`Config executionEnvironments index ${index} contains unsupported pythonVersion.`);
                    }
                } else {
                    console.error(`Config executionEnvironments index ${index} pythonVersion must be a string.`);
                }
            }

            // Validate the pythonPlatform.
            if (envObj.pythonPlatform) {
                if (typeof envObj.pythonPlatform === 'string') {
                    newExecEnv.pythonPlatform = envObj.pythonPlatform;
                } else {
                    console.error(`Config executionEnvironments index ${index} pythonPlatform must be a string.`);
                }
            }

            // Validate the name.
            if (envObj.name) {
                if (typeof envObj.name === 'string') {
                    newExecEnv.name = envObj.name;
                } else {
                    console.error(`Config executionEnvironments index ${index} name must be a string.`);
                }
            }

            // Apply overrides from the config file for the boolean overrides.
            getBooleanDiagnosticRules(/* includeNonOverridable */ true).forEach((ruleName) => {
                (newExecEnv.diagnosticRuleSet as any)[ruleName] = this._convertBoolean(
                    envObj[ruleName],
                    ruleName,
                    newExecEnv.diagnosticRuleSet[ruleName] as boolean
                );
            });

            // Apply overrides from the config file for the diagnostic level overrides.
            getDiagLevelDiagnosticRules().forEach((ruleName) => {
                (newExecEnv.diagnosticRuleSet as any)[ruleName] = this._convertDiagnosticLevel(
                    envObj[ruleName],
                    ruleName,
                    newExecEnv.diagnosticRuleSet[ruleName] as DiagnosticLevel
                );
            });

            return newExecEnv;
        } catch {
            console.error(`Config executionEnvironments index ${index} is not accessible.`);
        }

        return undefined;
    }
}

export function parseDiagLevel(value: string | boolean): DiagnosticSeverityOverrides | undefined {
    switch (value) {
        case false:
        case 'none':
            return DiagnosticSeverityOverrides.None;

        case true:
        case 'error':
            return DiagnosticSeverityOverrides.Error;

        case 'warning':
            return DiagnosticSeverityOverrides.Warning;

        case 'information':
            return DiagnosticSeverityOverrides.Information;

        default:
            return undefined;
    }
}
