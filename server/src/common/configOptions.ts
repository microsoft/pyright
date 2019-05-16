/*
* configOptions.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Class that holds the configuration options for the analyzer.
*/

import { ConsoleInterface } from './console';
import { combinePaths, ensureTrailingDirectorySeparator, getDirectoryPath,
    normalizePath } from './pathUtils';
import { LatestStablePythonVersion, PythonVersion, versionFromString } from './pythonVersion';

export class ExecutionEnvironment {
    // Default to "." which indicates every file in the project.
    constructor(root: string, defaultPythonVersion?: PythonVersion, defaultPythonPlatform?: string) {
        this.root = root;
        this.pythonVersion = defaultPythonVersion || LatestStablePythonVersion;
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

// Internal configuration options. These are derived from a combination
// of the command line and from a JSON-based config file.
export class ConfigOptions {
    constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
    }

    // Absolute directory of project. All relative paths in the config
    // are based on this path.
    projectRoot: string;

    // Path to python intepreter.
    pythonPath?: string;

    // Path to use for typeshed definitions.
    typeshedPath?: string;

    // Path to custom typings (stub) modules.
    typingsPath?: string;

    // A list of file specs to include in the analysis. Can contain
    // directories, in which case all "*.py" files within those directories
    // are included.
    include: string[] = [];

    // A list of file specs to exclude from the analysis (overriding include
    // if necessary). Can contain directories, in which case all "*.py" files
    // within those directories are included.
    exclude: string[] = [];

    // A list of file sepcs whose errors and warnings should be ignored even
    // if they are included in the transitive closure of included files.
    ignore: string[] = [];

    // Emit verbose information to console?
    verboseOutput: boolean;

    //---------------------------------------------------------------
    // Diagnostics Settings

    // Use strict inference rules for list expressions?
    strictListInference = false;

    // Use strict inference rules for dictionary expressions?
    strictDictionaryInference = false;

    // Report diagnostics in typeshed files?
    reportTypeshedErrors: DiagnosticLevel = 'none';

    // Report missing imports?
    reportMissingImports: DiagnosticLevel = 'error';

    // Report missing type stub files?
    reportMissingTypeStubs: DiagnosticLevel = 'none';

    // Report cycles in import graph?
    reportImportCycles: DiagnosticLevel = 'none';

    // Report attempts to subscript (index) an Optional type?
    reportOptionalSubscript: DiagnosticLevel = 'none';

    // Report attempts to access members on a Optional type?
    reportOptionalMemberAccess: DiagnosticLevel = 'none';

    // Report attempts to call a Optional type?
    reportOptionalCall: DiagnosticLevel = 'none';

    // Report attempts to use an Optional type as an iterable?
    reportOptionalIterable: DiagnosticLevel = 'none';

    // Report attempts to use an Optional type in a "with" statement?
    reportOptionalContextManager: DiagnosticLevel = 'none';

    // Report attempts to use an Optional type in a binary or unary operation.
    reportOptionalOperand: DiagnosticLevel = 'none';

    // Report untyped function decorators that obscure the function type?
    reportUntypedFunctionDecorator: DiagnosticLevel = 'none';

    // Report untyped class decorators that obscure the class type?
    reportUntypedClassDecorator: DiagnosticLevel = 'none';

    // Report untyped base class that obscure the class type?
    reportUntypedBaseClass: DiagnosticLevel = 'none';

    // Report use of untyped namedtuple factory method?
    reportUntypedNamedTuple: DiagnosticLevel = 'none';

    // Report usage of private variables and functions outside of
    // the owning class or module?
    reportPrivateUsage: DiagnosticLevel = 'none';

    // Report attempts to redefine variables that are in all-caps.
    reportConstantRedefinition: DiagnosticLevel = 'none';

    // Report usage of method override that is incomatlble with
    // the base class method of the same name?
    reportIncompatibleMethodOverride: DiagnosticLevel = 'none';

    // Report usage of invalid escape sequences in string literals?
    reportInvalidStringEscapeSequence: DiagnosticLevel = 'warning';

    // Report usage of unknown input or return parameters?
    reportUnknownParameterType: DiagnosticLevel = 'none';

    // Report usage of unknown input or return parameters?
    reportUnknownVariableType: DiagnosticLevel = 'none';

    // Report usage of unknown input or return parameters?
    reportUnknownMemberType: DiagnosticLevel = 'none';

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
            let envRoot = ensureTrailingDirectorySeparator(
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
                let filesList = configObj.include as string[];
                filesList.forEach((fileSpec, index) => {
                    if (typeof fileSpec !== 'string') {
                        console.log(`Index ${ index } of "include" array should be a string.`);
                    } else {
                        this.include.push(this._normalizeFileSpec(fileSpec));
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
                let filesList = configObj.exclude as string[];
                filesList.forEach((fileSpec, index) => {
                    if (typeof fileSpec !== 'string') {
                        console.log(`Index ${ index } of "exclude" array should be a string.`);
                    } else {
                        this.exclude.push(this._normalizeFileSpec(fileSpec));
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
                let filesList = configObj.ignore as string[];
                filesList.forEach((fileSpec, index) => {
                    if (typeof fileSpec !== 'string') {
                        console.log(`Index ${ index } of "ignore" array should be a string.`);
                    } else {
                        this.ignore.push(this._normalizeFileSpec(fileSpec));
                    }
                });
            }
        }

        // Use strict inference rules for list expressions?
        this.strictListInference = this._convertBoolean(
            configObj.strictListInference, 'strictListInference', false);

        // Use strict inference rules for dictionary expressions?
        this.strictDictionaryInference = this._convertBoolean(
            configObj.strictDictionaryInference, 'strictDictionaryInference', false);

        // Read the "reportTypeshedErrors" entry.
        this.reportTypeshedErrors = this._convertDiagnosticLevel(
            configObj.reportTypeshedErrors, 'reportTypeshedErrors', 'none');

        // Read the "reportMissingImports" entry.
        this.reportMissingImports = this._convertDiagnosticLevel(
            configObj.reportMissingImports, 'reportMissingImports', 'error');

        // Read the "reportMissingTypeStubs" entry.
        this.reportMissingTypeStubs = this._convertDiagnosticLevel(
            configObj.reportMissingTypeStubs, 'reportMissingTypeStubs', 'none');

        // Read the "reportImportCycles" entry.
        this.reportImportCycles = this._convertDiagnosticLevel(
            configObj.reportImportCycles, 'reportImportCycles', 'none');

        // Read the "reportOptionalSubscript" entry.
        this.reportOptionalSubscript = this._convertDiagnosticLevel(
            configObj.reportOptionalSubscript, 'reportOptionalSubscript', 'none');

        // Read the "reportOptionalMemberAccess" entry.
        this.reportOptionalMemberAccess = this._convertDiagnosticLevel(
            configObj.reportOptionalMemberAccess, 'reportOptionalMemberAccess', 'none');

        // Read the "reportOptionalCall" entry.
        this.reportOptionalCall = this._convertDiagnosticLevel(
            configObj.reportOptionalCall, 'reportOptionalCall', 'none');

        // Read the "reportOptionalIterable" entry.
        this.reportOptionalIterable = this._convertDiagnosticLevel(
            configObj.reportOptionalIterable, 'reportOptionalIterable', 'none');

        // Read the "reportOptionalContextManager" entry.
        this.reportOptionalContextManager = this._convertDiagnosticLevel(
            configObj.reportOptionalContextManager, 'reportOptionalContextManager', 'none');

        // Read the "reportOptionalOperand" entry.
        this.reportOptionalOperand = this._convertDiagnosticLevel(
            configObj.reportOptionalOperand, 'reportOptionalOperand', 'none');

        // Read the "reportUntypedFunctionDecorator" entry.
        this.reportUntypedFunctionDecorator = this._convertDiagnosticLevel(
            configObj.reportUntypedFunctionDecorator, 'reportUntypedFunctionDecorator', 'none');

        // Read the "reportUntypedClassDecorator" entry.
        this.reportUntypedClassDecorator = this._convertDiagnosticLevel(
            configObj.reportUntypedClassDecorator, 'reportUntypedClassDecorator', 'none');

        // Read the "reportUntypedBaseClass" entry.
        this.reportUntypedBaseClass = this._convertDiagnosticLevel(
            configObj.reportUntypedBaseClass, 'reportUntypedBaseClass', 'none');

        // Read the "reportUntypedNamedTuple" entry.
        this.reportUntypedNamedTuple = this._convertDiagnosticLevel(
            configObj.reportUntypedNamedTuple, 'reportUntypedNamedTuple', 'none');

        // Read the "reportPrivateUsage" entry.
        this.reportPrivateUsage = this._convertDiagnosticLevel(
            configObj.reportPrivateUsage, 'reportPrivateUsage', 'none');

        // Read the "reportConstantRedefinition" entry.
        this.reportConstantRedefinition = this._convertDiagnosticLevel(
            configObj.reportConstantRedefinition, 'reportConstantRedefinition', 'none');

        // Read the "reportIncompatibleMethodOverride" entry.
        this.reportIncompatibleMethodOverride = this._convertDiagnosticLevel(
            configObj.reportIncompatibleMethodOverride, 'reportIncompatibleMethodOverride', 'none');

        // Read the "reportInvalidStringEscapeSequence" entry.
        this.reportInvalidStringEscapeSequence = this._convertDiagnosticLevel(
            configObj.reportInvalidStringEscapeSequence, 'reportInvalidStringEscapeSequence', 'warning');

        // Read the "reportUnknownParameterType" entry.
        this.reportUnknownParameterType = this._convertDiagnosticLevel(
            configObj.reportUnknownParameterType, 'reportUnknownParameterType', 'none');

        // Read the "reportUnknownVariableType" entry.
        this.reportUnknownVariableType = this._convertDiagnosticLevel(
            configObj.reportUnknownVariableType, 'reportUnknownVariableType', 'none');

        // Read the "reportUnknownMemberType" entry.
        this.reportUnknownMemberType = this._convertDiagnosticLevel(
            configObj.reportUnknownMemberType, 'reportUnknownMemberType', 'none');

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
                let version = versionFromString(configObj.pythonVersion);
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
                this.typeshedPath = configObj.typeshedPath;
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
                let execEnvironments = configObj.executionEnvironments as ExecutionEnvironment[];
                execEnvironments.forEach((env, index) => {
                    let execEnv = this._initExecutionEnvironmentFromJson(env, index, console);
                    if (execEnv) {
                        this.executionEnvironments.push(execEnv);
                    }
                });
            }
        }
    }

    private _normalizeFileSpec(fileSpec: string): string {
        let absolutePath = normalizePath(combinePaths(this.projectRoot, fileSpec));
        if (!absolutePath.endsWith('.py') && !absolutePath.endsWith('.pyi')) {
            absolutePath = ensureTrailingDirectorySeparator(absolutePath);
        }
        return absolutePath;
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
            let newExecEnv = new ExecutionEnvironment(this.projectRoot,
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
                    let pathList = envObj.extraPaths as string[];
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
                    let version = versionFromString(envObj.pythonVersion);
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
                if (typeof envObj.root === 'string') {
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
