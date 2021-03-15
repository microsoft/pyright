/*
 * configOptions.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Class that holds the configuration options for the analyzer.
 */

import * as child_process from 'child_process';
import { isAbsolute } from 'path';

import * as pathConsts from '../common/pathConsts';
import { DiagnosticSeverityOverridesMap } from './commandLineOptions';
import { ConsoleInterface } from './console';
import { DiagnosticRule } from './diagnosticRules';
import { FileSystem } from './fileSystem';
import {
    combinePaths,
    ensureTrailingDirectorySeparator,
    FileSpec,
    getFileSpec,
    normalizePath,
    resolvePaths,
} from './pathUtils';
import {
    latestStablePythonVersion,
    PythonVersion,
    versionFromMajorMinor,
    versionFromString,
    versionToString,
} from './pythonVersion';

export enum PythonPlatform {
    Darwin = 'Darwin',
    Windows = 'Windows',
    Linux = 'Linux',
}

export class ExecutionEnvironment {
    // Default to "." which indicates every file in the project.
    constructor(
        root: string,
        defaultPythonVersion: PythonVersion | undefined,
        defaultPythonPlatform: string | undefined,
        defaultExtraPaths: string[] | undefined
    ) {
        this.root = root;
        this.pythonVersion = defaultPythonVersion || latestStablePythonVersion;
        this.pythonPlatform = defaultPythonPlatform;
        this.extraPaths = defaultExtraPaths || [];
    }

    // Root directory for execution - absolute or relative to the
    // project root.
    root: string;

    // Always default to the latest stable version of the language.
    pythonVersion: PythonVersion;

    // Default to no platform.
    pythonPlatform?: string;

    // Default to no extra paths.
    extraPaths: string[] = [];
}

export type DiagnosticLevel = 'none' | 'information' | 'warning' | 'error';

export interface DiagnosticRuleSet {
    // Should "Unknown" types be reported as "Any"?
    printUnknownAsAny: boolean;

    // Should type arguments to a generic class be omitted
    // when printed if all arguments are Unknown or Any?
    omitTypeArgsIfAny: boolean;

    // Should parameter type be omitted if it is not annotated?
    omitUnannotatedParamType: boolean;

    // Should Union and Optional types be printed in PEP 604 format?
    pep604Printing: boolean;

    // Use strict inference rules for list expressions?
    strictListInference: boolean;

    // Use strict inference rules for dictionary expressions?
    strictDictionaryInference: boolean;

    // Use strict type rules for parameters assigned default of None?
    strictParameterNoneValue: boolean;

    // Enable support for type: ignore comments?
    enableTypeIgnoreComments: boolean;

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

    // Report attempts to use an Optional type in a binary or unary operation.
    reportOptionalOperand: DiagnosticLevel;

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

    // Report attempts to redefine variables that are in all-caps.
    reportConstantRedefinition: DiagnosticLevel;

    // Report usage of method override that is incompatible with
    // the base class method of the same name?
    reportIncompatibleMethodOverride: DiagnosticLevel;

    // Report usage of variable override that is incompatible with
    // the base class symbol of the same name?
    reportIncompatibleVariableOverride: DiagnosticLevel;

    // Report function overloads that overlap in signature but have
    // incompatible return types.
    reportOverlappingOverload: DiagnosticLevel;

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

    // Report usage of generic class without explicit type arguments?
    reportMissingTypeArgument: DiagnosticLevel;

    // Report improper usage of type variables within function signatures?
    reportInvalidTypeVarUse: DiagnosticLevel;

    // Report usage of function call within default value
    // initialization expression?
    reportCallInDefaultInitializer: DiagnosticLevel;

    // Report calls to isinstance or issubclass that are statically determined
    // to always be true or false.
    reportUnnecessaryIsInstance: DiagnosticLevel;

    // Report calls to cast that are statically determined
    // to always unnecessary.
    reportUnnecessaryCast: DiagnosticLevel;

    // Report assert expressions that will always evaluate to true.
    reportAssertAlwaysTrue: DiagnosticLevel;

    // Report when "self" or "cls" parameter is missing or is misnamed.
    reportSelfClsParameterName: DiagnosticLevel;

    // Report implicit concatenation of string literals.
    reportImplicitStringConcatenation: DiagnosticLevel;

    // Report usage of undefined variables.
    reportUndefinedVariable: DiagnosticLevel;

    // Report usage of unbound or possibly unbound variables.
    reportUnboundVariable: DiagnosticLevel;

    // Report statements that are syntactically correct but
    // have no semantic meaning within a type stub file.
    reportInvalidStubStatement: DiagnosticLevel;

    // Report operations on __all__ symbol that are not supported
    // by a static type checker.
    reportUnsupportedDunderAll: DiagnosticLevel;

    // Report cases where a call expression's return result is not
    // None and is not used in any way.
    reportUnusedCallResult: DiagnosticLevel;

    // Report cases where a call expression's return result is Coroutine
    // and is not used in any way.
    reportUnusedCoroutine: DiagnosticLevel;
}

export function cloneDiagnosticRuleSet(diagSettings: DiagnosticRuleSet): DiagnosticRuleSet {
    // Create a shallow copy of the existing object.
    return Object.assign({}, diagSettings);
}

export function getBooleanDiagnosticRules() {
    return [
        DiagnosticRule.strictListInference,
        DiagnosticRule.strictDictionaryInference,
        DiagnosticRule.strictParameterNoneValue,

        // Do not include this this one because we don't
        // want to override it in strict mode or support
        // it within pyright comments.
        // DiagnosticRule.enableTypeIgnoreComments
    ];
}

export function getDiagLevelDiagnosticRules() {
    return [
        DiagnosticRule.reportGeneralTypeIssues,
        DiagnosticRule.reportPropertyTypeMismatch,
        DiagnosticRule.reportFunctionMemberAccess,
        DiagnosticRule.reportMissingImports,
        DiagnosticRule.reportMissingModuleSource,
        DiagnosticRule.reportMissingTypeStubs,
        DiagnosticRule.reportImportCycles,
        DiagnosticRule.reportUnusedImport,
        DiagnosticRule.reportUnusedClass,
        DiagnosticRule.reportUnusedFunction,
        DiagnosticRule.reportUnusedVariable,
        DiagnosticRule.reportDuplicateImport,
        DiagnosticRule.reportWildcardImportFromLibrary,
        DiagnosticRule.reportOptionalSubscript,
        DiagnosticRule.reportOptionalMemberAccess,
        DiagnosticRule.reportOptionalCall,
        DiagnosticRule.reportOptionalIterable,
        DiagnosticRule.reportOptionalContextManager,
        DiagnosticRule.reportOptionalOperand,
        DiagnosticRule.reportUntypedFunctionDecorator,
        DiagnosticRule.reportUntypedClassDecorator,
        DiagnosticRule.reportUntypedBaseClass,
        DiagnosticRule.reportUntypedNamedTuple,
        DiagnosticRule.reportPrivateUsage,
        DiagnosticRule.reportConstantRedefinition,
        DiagnosticRule.reportIncompatibleMethodOverride,
        DiagnosticRule.reportIncompatibleVariableOverride,
        DiagnosticRule.reportOverlappingOverload,
        DiagnosticRule.reportInvalidStringEscapeSequence,
        DiagnosticRule.reportUnknownParameterType,
        DiagnosticRule.reportUnknownArgumentType,
        DiagnosticRule.reportUnknownLambdaType,
        DiagnosticRule.reportUnknownVariableType,
        DiagnosticRule.reportUnknownMemberType,
        DiagnosticRule.reportMissingTypeArgument,
        DiagnosticRule.reportInvalidTypeVarUse,
        DiagnosticRule.reportCallInDefaultInitializer,
        DiagnosticRule.reportUnnecessaryIsInstance,
        DiagnosticRule.reportUnnecessaryCast,
        DiagnosticRule.reportAssertAlwaysTrue,
        DiagnosticRule.reportSelfClsParameterName,
        DiagnosticRule.reportImplicitStringConcatenation,
        DiagnosticRule.reportUndefinedVariable,
        DiagnosticRule.reportUnboundVariable,
        DiagnosticRule.reportInvalidStubStatement,
        DiagnosticRule.reportUnsupportedDunderAll,
        DiagnosticRule.reportUnusedCallResult,
        DiagnosticRule.reportUnusedCoroutine,
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
        omitTypeArgsIfAny: true,
        omitUnannotatedParamType: true,
        pep604Printing: true,
        strictListInference: false,
        strictDictionaryInference: false,
        strictParameterNoneValue: false,
        enableTypeIgnoreComments: true,
        reportGeneralTypeIssues: 'none',
        reportPropertyTypeMismatch: 'none',
        reportFunctionMemberAccess: 'none',
        reportMissingImports: 'warning',
        reportMissingModuleSource: 'warning',
        reportMissingTypeStubs: 'none',
        reportImportCycles: 'none',
        reportUnusedImport: 'none',
        reportUnusedClass: 'none',
        reportUnusedFunction: 'none',
        reportUnusedVariable: 'none',
        reportDuplicateImport: 'none',
        reportWildcardImportFromLibrary: 'none',
        reportOptionalSubscript: 'none',
        reportOptionalMemberAccess: 'none',
        reportOptionalCall: 'none',
        reportOptionalIterable: 'none',
        reportOptionalContextManager: 'none',
        reportOptionalOperand: 'none',
        reportUntypedFunctionDecorator: 'none',
        reportUntypedClassDecorator: 'none',
        reportUntypedBaseClass: 'none',
        reportUntypedNamedTuple: 'none',
        reportPrivateUsage: 'none',
        reportConstantRedefinition: 'none',
        reportIncompatibleMethodOverride: 'none',
        reportIncompatibleVariableOverride: 'none',
        reportOverlappingOverload: 'none',
        reportInvalidStringEscapeSequence: 'none',
        reportUnknownParameterType: 'none',
        reportUnknownArgumentType: 'none',
        reportUnknownLambdaType: 'none',
        reportUnknownVariableType: 'none',
        reportUnknownMemberType: 'none',
        reportMissingTypeArgument: 'none',
        reportInvalidTypeVarUse: 'none',
        reportCallInDefaultInitializer: 'none',
        reportUnnecessaryIsInstance: 'none',
        reportUnnecessaryCast: 'none',
        reportAssertAlwaysTrue: 'none',
        reportSelfClsParameterName: 'none',
        reportImplicitStringConcatenation: 'none',
        reportUnboundVariable: 'none',
        reportUndefinedVariable: 'warning',
        reportInvalidStubStatement: 'none',
        reportUnsupportedDunderAll: 'none',
        reportUnusedCallResult: 'none',
        reportUnusedCoroutine: 'none',
    };

    return diagSettings;
}

export function getBasicDiagnosticRuleSet(): DiagnosticRuleSet {
    const diagSettings: DiagnosticRuleSet = {
        printUnknownAsAny: false,
        omitTypeArgsIfAny: false,
        omitUnannotatedParamType: true,
        pep604Printing: true,
        strictListInference: false,
        strictDictionaryInference: false,
        strictParameterNoneValue: false,
        enableTypeIgnoreComments: true,
        reportGeneralTypeIssues: 'error',
        reportPropertyTypeMismatch: 'error',
        reportFunctionMemberAccess: 'none',
        reportMissingImports: 'error',
        reportMissingModuleSource: 'warning',
        reportMissingTypeStubs: 'none',
        reportImportCycles: 'none',
        reportUnusedImport: 'none',
        reportUnusedClass: 'none',
        reportUnusedFunction: 'none',
        reportUnusedVariable: 'none',
        reportDuplicateImport: 'none',
        reportWildcardImportFromLibrary: 'warning',
        reportOptionalSubscript: 'none',
        reportOptionalMemberAccess: 'none',
        reportOptionalCall: 'none',
        reportOptionalIterable: 'none',
        reportOptionalContextManager: 'none',
        reportOptionalOperand: 'none',
        reportUntypedFunctionDecorator: 'none',
        reportUntypedClassDecorator: 'none',
        reportUntypedBaseClass: 'none',
        reportUntypedNamedTuple: 'none',
        reportPrivateUsage: 'none',
        reportConstantRedefinition: 'none',
        reportIncompatibleMethodOverride: 'none',
        reportIncompatibleVariableOverride: 'none',
        reportOverlappingOverload: 'none',
        reportInvalidStringEscapeSequence: 'warning',
        reportUnknownParameterType: 'none',
        reportUnknownArgumentType: 'none',
        reportUnknownLambdaType: 'none',
        reportUnknownVariableType: 'none',
        reportUnknownMemberType: 'none',
        reportMissingTypeArgument: 'none',
        reportInvalidTypeVarUse: 'warning',
        reportCallInDefaultInitializer: 'none',
        reportUnnecessaryIsInstance: 'none',
        reportUnnecessaryCast: 'none',
        reportAssertAlwaysTrue: 'warning',
        reportSelfClsParameterName: 'warning',
        reportImplicitStringConcatenation: 'none',
        reportUnboundVariable: 'error',
        reportUndefinedVariable: 'error',
        reportInvalidStubStatement: 'none',
        reportUnsupportedDunderAll: 'warning',
        reportUnusedCallResult: 'none',
        reportUnusedCoroutine: 'error',
    };

    return diagSettings;
}

export function getStrictDiagnosticRuleSet(): DiagnosticRuleSet {
    const diagSettings: DiagnosticRuleSet = {
        printUnknownAsAny: false,
        omitTypeArgsIfAny: false,
        omitUnannotatedParamType: false,
        pep604Printing: true,
        strictListInference: true,
        strictDictionaryInference: true,
        strictParameterNoneValue: true,
        enableTypeIgnoreComments: true, // Not overridden by strict mode
        reportGeneralTypeIssues: 'error',
        reportPropertyTypeMismatch: 'error',
        reportFunctionMemberAccess: 'error',
        reportMissingImports: 'error',
        reportMissingModuleSource: 'warning',
        reportMissingTypeStubs: 'error',
        reportImportCycles: 'error',
        reportUnusedImport: 'error',
        reportUnusedClass: 'error',
        reportUnusedFunction: 'error',
        reportUnusedVariable: 'error',
        reportDuplicateImport: 'error',
        reportWildcardImportFromLibrary: 'error',
        reportOptionalSubscript: 'error',
        reportOptionalMemberAccess: 'error',
        reportOptionalCall: 'error',
        reportOptionalIterable: 'error',
        reportOptionalContextManager: 'error',
        reportOptionalOperand: 'error',
        reportUntypedFunctionDecorator: 'error',
        reportUntypedClassDecorator: 'error',
        reportUntypedBaseClass: 'error',
        reportUntypedNamedTuple: 'error',
        reportPrivateUsage: 'error',
        reportConstantRedefinition: 'error',
        reportIncompatibleMethodOverride: 'error',
        reportIncompatibleVariableOverride: 'error',
        reportOverlappingOverload: 'error',
        reportInvalidStringEscapeSequence: 'error',
        reportUnknownParameterType: 'error',
        reportUnknownArgumentType: 'error',
        reportUnknownLambdaType: 'error',
        reportUnknownVariableType: 'error',
        reportUnknownMemberType: 'error',
        reportMissingTypeArgument: 'error',
        reportInvalidTypeVarUse: 'error',
        reportCallInDefaultInitializer: 'none',
        reportUnnecessaryIsInstance: 'error',
        reportUnnecessaryCast: 'error',
        reportAssertAlwaysTrue: 'error',
        reportSelfClsParameterName: 'error',
        reportImplicitStringConcatenation: 'none',
        reportUnboundVariable: 'error',
        reportUndefinedVariable: 'error',
        reportInvalidStubStatement: 'error',
        reportUnsupportedDunderAll: 'error',
        reportUnusedCallResult: 'none',
        reportUnusedCoroutine: 'error',
    };

    return diagSettings;
}

// Internal configuration options. These are derived from a combination
// of the command line and from a JSON-based config file.
export class ConfigOptions {
    constructor(projectRoot: string, typeCheckingMode?: string) {
        this.projectRoot = projectRoot;
        this.diagnosticRuleSet = ConfigOptions.getDiagnosticRuleSet(typeCheckingMode);

        // If type checking mode is off, allow inference for py.typed sources
        // since there is little or no downside and possible upside of discovering
        // more type information in this case. If type checking is enabled, using
        // type inference in this case can result in false positive errors.
        if (typeCheckingMode === 'off') {
            this.disableInferenceForPyTypedSources = false;
        }
    }

    // Absolute directory of project. All relative paths in the config
    // are based on this path.
    projectRoot: string;

    // Path to python interpreter.
    pythonPath?: string;

    // Path to use for typeshed definitions.
    typeshedPath?: string;

    // Path to custom typings (stub) modules.
    stubPath?: string;

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
    autoExcludeVenv?: boolean;

    // A list of file specs whose errors and warnings should be ignored even
    // if they are included in the transitive closure of included files.
    ignore: FileSpec[] = [];

    // A list of file specs that should be analyzed using "strict" mode.
    strict: FileSpec[] = [];

    // Emit verbose information to console?
    verboseOutput?: boolean;

    // Perform type checking and report diagnostics only for open files?
    checkOnlyOpenFiles?: boolean;

    // In the absence of type stubs, use library implementations to extract
    // type information?
    useLibraryCodeForTypes?: boolean;

    // Offer auto-import completions.
    autoImportCompletions = true;

    // Use indexing.
    indexing = false;

    // Use type evaluator call tracking
    logTypeEvaluationTime = false;

    // Minimum threshold for type eval logging
    typeEvaluationTimeThreshold = 50;

    // Avoid using type inference for files within packages that claim
    // to contain type annotations?
    disableInferenceForPyTypedSources = true;

    //---------------------------------------------------------------
    // Diagnostics Rule Set

    diagnosticRuleSet: DiagnosticRuleSet;

    //---------------------------------------------------------------
    // Parsing and Import Resolution Settings

    // Parameters that specify the execution environment for
    // the files being analyzed.
    executionEnvironments: ExecutionEnvironment[] = [];

    // Path to a directory containing one or more virtual environment
    // directories. This is used in conjunction with the "venv" name in
    // the config file to identify the python environment used for resolving
    // third-party modules.
    venvPath?: string;

    // Default venv environment.
    venv?: string;

    // Default pythonVersion. Can be overridden by executionEnvironment.
    defaultPythonVersion?: PythonVersion;

    // Default pythonPlatform. Can be overridden by executionEnvironment.
    defaultPythonPlatform?: string;

    // Default extraPaths. Can be overridden by executionEnvironment.
    defaultExtraPaths?: string[];

    //---------------------------------------------------------------
    // Internal-only switches

    // Run additional analysis as part of test cases?
    internalTestMode?: boolean;

    static getDiagnosticRuleSet(typeCheckingMode?: string): DiagnosticRuleSet {
        if (typeCheckingMode === 'strict') {
            return getStrictDiagnosticRuleSet();
        }

        if (typeCheckingMode === 'off') {
            return getOffDiagnosticRuleSet();
        }

        return getBasicDiagnosticRuleSet();
    }

    // Finds the best execution environment for a given file path. The
    // specified file path should be absolute.
    // If no matching execution environment can be found, a default
    // execution environment is used.
    findExecEnvironment(filePath: string): ExecutionEnvironment {
        let execEnv = this.executionEnvironments.find((env) => {
            const envRoot = ensureTrailingDirectorySeparator(normalizePath(combinePaths(this.projectRoot, env.root)));
            return filePath.startsWith(envRoot);
        });

        if (!execEnv) {
            execEnv = new ExecutionEnvironment(
                this.projectRoot,
                this.defaultPythonVersion,
                this.defaultPythonPlatform,
                this.defaultExtraPaths
            );
        }

        return execEnv;
    }

    getDefaultExecEnvironment(): ExecutionEnvironment {
        return new ExecutionEnvironment(
            this.projectRoot,
            this.defaultPythonVersion,
            this.defaultPythonPlatform,
            this.defaultExtraPaths
        );
    }

    // Initialize the structure from a JSON object.
    initializeFromJson(
        configObj: any,
        typeCheckingMode: string | undefined,
        console: ConsoleInterface,
        diagnosticOverrides?: DiagnosticSeverityOverridesMap,
        pythonPath?: string,
        skipIncludeSection = false
    ) {
        // Read the "include" entry.
        if (!skipIncludeSection) {
            this.include = [];
            if (configObj.include !== undefined) {
                if (!Array.isArray(configObj.include)) {
                    console.error(`Config "include" entry must must contain an array.`);
                } else {
                    const filesList = configObj.include as string[];
                    filesList.forEach((fileSpec, index) => {
                        if (typeof fileSpec !== 'string') {
                            console.error(`Index ${index} of "include" array should be a string.`);
                        } else if (isAbsolute(fileSpec)) {
                            console.error(`Ignoring path "${fileSpec}" in "include" array because it is not relative.`);
                        } else {
                            this.include.push(getFileSpec(this.projectRoot, fileSpec));
                        }
                    });
                }
            }
        }

        // Read the "exclude" entry.
        this.exclude = [];
        if (configObj.exclude !== undefined) {
            if (!Array.isArray(configObj.exclude)) {
                console.error(`Config "exclude" entry must contain an array.`);
            } else {
                const filesList = configObj.exclude as string[];
                filesList.forEach((fileSpec, index) => {
                    if (typeof fileSpec !== 'string') {
                        console.error(`Index ${index} of "exclude" array should be a string.`);
                    } else if (isAbsolute(fileSpec)) {
                        console.error(`Ignoring path "${fileSpec}" in "exclude" array because it is not relative.`);
                    } else {
                        this.exclude.push(getFileSpec(this.projectRoot, fileSpec));
                    }
                });
            }
        }

        // Read the "ignore" entry.
        this.ignore = [];
        if (configObj.ignore !== undefined) {
            if (!Array.isArray(configObj.ignore)) {
                console.error(`Config "ignore" entry must contain an array.`);
            } else {
                const filesList = configObj.ignore as string[];
                filesList.forEach((fileSpec, index) => {
                    if (typeof fileSpec !== 'string') {
                        console.error(`Index ${index} of "ignore" array should be a string.`);
                    } else if (isAbsolute(fileSpec)) {
                        console.error(`Ignoring path "${fileSpec}" in "ignore" array because it is not relative.`);
                    } else {
                        this.ignore.push(getFileSpec(this.projectRoot, fileSpec));
                    }
                });
            }
        }

        // Read the "strict" entry.
        this.strict = [];
        if (configObj.strict !== undefined) {
            if (!Array.isArray(configObj.strict)) {
                console.error(`Config "strict" entry must contain an array.`);
            } else {
                const filesList = configObj.strict as string[];
                filesList.forEach((fileSpec, index) => {
                    if (typeof fileSpec !== 'string') {
                        console.error(`Index ${index} of "strict" array should be a string.`);
                    } else if (isAbsolute(fileSpec)) {
                        console.error(`Ignoring path "${fileSpec}" in "strict" array because it is not relative.`);
                    } else {
                        this.strict.push(getFileSpec(this.projectRoot, fileSpec));
                    }
                });
            }
        }

        // If there is a "typeCheckingMode", it can override the provided setting.
        let configTypeCheckingMode: string | undefined;
        if (configObj.typeCheckingMode !== undefined) {
            if (
                configObj.typeCheckingMode === 'off' ||
                configObj.typeCheckingMode === 'basic' ||
                configObj.typeCheckingMode === 'strict'
            ) {
                configTypeCheckingMode = configObj.typeCheckingMode;
            } else {
                console.error(`Config "typeCheckingMode" entry must contain "off", "basic", or "strict".`);
            }
        }

        if (configObj.useLibraryCodeForTypes !== undefined) {
            if (typeof configObj.useLibraryCodeForTypes === 'boolean') {
                this.useLibraryCodeForTypes = configObj.useLibraryCodeForTypes;
            } else {
                console.error(`Config "useLibraryCodeForTypes" entry must be true or false.`);
            }
        }

        const effectiveTypeCheckingMode = configTypeCheckingMode || typeCheckingMode;
        const defaultSettings = ConfigOptions.getDiagnosticRuleSet(effectiveTypeCheckingMode);
        if (effectiveTypeCheckingMode === 'off') {
            this.disableInferenceForPyTypedSources = false;
        }

        // Apply host provided overrides first and then overrides from the config file
        this.applyDiagnosticOverrides(diagnosticOverrides);

        this.diagnosticRuleSet = {
            printUnknownAsAny: defaultSettings.printUnknownAsAny,
            omitTypeArgsIfAny: defaultSettings.omitTypeArgsIfAny,
            omitUnannotatedParamType: defaultSettings.omitUnannotatedParamType,
            pep604Printing: defaultSettings.pep604Printing,

            // Use strict inference rules for list expressions?
            strictListInference: this._convertBoolean(
                configObj.strictListInference,
                DiagnosticRule.strictListInference,
                defaultSettings.strictListInference
            ),

            // Use strict inference rules for dictionary expressions?
            strictDictionaryInference: this._convertBoolean(
                configObj.strictDictionaryInference,
                DiagnosticRule.strictDictionaryInference,
                defaultSettings.strictDictionaryInference
            ),

            // Should a None default value imply that the parameter type
            // is Optional?
            strictParameterNoneValue: this._convertBoolean(
                configObj.strictParameterNoneValue,
                DiagnosticRule.strictParameterNoneValue,
                defaultSettings.strictParameterNoneValue
            ),

            // Should "# type: ignore" be honored?
            enableTypeIgnoreComments: this._convertBoolean(
                configObj.enableTypeIgnoreComments,
                DiagnosticRule.enableTypeIgnoreComments,
                defaultSettings.enableTypeIgnoreComments
            ),

            // Read the "reportGeneralTypeIssues" entry.
            reportGeneralTypeIssues: this._convertDiagnosticLevel(
                configObj.reportGeneralTypeIssues,
                DiagnosticRule.reportGeneralTypeIssues,
                defaultSettings.reportGeneralTypeIssues
            ),

            // Read the "reportPropertyTypeMismatch" entry.
            reportPropertyTypeMismatch: this._convertDiagnosticLevel(
                configObj.reportPropertyTypeMismatch,
                DiagnosticRule.reportPropertyTypeMismatch,
                defaultSettings.reportPropertyTypeMismatch
            ),

            // Read the "reportFunctionMemberAccess" entry.
            reportFunctionMemberAccess: this._convertDiagnosticLevel(
                configObj.reportFunctionMemberAccess,
                DiagnosticRule.reportFunctionMemberAccess,
                defaultSettings.reportFunctionMemberAccess
            ),

            // Read the "reportMissingImports" entry.
            reportMissingImports: this._convertDiagnosticLevel(
                configObj.reportMissingImports,
                DiagnosticRule.reportMissingImports,
                defaultSettings.reportMissingImports
            ),

            // Read the "reportUnusedImport" entry.
            reportUnusedImport: this._convertDiagnosticLevel(
                configObj.reportUnusedImport,
                DiagnosticRule.reportUnusedImport,
                defaultSettings.reportUnusedImport
            ),

            // Read the "reportUnusedClass" entry.
            reportUnusedClass: this._convertDiagnosticLevel(
                configObj.reportUnusedClass,
                DiagnosticRule.reportUnusedClass,
                defaultSettings.reportUnusedClass
            ),

            // Read the "reportUnusedFunction" entry.
            reportUnusedFunction: this._convertDiagnosticLevel(
                configObj.reportUnusedFunction,
                DiagnosticRule.reportUnusedFunction,
                defaultSettings.reportUnusedFunction
            ),

            // Read the "reportUnusedVariable" entry.
            reportUnusedVariable: this._convertDiagnosticLevel(
                configObj.reportUnusedVariable,
                DiagnosticRule.reportUnusedVariable,
                defaultSettings.reportUnusedVariable
            ),

            // Read the "reportDuplicateImport" entry.
            reportDuplicateImport: this._convertDiagnosticLevel(
                configObj.reportDuplicateImport,
                DiagnosticRule.reportDuplicateImport,
                defaultSettings.reportDuplicateImport
            ),

            // Read the "reportWildcardImportFromLibrary" entry.
            reportWildcardImportFromLibrary: this._convertDiagnosticLevel(
                configObj.reportWildcardImportFromLibrary,
                DiagnosticRule.reportWildcardImportFromLibrary,
                defaultSettings.reportWildcardImportFromLibrary
            ),

            // Read the "reportMissingModuleSource" entry.
            reportMissingModuleSource: this._convertDiagnosticLevel(
                configObj.reportMissingModuleSource,
                DiagnosticRule.reportMissingModuleSource,
                defaultSettings.reportMissingModuleSource
            ),

            // Read the "reportMissingTypeStubs" entry.
            reportMissingTypeStubs: this._convertDiagnosticLevel(
                configObj.reportMissingTypeStubs,
                DiagnosticRule.reportMissingTypeStubs,
                defaultSettings.reportMissingTypeStubs
            ),

            // Read the "reportImportCycles" entry.
            reportImportCycles: this._convertDiagnosticLevel(
                configObj.reportImportCycles,
                DiagnosticRule.reportImportCycles,
                defaultSettings.reportImportCycles
            ),

            // Read the "reportOptionalSubscript" entry.
            reportOptionalSubscript: this._convertDiagnosticLevel(
                configObj.reportOptionalSubscript,
                DiagnosticRule.reportOptionalSubscript,
                defaultSettings.reportOptionalSubscript
            ),

            // Read the "reportOptionalMemberAccess" entry.
            reportOptionalMemberAccess: this._convertDiagnosticLevel(
                configObj.reportOptionalMemberAccess,
                DiagnosticRule.reportOptionalMemberAccess,
                defaultSettings.reportOptionalMemberAccess
            ),

            // Read the "reportOptionalCall" entry.
            reportOptionalCall: this._convertDiagnosticLevel(
                configObj.reportOptionalCall,
                DiagnosticRule.reportOptionalCall,
                defaultSettings.reportOptionalCall
            ),

            // Read the "reportOptionalIterable" entry.
            reportOptionalIterable: this._convertDiagnosticLevel(
                configObj.reportOptionalIterable,
                DiagnosticRule.reportOptionalIterable,
                defaultSettings.reportOptionalIterable
            ),

            // Read the "reportOptionalContextManager" entry.
            reportOptionalContextManager: this._convertDiagnosticLevel(
                configObj.reportOptionalContextManager,
                DiagnosticRule.reportOptionalContextManager,
                defaultSettings.reportOptionalContextManager
            ),

            // Read the "reportOptionalOperand" entry.
            reportOptionalOperand: this._convertDiagnosticLevel(
                configObj.reportOptionalOperand,
                DiagnosticRule.reportOptionalOperand,
                defaultSettings.reportOptionalOperand
            ),

            // Read the "reportUntypedFunctionDecorator" entry.
            reportUntypedFunctionDecorator: this._convertDiagnosticLevel(
                configObj.reportUntypedFunctionDecorator,
                DiagnosticRule.reportUntypedFunctionDecorator,
                defaultSettings.reportUntypedFunctionDecorator
            ),

            // Read the "reportUntypedClassDecorator" entry.
            reportUntypedClassDecorator: this._convertDiagnosticLevel(
                configObj.reportUntypedClassDecorator,
                DiagnosticRule.reportUntypedClassDecorator,
                defaultSettings.reportUntypedClassDecorator
            ),

            // Read the "reportUntypedBaseClass" entry.
            reportUntypedBaseClass: this._convertDiagnosticLevel(
                configObj.reportUntypedBaseClass,
                DiagnosticRule.reportUntypedBaseClass,
                defaultSettings.reportUntypedBaseClass
            ),

            // Read the "reportUntypedNamedTuple" entry.
            reportUntypedNamedTuple: this._convertDiagnosticLevel(
                configObj.reportUntypedNamedTuple,
                DiagnosticRule.reportUntypedNamedTuple,
                defaultSettings.reportUntypedNamedTuple
            ),

            // Read the "reportPrivateUsage" entry.
            reportPrivateUsage: this._convertDiagnosticLevel(
                configObj.reportPrivateUsage,
                DiagnosticRule.reportPrivateUsage,
                defaultSettings.reportPrivateUsage
            ),

            // Read the "reportConstantRedefinition" entry.
            reportConstantRedefinition: this._convertDiagnosticLevel(
                configObj.reportConstantRedefinition,
                DiagnosticRule.reportConstantRedefinition,
                defaultSettings.reportConstantRedefinition
            ),

            // Read the "reportIncompatibleMethodOverride" entry.
            reportIncompatibleMethodOverride: this._convertDiagnosticLevel(
                configObj.reportIncompatibleMethodOverride,
                DiagnosticRule.reportIncompatibleMethodOverride,
                defaultSettings.reportIncompatibleMethodOverride
            ),

            // Read the "reportIncompatibleVariableOverride" entry.
            reportIncompatibleVariableOverride: this._convertDiagnosticLevel(
                configObj.reportIncompatibleVariableOverride,
                DiagnosticRule.reportIncompatibleVariableOverride,
                defaultSettings.reportIncompatibleVariableOverride
            ),

            // Read the "reportOverlappingOverload" entry.
            reportOverlappingOverload: this._convertDiagnosticLevel(
                configObj.reportOverlappingOverload,
                DiagnosticRule.reportOverlappingOverload,
                defaultSettings.reportOverlappingOverload
            ),

            // Read the "reportInvalidStringEscapeSequence" entry.
            reportInvalidStringEscapeSequence: this._convertDiagnosticLevel(
                configObj.reportInvalidStringEscapeSequence,
                DiagnosticRule.reportInvalidStringEscapeSequence,
                defaultSettings.reportInvalidStringEscapeSequence
            ),

            // Read the "reportUnknownParameterType" entry.
            reportUnknownParameterType: this._convertDiagnosticLevel(
                configObj.reportUnknownParameterType,
                DiagnosticRule.reportUnknownParameterType,
                defaultSettings.reportUnknownParameterType
            ),

            // Read the "reportUnknownArgumentType" entry.
            reportUnknownArgumentType: this._convertDiagnosticLevel(
                configObj.reportUnknownArgumentType,
                DiagnosticRule.reportUnknownArgumentType,
                defaultSettings.reportUnknownArgumentType
            ),

            // Read the "reportUnknownLambdaType" entry.
            reportUnknownLambdaType: this._convertDiagnosticLevel(
                configObj.reportUnknownLambdaType,
                DiagnosticRule.reportUnknownLambdaType,
                defaultSettings.reportUnknownLambdaType
            ),

            // Read the "reportUnknownVariableType" entry.
            reportUnknownVariableType: this._convertDiagnosticLevel(
                configObj.reportUnknownVariableType,
                DiagnosticRule.reportUnknownVariableType,
                defaultSettings.reportUnknownVariableType
            ),

            // Read the "reportUnknownMemberType" entry.
            reportUnknownMemberType: this._convertDiagnosticLevel(
                configObj.reportUnknownMemberType,
                DiagnosticRule.reportUnknownMemberType,
                defaultSettings.reportUnknownMemberType
            ),

            // Read the "reportMissingTypeArgument" entry.
            reportMissingTypeArgument: this._convertDiagnosticLevel(
                configObj.reportMissingTypeArgument,
                DiagnosticRule.reportMissingTypeArgument,
                defaultSettings.reportMissingTypeArgument
            ),

            // Read the "reportInvalidTypeVarUse" entry.
            reportInvalidTypeVarUse: this._convertDiagnosticLevel(
                configObj.reportInvalidTypeVarUse,
                DiagnosticRule.reportInvalidTypeVarUse,
                defaultSettings.reportInvalidTypeVarUse
            ),

            // Read the "reportCallInDefaultInitializer" entry.
            reportCallInDefaultInitializer: this._convertDiagnosticLevel(
                configObj.reportCallInDefaultInitializer,
                DiagnosticRule.reportCallInDefaultInitializer,
                defaultSettings.reportCallInDefaultInitializer
            ),

            // Read the "reportUnnecessaryIsInstance" entry.
            reportUnnecessaryIsInstance: this._convertDiagnosticLevel(
                configObj.reportUnnecessaryIsInstance,
                DiagnosticRule.reportUnnecessaryIsInstance,
                defaultSettings.reportUnnecessaryIsInstance
            ),

            // Read the "reportUnnecessaryCast" entry.
            reportUnnecessaryCast: this._convertDiagnosticLevel(
                configObj.reportUnnecessaryCast,
                DiagnosticRule.reportUnnecessaryCast,
                defaultSettings.reportUnnecessaryCast
            ),

            // Read the "reportAssertAlwaysTrue" entry.
            reportAssertAlwaysTrue: this._convertDiagnosticLevel(
                configObj.reportAssertAlwaysTrue,
                DiagnosticRule.reportAssertAlwaysTrue,
                defaultSettings.reportAssertAlwaysTrue
            ),

            // Read the "reportSelfClsParameterName" entry.
            reportSelfClsParameterName: this._convertDiagnosticLevel(
                configObj.reportSelfClsParameterName,
                DiagnosticRule.reportSelfClsParameterName,
                defaultSettings.reportSelfClsParameterName
            ),

            // Read the "reportImplicitStringConcatenation" entry.
            reportImplicitStringConcatenation: this._convertDiagnosticLevel(
                configObj.reportImplicitStringConcatenation,
                DiagnosticRule.reportImplicitStringConcatenation,
                defaultSettings.reportImplicitStringConcatenation
            ),

            // Read the "reportUndefinedVariable" entry.
            reportUndefinedVariable: this._convertDiagnosticLevel(
                configObj.reportUndefinedVariable,
                DiagnosticRule.reportUndefinedVariable,
                defaultSettings.reportUndefinedVariable
            ),

            // Read the "reportUnboundVariable" entry.
            reportUnboundVariable: this._convertDiagnosticLevel(
                configObj.reportUnboundVariable,
                DiagnosticRule.reportUnboundVariable,
                defaultSettings.reportUnboundVariable
            ),

            // Read the "reportInvalidStubStatement" entry.
            reportInvalidStubStatement: this._convertDiagnosticLevel(
                configObj.reportInvalidStubStatement,
                DiagnosticRule.reportInvalidStubStatement,
                defaultSettings.reportInvalidStubStatement
            ),

            // Read the "reportUnsupportedDunderAll" entry.
            reportUnsupportedDunderAll: this._convertDiagnosticLevel(
                configObj.reportUnsupportedDunderAll,
                DiagnosticRule.reportUnsupportedDunderAll,
                defaultSettings.reportUnsupportedDunderAll
            ),

            // Read the "reportUnusedCallResult" entry.
            reportUnusedCallResult: this._convertDiagnosticLevel(
                configObj.reportUnusedCallResult,
                DiagnosticRule.reportUnusedCallResult,
                defaultSettings.reportUnusedCallResult
            ),

            // Read the "reportUnusedCoroutine" entry.
            reportUnusedCoroutine: this._convertDiagnosticLevel(
                configObj.reportUnusedCoroutine,
                DiagnosticRule.reportUnusedCoroutine,
                defaultSettings.reportUnusedCoroutine
            ),
        };

        // Read the "venvPath".
        this.venvPath = undefined;
        if (configObj.venvPath !== undefined) {
            if (typeof configObj.venvPath !== 'string') {
                console.error(`Config "venvPath" field must contain a string.`);
            } else {
                this.venvPath = normalizePath(combinePaths(this.projectRoot, configObj.venvPath));
            }
        }

        // Read the "venv" name.
        this.venv = undefined;
        if (configObj.venv !== undefined) {
            if (typeof configObj.venv !== 'string') {
                console.error(`Config "venv" field must contain a string.`);
            } else {
                this.venv = configObj.venv;
            }
        }

        // Read the default "extraPaths".
        if (configObj.extraPaths !== undefined) {
            this.defaultExtraPaths = [];
            if (!Array.isArray(configObj.extraPaths)) {
                console.error(`Config "extraPaths" field must contain an array.`);
            } else {
                const pathList = configObj.extraPaths as string[];
                pathList.forEach((path, pathIndex) => {
                    if (typeof path !== 'string') {
                        console.error(`Config "extraPaths" field ${pathIndex} must be a string.`);
                    } else {
                        this.defaultExtraPaths!.push(normalizePath(combinePaths(this.projectRoot, path)));
                    }
                });
            }
        }

        // Read the default "pythonVersion".
        if (configObj.pythonVersion !== undefined) {
            if (typeof configObj.pythonVersion === 'string') {
                const version = versionFromString(configObj.pythonVersion);
                if (version) {
                    this.defaultPythonVersion = version;
                } else {
                    console.error(`Config "pythonVersion" field contains unsupported version.`);
                }
            } else {
                console.error(`Config "pythonVersion" field must contain a string.`);
            }
        }

        this.ensureDefaultPythonVersion(pythonPath, console);

        // Read the default "pythonPlatform".
        if (configObj.pythonPlatform !== undefined) {
            if (typeof configObj.pythonPlatform !== 'string') {
                console.error(`Config "pythonPlatform" field must contain a string.`);
            } else {
                this.defaultPythonPlatform = configObj.pythonPlatform;
            }
        }

        this.ensureDefaultPythonPlatform(console);

        // Read the "typeshedPath" setting.
        this.typeshedPath = undefined;
        if (configObj.typeshedPath !== undefined) {
            if (typeof configObj.typeshedPath !== 'string') {
                console.error(`Config "typeshedPath" field must contain a string.`);
            } else {
                this.typeshedPath = configObj.typeshedPath
                    ? normalizePath(combinePaths(this.projectRoot, configObj.typeshedPath))
                    : '';
            }
        }

        // Read the "stubPath" setting.
        this.stubPath = undefined;

        // Keep this for backward compatibility
        if (configObj.typingsPath !== undefined) {
            if (typeof configObj.typingsPath !== 'string') {
                console.error(`Config "typingsPath" field must contain a string.`);
            } else {
                console.error(`Config "typingsPath" is now deprecated. Please, use stubPath instead.`);
                this.stubPath = normalizePath(combinePaths(this.projectRoot, configObj.typingsPath));
            }
        }

        if (configObj.stubPath !== undefined) {
            if (typeof configObj.stubPath !== 'string') {
                console.error(`Config "stubPath" field must contain a string.`);
            } else {
                this.stubPath = normalizePath(combinePaths(this.projectRoot, configObj.stubPath));
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

        // Read the "useLibraryCodeForTypes" setting.
        if (configObj.useLibraryCodeForTypes !== undefined) {
            if (typeof configObj.useLibraryCodeForTypes !== 'boolean') {
                console.error(`Config "useLibraryCodeForTypes" field must be true or false.`);
            } else {
                this.useLibraryCodeForTypes = configObj.useLibraryCodeForTypes;
            }
        }

        // Read the "executionEnvironments" array. This should be done at the end
        // after we've established default values.
        this.executionEnvironments = [];
        if (configObj.executionEnvironments !== undefined) {
            if (!Array.isArray(configObj.executionEnvironments)) {
                console.error(`Config "executionEnvironments" field must contain an array.`);
            } else {
                const execEnvironments = configObj.executionEnvironments as ExecutionEnvironment[];
                execEnvironments.forEach((env, index) => {
                    const execEnv = this._initExecutionEnvironmentFromJson(env, index, console);
                    if (execEnv) {
                        this.executionEnvironments.push(execEnv);
                    }
                });
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
    }

    ensureDefaultPythonPlatform(console: ConsoleInterface) {
        // If no default python platform was specified, assume that the
        // user wants to use the current platform.
        if (this.defaultPythonPlatform !== undefined) {
            return;
        }

        if (process.platform === 'darwin') {
            this.defaultPythonPlatform = PythonPlatform.Darwin;
        } else if (process.platform === 'linux') {
            this.defaultPythonPlatform = PythonPlatform.Linux;
        } else if (process.platform === 'win32') {
            this.defaultPythonPlatform = PythonPlatform.Windows;
        }

        if (this.defaultPythonPlatform !== undefined) {
            console.info(`Assuming Python platform ${this.defaultPythonPlatform}`);
        }
    }

    ensureDefaultPythonVersion(pythonPath: string | undefined, console: ConsoleInterface) {
        // If no default python version was specified, retrieve the version
        // from the currently-selected python interpreter.
        if (this.defaultPythonVersion !== undefined) {
            return;
        }

        this.defaultPythonVersion = this._getPythonVersionFromPythonInterpreter(pythonPath, console);
        if (this.defaultPythonVersion !== undefined) {
            console.info(`Assuming Python version ${versionToString(this.defaultPythonVersion)}`);
        }
    }

    ensureDefaultExtraPaths(fs: FileSystem, autoSearchPaths: boolean, extraPaths: string[] | undefined) {
        const paths: string[] = [];

        if (autoSearchPaths) {
            // Auto-detect the common scenario where the sources are under the src folder
            const srcPath = resolvePaths(this.projectRoot, pathConsts.src);
            if (fs.existsSync(srcPath) && !fs.existsSync(resolvePaths(srcPath, '__init__.py'))) {
                paths.push(srcPath);
            }
        }

        if (extraPaths && extraPaths.length > 0) {
            for (const p of extraPaths) {
                paths.push(resolvePaths(this.projectRoot, p));
            }
        }

        if (paths.length > 0) {
            this.defaultExtraPaths = paths;
        }
    }

    applyDiagnosticOverrides(diagnosticSeverityOverrides: DiagnosticSeverityOverridesMap | undefined) {
        if (!diagnosticSeverityOverrides) {
            return;
        }

        for (const [ruleName, severity] of Object.entries(diagnosticSeverityOverrides)) {
            (this.diagnosticRuleSet as any)[ruleName] = severity;
        }
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
        index: number,
        console: ConsoleInterface
    ): ExecutionEnvironment | undefined {
        try {
            const newExecEnv = new ExecutionEnvironment(
                this.projectRoot,
                this.defaultPythonVersion,
                this.defaultPythonPlatform,
                this.defaultExtraPaths
            );

            // Validate the root.
            if (envObj.root && typeof envObj.root === 'string') {
                newExecEnv.root = normalizePath(combinePaths(this.projectRoot, envObj.root));
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
                    const pathList = envObj.extraPaths as string[];
                    pathList.forEach((path, pathIndex) => {
                        if (typeof path !== 'string') {
                            console.error(
                                `Config executionEnvironments index ${index}:` +
                                    ` extraPaths field ${pathIndex} must be a string.`
                            );
                        } else {
                            newExecEnv.extraPaths.push(normalizePath(combinePaths(this.projectRoot, path)));
                        }
                    });
                }
            }

            // Validate the pythonVersion.
            if (envObj.pythonVersion) {
                if (typeof envObj.pythonVersion === 'string') {
                    const version = versionFromString(envObj.pythonVersion);
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

            return newExecEnv;
        } catch {
            console.error(`Config executionEnvironments index ${index} is not accessible.`);
        }

        return undefined;
    }

    private _getPythonVersionFromPythonInterpreter(
        interpreterPath: string | undefined,
        console: ConsoleInterface
    ): PythonVersion | undefined {
        try {
            const commandLineArgs: string[] = [
                '-c',
                'import sys, json; json.dump(dict(major=sys.version_info[0], minor=sys.version_info[1]), sys.stdout)',
            ];
            let execOutput: string;

            if (interpreterPath) {
                execOutput = child_process.execFileSync(interpreterPath, commandLineArgs, { encoding: 'utf8' });
            } else {
                execOutput = child_process.execFileSync('python', commandLineArgs, { encoding: 'utf8' });
            }

            const versionJson: { major: number; minor: number } = JSON.parse(execOutput);

            const version = versionFromMajorMinor(versionJson.major, versionJson.minor);
            if (version === undefined) {
                console.warn(
                    `Python version ${versionJson.major}.${versionJson.minor} from interpreter is unsupported`
                );
                return undefined;
            }

            return version;
        } catch {
            console.info('Unable to get Python version from interpreter');
            return undefined;
        }
    }
}
