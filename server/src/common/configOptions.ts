/*
* configOptions.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Class that holds the configuration options for the analyzer.
*/

import { isAbsolute } from 'path';

import { ConsoleInterface } from './console';
import { DiagnosticRule } from './diagnosticRules';
import { combinePaths, ensureTrailingDirectorySeparator, FileSpec,
    getFileSpec, normalizePath } from './pathUtils';
import { latestStablePythonVersion, PythonVersion, versionFromString } from './pythonVersion';

export class ExecutionEnvironment {
    // Default to "." which indicates every file in the project.
    constructor(root: string, defaultPythonVersion?: PythonVersion, defaultPythonPlatform?: string) {
        this.root = root;
        this.pythonVersion = defaultPythonVersion || latestStablePythonVersion;
        this.pythonPlatform = defaultPythonPlatform;
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

    // Name of virtual environment to use.
    venv?: string;
}

export type DiagnosticLevel = 'none' | 'warning' | 'error';

export interface DiagnosticSettings {
    // Use strict inference rules for list expressions?
    strictListInference: boolean;

    // Use strict inference rules for dictionary expressions?
    strictDictionaryInference: boolean;

    // Use strict type rules for parameters assigned default of None?
    strictParameterNoneValue: boolean;

    // Enable support for type: ignore comments?
    enableTypeIgnoreComments: boolean;

    // Report diagnostics in typeshed files?
    reportTypeshedErrors: DiagnosticLevel;

    // Report missing imports?
    reportMissingImports: DiagnosticLevel;

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
}

export function cloneDiagnosticSettings(
        diagSettings: DiagnosticSettings): DiagnosticSettings {

    // Create a shallow copy of the existing object.
    return Object.assign({}, diagSettings);
}

export function getBooleanDiagnosticSettings() {
    return [
        DiagnosticRule.strictListInference,
        DiagnosticRule.strictDictionaryInference,
        DiagnosticRule.strictParameterNoneValue

        // Do not include this this one because we don't
        // want to override it in strict mode or support
        // it within pyright comments.
        // DiagnosticRule.enableTypeIgnoreComments
    ];
}

export function getDiagLevelSettings() {
    return [
        DiagnosticRule.reportTypeshedErrors,
        DiagnosticRule.reportMissingImports,
        DiagnosticRule.reportMissingTypeStubs,
        DiagnosticRule.reportImportCycles,
        DiagnosticRule.reportUnusedImport,
        DiagnosticRule.reportUnusedClass,
        DiagnosticRule.reportUnusedFunction,
        DiagnosticRule.reportUnusedVariable,
        DiagnosticRule.reportDuplicateImport,
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
        DiagnosticRule.reportInvalidStringEscapeSequence,
        DiagnosticRule.reportUnknownParameterType,
        DiagnosticRule.reportUnknownArgumentType,
        DiagnosticRule.reportUnknownLambdaType,
        DiagnosticRule.reportUnknownVariableType,
        DiagnosticRule.reportUnknownMemberType,
        DiagnosticRule.reportCallInDefaultInitializer,
        DiagnosticRule.reportUnnecessaryIsInstance,
        DiagnosticRule.reportUnnecessaryCast,
        DiagnosticRule.reportAssertAlwaysTrue,
        DiagnosticRule.reportSelfClsParameterName,
        DiagnosticRule.reportImplicitStringConcatenation
    ];
}

export function getStrictDiagnosticSettings(): DiagnosticSettings {
    const diagSettings: DiagnosticSettings = {
        strictListInference: true,
        strictDictionaryInference: true,
        strictParameterNoneValue: true,
        enableTypeIgnoreComments: true, // Not overridden by strict mode
        reportTypeshedErrors: 'error',
        reportMissingImports: 'error',
        reportMissingTypeStubs: 'error',
        reportImportCycles: 'error',
        reportUnusedImport: 'error',
        reportUnusedClass: 'error',
        reportUnusedFunction: 'error',
        reportUnusedVariable: 'error',
        reportDuplicateImport: 'error',
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
        reportInvalidStringEscapeSequence: 'error',
        reportUnknownParameterType: 'error',
        reportUnknownArgumentType: 'error',
        reportUnknownLambdaType: 'error',
        reportUnknownVariableType: 'error',
        reportUnknownMemberType: 'error',
        reportCallInDefaultInitializer: 'none',
        reportUnnecessaryIsInstance: 'error',
        reportUnnecessaryCast: 'error',
        reportAssertAlwaysTrue: 'error',
        reportSelfClsParameterName: 'error',
        reportImplicitStringConcatenation: 'none'
    };

    return diagSettings;
}

export function getDefaultDiagnosticSettings(): DiagnosticSettings {
    const diagSettings: DiagnosticSettings = {
        strictListInference: false,
        strictDictionaryInference: false,
        strictParameterNoneValue: false,
        enableTypeIgnoreComments: true,
        reportTypeshedErrors: 'none',
        reportMissingImports: 'error',
        reportMissingTypeStubs: 'none',
        reportImportCycles: 'none',
        reportUnusedImport: 'none',
        reportUnusedClass: 'none',
        reportUnusedFunction: 'none',
        reportUnusedVariable: 'none',
        reportDuplicateImport: 'none',
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
        reportInvalidStringEscapeSequence: 'warning',
        reportUnknownParameterType: 'none',
        reportUnknownArgumentType: 'none',
        reportUnknownLambdaType: 'none',
        reportUnknownVariableType: 'none',
        reportUnknownMemberType: 'none',
        reportCallInDefaultInitializer: 'none',
        reportUnnecessaryIsInstance: 'none',
        reportUnnecessaryCast: 'none',
        reportAssertAlwaysTrue: 'warning',
        reportSelfClsParameterName: 'warning',
        reportImplicitStringConcatenation: 'none'
    };

    return diagSettings;
}

// Internal configuration options. These are derived from a combination
// of the command line and from a JSON-based config file.
export class ConfigOptions {
    constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
        this.diagnosticSettings = getDefaultDiagnosticSettings();
    }

    // Absolute directory of project. All relative paths in the config
    // are based on this path.
    projectRoot: string;

    // Path to python interpreter.
    pythonPath?: string;

    // Path to use for typeshed definitions.
    typeshedPath?: string;

    // Path to custom typings (stub) modules.
    typingsPath?: string;

    // A list of file specs to include in the analysis. Can contain
    // directories, in which case all "*.py" files within those directories
    // are included.
    include: FileSpec[] = [];

    // A list of file specs to exclude from the analysis (overriding include
    // if necessary). Can contain directories, in which case all "*.py" files
    // within those directories are included.
    exclude: FileSpec[] = [];

    // A list of file specs whose errors and warnings should be ignored even
    // if they are included in the transitive closure of included files.
    ignore: FileSpec[] = [];

    // A list of file specs that should be analyzed using "strict" mode.
    strict: FileSpec[] = [];

    // Emit verbose information to console?
    verboseOutput: boolean;

    // Perform type checking and report diagnostics only for open files?
    checkOnlyOpenFiles: boolean;

    // In the absence of type stubs, use library implementations to extract
    // type information?
    useLibraryCodeForTypes: boolean;

    //---------------------------------------------------------------
    // Diagnostics Settings

    diagnosticSettings: DiagnosticSettings;

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

    // Default venv environment. Can be overridden by executionEnvironment.
    defaultVenv?: string;

    // Default pythonVersion. Can be overridden by executionEnvironment.
    defaultPythonVersion?: PythonVersion;

    // Default pythonPlatform. Can be overridden by executionEnvironment.
    defaultPythonPlatform?: string;

    //---------------------------------------------------------------
    // Internal-only switches

    // Run additional analysis as part of test cases?
    internalTestMode?: boolean;

    // Finds the best execution environment for a given file path. The
    // specified file path should be absolute.
    // If no matching execution environment can be found, a default
    // execution environment is used.
    findExecEnvironment(filePath: string): ExecutionEnvironment {
        let execEnv = this.executionEnvironments.find(env => {
            const envRoot = ensureTrailingDirectorySeparator(
                normalizePath(combinePaths(this.projectRoot, env.root)));
            return filePath.startsWith(envRoot);
        });

        if (!execEnv) {
            execEnv = new ExecutionEnvironment(this.projectRoot,
                this.defaultPythonVersion, this.defaultPythonPlatform);
        }

        return execEnv;
    }

    // Initialize the structure from a JSON object.
    initializeFromJson(configObj: any, console: ConsoleInterface) {
        // Read the "include" entry.
        this.include = [];
        if (configObj.include !== undefined) {
            if (!Array.isArray(configObj.include)) {
                console.log(`Config "include" entry must must contain an array.`);
            } else {
                const filesList = configObj.include as string[];
                filesList.forEach((fileSpec, index) => {
                    if (typeof fileSpec !== 'string') {
                        console.log(`Index ${ index } of "include" array should be a string.`);
                    } else if (isAbsolute(fileSpec)) {
                        console.log(`Ignoring path "${ fileSpec }" in "include" array because it is not relative.`);
                    } else {
                        this.include.push(getFileSpec(this.projectRoot, fileSpec));
                    }
                });
            }
        }

        // Read the "exclude" entry.
        this.exclude = [];
        if (configObj.exclude !== undefined) {
            if (!Array.isArray(configObj.exclude)) {
                console.log(`Config "exclude" entry must contain an array.`);
            } else {
                const filesList = configObj.exclude as string[];
                filesList.forEach((fileSpec, index) => {
                    if (typeof fileSpec !== 'string') {
                        console.log(`Index ${ index } of "exclude" array should be a string.`);
                    } else if (isAbsolute(fileSpec)) {
                        console.log(`Ignoring path "${ fileSpec }" in "exclude" array because it is not relative.`);
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
                console.log(`Config "ignore" entry must contain an array.`);
            } else {
                const filesList = configObj.ignore as string[];
                filesList.forEach((fileSpec, index) => {
                    if (typeof fileSpec !== 'string') {
                        console.log(`Index ${ index } of "ignore" array should be a string.`);
                    } else if (isAbsolute(fileSpec)) {
                        console.log(`Ignoring path "${ fileSpec }" in "ignore" array because it is not relative.`);
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
                console.log(`Config "strict" entry must contain an array.`);
            } else {
                const filesList = configObj.strict as string[];
                filesList.forEach((fileSpec, index) => {
                    if (typeof fileSpec !== 'string') {
                        console.log(`Index ${ index } of "strict" array should be a string.`);
                    } else if (isAbsolute(fileSpec)) {
                        console.log(`Ignoring path "${ fileSpec }" in "strict" array because it is not relative.`);
                    } else {
                        this.strict.push(getFileSpec(this.projectRoot, fileSpec));
                    }
                });
            }
        }

        const defaultSettings = getDefaultDiagnosticSettings();

        this.diagnosticSettings = {
            // Use strict inference rules for list expressions?
            strictListInference: this._convertBoolean(
                configObj.strictListInference, DiagnosticRule.strictListInference,
                defaultSettings.strictListInference),

            // Use strict inference rules for dictionary expressions?
            strictDictionaryInference: this._convertBoolean(
                configObj.strictDictionaryInference, DiagnosticRule.strictDictionaryInference,
                defaultSettings.strictDictionaryInference),

            // Should a None default value imply that the parameter type
            // is Optional?
            strictParameterNoneValue: this._convertBoolean(
                configObj.strictParameterNoneValue, DiagnosticRule.strictParameterNoneValue,
                defaultSettings.strictParameterNoneValue),

            // Should "# type: ignore" be honored?
            enableTypeIgnoreComments: this._convertBoolean(
                configObj.enableTypeIgnoreComments, DiagnosticRule.enableTypeIgnoreComments,
                defaultSettings.enableTypeIgnoreComments),

            // Read the "reportTypeshedErrors" entry.
            reportTypeshedErrors: this._convertDiagnosticLevel(
                configObj.reportTypeshedErrors, DiagnosticRule.reportTypeshedErrors,
                defaultSettings.reportTypeshedErrors),

            // Read the "reportMissingImports" entry.
            reportMissingImports: this._convertDiagnosticLevel(
                configObj.reportMissingImports, DiagnosticRule.reportMissingImports,
                defaultSettings.reportMissingImports),

            // Read the "reportUnusedImport" entry.
            reportUnusedImport: this._convertDiagnosticLevel(
                configObj.reportUnusedImport, DiagnosticRule.reportUnusedImport,
                defaultSettings.reportUnusedImport),

            // Read the "reportUnusedClass" entry.
            reportUnusedClass: this._convertDiagnosticLevel(
                configObj.reportUnusedClass, DiagnosticRule.reportUnusedClass,
                defaultSettings.reportUnusedClass),

            // Read the "reportUnusedFunction" entry.
            reportUnusedFunction: this._convertDiagnosticLevel(
                configObj.reportUnusedFunction, DiagnosticRule.reportUnusedFunction,
                defaultSettings.reportUnusedFunction),

            // Read the "reportUnusedVariable" entry.
            reportUnusedVariable: this._convertDiagnosticLevel(
                configObj.reportUnusedVariable, DiagnosticRule.reportUnusedVariable,
                defaultSettings.reportUnusedVariable),

            // Read the "reportDuplicateImport" entry.
            reportDuplicateImport: this._convertDiagnosticLevel(
                configObj.reportDuplicateImport, DiagnosticRule.reportDuplicateImport,
                defaultSettings.reportDuplicateImport),

            // Read the "reportMissingTypeStubs" entry.
            reportMissingTypeStubs: this._convertDiagnosticLevel(
                configObj.reportMissingTypeStubs, DiagnosticRule.reportMissingTypeStubs,
                defaultSettings.reportMissingTypeStubs),

            // Read the "reportImportCycles" entry.
            reportImportCycles: this._convertDiagnosticLevel(
                configObj.reportImportCycles, DiagnosticRule.reportImportCycles,
                defaultSettings.reportImportCycles),

            // Read the "reportOptionalSubscript" entry.
            reportOptionalSubscript: this._convertDiagnosticLevel(
                configObj.reportOptionalSubscript, DiagnosticRule.reportOptionalSubscript,
                defaultSettings.reportOptionalSubscript),

            // Read the "reportOptionalMemberAccess" entry.
            reportOptionalMemberAccess: this._convertDiagnosticLevel(
                configObj.reportOptionalMemberAccess, DiagnosticRule.reportOptionalMemberAccess,
                defaultSettings.reportOptionalMemberAccess),

            // Read the "reportOptionalCall" entry.
            reportOptionalCall: this._convertDiagnosticLevel(
                configObj.reportOptionalCall, DiagnosticRule.reportOptionalCall,
                defaultSettings.reportOptionalCall),

            // Read the "reportOptionalIterable" entry.
            reportOptionalIterable: this._convertDiagnosticLevel(
                configObj.reportOptionalIterable, DiagnosticRule.reportOptionalIterable,
                defaultSettings.reportOptionalIterable),

            // Read the "reportOptionalContextManager" entry.
            reportOptionalContextManager: this._convertDiagnosticLevel(
                configObj.reportOptionalContextManager, DiagnosticRule.reportOptionalContextManager,
                defaultSettings.reportOptionalContextManager),

            // Read the "reportOptionalOperand" entry.
            reportOptionalOperand: this._convertDiagnosticLevel(
                configObj.reportOptionalOperand, DiagnosticRule.reportOptionalOperand,
                defaultSettings.reportOptionalOperand),

            // Read the "reportUntypedFunctionDecorator" entry.
            reportUntypedFunctionDecorator: this._convertDiagnosticLevel(
                configObj.reportUntypedFunctionDecorator, DiagnosticRule.reportUntypedFunctionDecorator,
                defaultSettings.reportUntypedFunctionDecorator),

            // Read the "reportUntypedClassDecorator" entry.
            reportUntypedClassDecorator: this._convertDiagnosticLevel(
                configObj.reportUntypedClassDecorator, DiagnosticRule.reportUntypedClassDecorator,
                defaultSettings.reportUntypedClassDecorator),

            // Read the "reportUntypedBaseClass" entry.
            reportUntypedBaseClass: this._convertDiagnosticLevel(
                configObj.reportUntypedBaseClass, DiagnosticRule.reportUntypedBaseClass,
                defaultSettings.reportUntypedBaseClass),

            // Read the "reportUntypedNamedTuple" entry.
            reportUntypedNamedTuple: this._convertDiagnosticLevel(
                configObj.reportUntypedNamedTuple, DiagnosticRule.reportUntypedNamedTuple,
                defaultSettings.reportUntypedNamedTuple),

            // Read the "reportPrivateUsage" entry.
            reportPrivateUsage: this._convertDiagnosticLevel(
                configObj.reportPrivateUsage, DiagnosticRule.reportPrivateUsage,
                defaultSettings.reportPrivateUsage),

            // Read the "reportConstantRedefinition" entry.
            reportConstantRedefinition: this._convertDiagnosticLevel(
                configObj.reportConstantRedefinition, DiagnosticRule.reportConstantRedefinition,
                defaultSettings.reportConstantRedefinition),

            // Read the "reportIncompatibleMethodOverride" entry.
            reportIncompatibleMethodOverride: this._convertDiagnosticLevel(
                configObj.reportIncompatibleMethodOverride, DiagnosticRule.reportIncompatibleMethodOverride,
                defaultSettings.reportIncompatibleMethodOverride),

            // Read the "reportInvalidStringEscapeSequence" entry.
            reportInvalidStringEscapeSequence: this._convertDiagnosticLevel(
                configObj.reportInvalidStringEscapeSequence, DiagnosticRule.reportInvalidStringEscapeSequence,
                defaultSettings.reportInvalidStringEscapeSequence),

            // Read the "reportUnknownParameterType" entry.
            reportUnknownParameterType: this._convertDiagnosticLevel(
                configObj.reportUnknownParameterType, DiagnosticRule.reportUnknownParameterType,
                defaultSettings.reportUnknownParameterType),

            // Read the "reportUnknownArgumentType" entry.
            reportUnknownArgumentType: this._convertDiagnosticLevel(
                configObj.reportUnknownArgumentType, DiagnosticRule.reportUnknownArgumentType,
                defaultSettings.reportUnknownArgumentType),

            // Read the "reportUnknownLambdaType" entry.
            reportUnknownLambdaType: this._convertDiagnosticLevel(
                configObj.reportUnknownLambdaType, DiagnosticRule.reportUnknownLambdaType,
                defaultSettings.reportUnknownLambdaType),

            // Read the "reportUnknownVariableType" entry.
            reportUnknownVariableType: this._convertDiagnosticLevel(
                configObj.reportUnknownVariableType, DiagnosticRule.reportUnknownVariableType,
                defaultSettings.reportUnknownVariableType),

            // Read the "reportUnknownMemberType" entry.
            reportUnknownMemberType: this._convertDiagnosticLevel(
                configObj.reportUnknownMemberType, DiagnosticRule.reportUnknownMemberType,
                defaultSettings.reportUnknownMemberType),

            // Read the "reportCallInDefaultInitializer" entry.
            reportCallInDefaultInitializer: this._convertDiagnosticLevel(
                configObj.reportCallInDefaultInitializer, DiagnosticRule.reportCallInDefaultInitializer,
                defaultSettings.reportCallInDefaultInitializer),

            // Read the "reportUnnecessaryIsInstance" entry.
            reportUnnecessaryIsInstance: this._convertDiagnosticLevel(
                configObj.reportUnnecessaryIsInstance, DiagnosticRule.reportUnnecessaryIsInstance,
                defaultSettings.reportUnnecessaryIsInstance),

            // Read the "reportUnnecessaryCast" entry.
            reportUnnecessaryCast: this._convertDiagnosticLevel(
                configObj.reportUnnecessaryCast, DiagnosticRule.reportUnnecessaryCast,
                defaultSettings.reportUnnecessaryCast),

            // Read the "reportAssertAlwaysTrue" entry.
            reportAssertAlwaysTrue: this._convertDiagnosticLevel(
                configObj.reportAssertAlwaysTrue, DiagnosticRule.reportAssertAlwaysTrue,
                defaultSettings.reportAssertAlwaysTrue),

            // Read the "reportSelfClsParameterName" entry.
            reportSelfClsParameterName: this._convertDiagnosticLevel(
                configObj.reportSelfClsParameterName, DiagnosticRule.reportSelfClsParameterName,
                defaultSettings.reportSelfClsParameterName),

            // Read the "reportImplicitStringConcatenation" entry.
            reportImplicitStringConcatenation: this._convertDiagnosticLevel(
                configObj.reportImplicitStringConcatenation, DiagnosticRule.reportImplicitStringConcatenation,
                defaultSettings.reportImplicitStringConcatenation)
        };

        // Read the "venvPath".
        this.venvPath = undefined;
        if (configObj.venvPath !== undefined) {
            if (typeof configObj.venvPath !== 'string') {
                console.log(`Config "venvPath" field must contain a string.`);
            } else {
                this.venvPath = normalizePath(combinePaths(this.projectRoot, configObj.venvPath));
            }
        }

        // Read the default "venv".
        this.defaultVenv = undefined;
        if (configObj.venv !== undefined) {
            if (typeof configObj.venv !== 'string') {
                console.log(`Config "venv" field must contain a string.`);
            } else {
                this.defaultVenv = configObj.venv;
            }
        }

        // Read the default "pythonVersion".
        this.defaultPythonVersion = undefined;
        if (configObj.pythonVersion !== undefined) {
            if (typeof configObj.pythonVersion === 'string') {
                const version = versionFromString(configObj.pythonVersion);
                if (version) {
                    this.defaultPythonVersion = version;
                } else {
                    console.log(`Config "pythonVersion" field contains unsupported version.`);
                }
            } else {
                console.log(`Config "pythonVersion" field must contain a string.`);
            }
        }

        // Read the default "pythonPlatform".
        this.defaultPythonPlatform = undefined;
        if (configObj.pythonPlatform !== undefined) {
            if (typeof configObj.pythonPlatform !== 'string') {
                console.log(`Config "pythonPlatform" field must contain a string.`);
            } else {
                this.defaultPythonPlatform = configObj.pythonPlatform;
            }
        }

        // Read the "typeshedPath".
        this.typeshedPath = undefined;
        if (configObj.typeshedPath !== undefined) {
            if (typeof configObj.typeshedPath !== 'string') {
                console.log(`Config "typeshedPath" field must contain a string.`);
            } else {
                this.typeshedPath = configObj.typeshedPath ?
                    normalizePath(combinePaths(this.projectRoot, configObj.typeshedPath)) :
                    '';
            }
        }

        // Read the "typingsPath".
        this.typingsPath = undefined;
        if (configObj.typingsPath !== undefined) {
            if (typeof configObj.typingsPath !== 'string') {
                console.log(`Config "typingsPath" field must contain a string.`);
            } else {
                this.typingsPath = normalizePath(combinePaths(this.projectRoot, configObj.typingsPath));
            }
        }

        // Read the "executionEnvironments" array. This should be done at the end
        // after we've established default values.
        this.executionEnvironments = [];
        if (configObj.executionEnvironments !== undefined) {
            if (!Array.isArray(configObj.executionEnvironments)) {
                console.log(`Config "executionEnvironments" field must contain an array.`);
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
    }

    private _convertBoolean(value: any, fieldName: string, defaultValue: boolean): boolean {
        if (value === undefined) {
            return defaultValue;
        } else if (typeof value === 'boolean') {
            return value ? true : false;
        }

        console.log(`Config "${ fieldName }" entry must be true or false.`);
        return defaultValue;
    }

    private _convertDiagnosticLevel(value: any, fieldName: string,
            defaultValue: DiagnosticLevel): DiagnosticLevel {

        if (value === undefined) {
            return defaultValue;
        } else if (typeof value === 'boolean') {
            return value ? 'error' : 'none';
        } else if (typeof value === 'string') {
            if (value === 'error' || value === 'warning' || value === 'none') {
                return value;
            }
        }

        console.log(`Config "${ fieldName }" entry must be true, false, "error", "warning" or "none".`);
        return defaultValue;
    }

    private _initExecutionEnvironmentFromJson(envObj: any, index: number,
            console: ConsoleInterface): ExecutionEnvironment | undefined {
        try {
            const newExecEnv = new ExecutionEnvironment(this.projectRoot,
                this.defaultPythonVersion, this.defaultPythonPlatform);

            // Validate the root.
            if (envObj.root && typeof envObj.root === 'string') {
                newExecEnv.root = normalizePath(combinePaths(this.projectRoot, envObj.root));
            } else {
                console.log(`Config executionEnvironments index ${ index }: missing root value.`);
            }

            // Validate the extraPaths.
            if (envObj.extraPaths) {
                if (!Array.isArray(envObj.extraPaths)) {
                    console.log(`Config executionEnvironments index ${ index }: extraPaths field must contain an array.`);
                } else {
                    const pathList = envObj.extraPaths as string[];
                    pathList.forEach((path, pathIndex) => {
                        if (typeof path !== 'string') {
                            console.log(`Config executionEnvironments index ${ index }:` +
                                ` extraPaths field ${ pathIndex } must be a string.`);
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
                        console.log(`Config executionEnvironments index ${ index } contains unsupported pythonVersion.`);
                    }
                } else {
                    console.log(`Config executionEnvironments index ${ index } pythonVersion must be a string.`);
                }
            }

            // Validate the pythonPlatform.
            if (envObj.pythonPlatform) {
                if (typeof envObj.pythonPlatform === 'string') {
                    newExecEnv.pythonPlatform = envObj.pythonPlatform;
                } else {
                    console.log(`Config executionEnvironments index ${ index } pythonPlatform must be a string.`);
                }
            }

            // Validate the venv.
            if (envObj.venv) {
                if (typeof envObj.venv === 'string') {
                    newExecEnv.venv = envObj.venv;
                } else {
                    console.log(`Config executionEnvironments index ${ index } venv must be a string.`);
                }
            }

            return newExecEnv;
        } catch {
            console.log(`Config executionEnvironments index ${ index } is not accessible.`);
        }

        return undefined;
    }
}
