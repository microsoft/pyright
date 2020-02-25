# Pyright Configuration

Pyright offers flexible configuration options specified in a JSON-formatted text configuration. By default, the file is called “pyrightconfig.json” and is located within the root directory of your project. Multi-root workspaces (“Add Folder to Workspace…”) are supported, and each workspace root can have its own “pyrightconfig.json” file.

Relative paths specified within the config file are relative to the config file’s location. Paths with shell variables (including `~`) are not supported.

## Master Pyright Config Options

**include** [array of paths, optional]: Paths of directories or files that should be included. If no paths are specified, pyright defaults to the directory that contains the config file. Paths may contain wildcard characters ** (a directory or multiple levels of directories), * (a sequence of zero or more characters), or ? (a single character). If no include paths are specified, the root path for the workspace is assumed.

**exclude** [array of paths, optional]: Paths of directories or files that should not be included. These override the includes directories, allowing specific subdirectories to be ignored. Note that files in the exclude paths may still be included in the analysis if they are referenced (imported) by source files that are not excluded. Paths may contain wildcard characters ** (a directory or multiple levels of directories), * (a sequence of zero or more characters), or ? (a single character). If no exclude paths are specified, Pyright automatically excludes the following: `**/node_modules`, `**/__pycache__`, `.venv` and `.git`.

**ignore** [array of paths, optional]: Paths of directories or files whose diagnostic output (errors and warnings) should be suppressed even if they are an included file or within the transitive closure of an included file. Paths may contain wildcard characters ** (a directory or multiple levels of directories), * (a sequence of zero or more characters), or ? (a single character).

**strict** [array of paths, optional]: Paths of directories or files that should use “strict” analysis if they are included. This is the same as manually adding a “# pyright: strict” comment. In strict mode, all type-checking rules are enabled. Paths may contain wildcard characters ** (a directory or multiple levels of directories), * (a sequence of zero or more characters), or ? (a single character).

**typeshedPath** [path, optional]: Path to a directory that contains typeshed type stub files. Pyright ships with an internal copy of some typeshed type stubs (those that cover the Python stdlib packages). If you want to use a full copy of the typeshed type stubs (including those for third-party packages), you can clone the [typeshed github repo](https://github.com/python/typeshed) to a local directory and reference the location with this path.

**typingsPath** [path, optional]: Path to a directory that contains custom type stubs. Each package's type stub file(s) are expected to be in its own subdirectory. The default value of this setting is "./typings".

**venvPath** [path, optional]: Path to a directory containing one or more subdirectories, each of which contains a virtual environment. Each execution environment (see below for details) can refer to a different virtual environment. When used in conjunction with a **venv** setting (see below), pyright will search for imports in the virtual environment’s site-packages directory rather than the paths specified in PYTHONPATH.

**venv** [string, optional]: Used in conjunction with the venvPath, specifies the virtual environment to use. Individual execution environments may override this setting.

**pythonVersion** [string, optional]: Specifies the version of Python that will be used to execute the source code. The version should be specified as a string in the format "M.m" where M is the major version and m is the minor (e.g. `"3.0"` or `"3.6"`). If a version is provided, pyright will generate errors if the source code makes use of language features that are not supported in that version. It will also tailor its use of type stub files, which conditionalizes type definitions based on the version.

**pythonPlatform** [string, optional]: Specifies the target platform that will be used to execute the source code. Should be one of `"Windows"`, `"Darwin"` or `"Linux"`. If specified, pyright will tailor its use of type stub files, which conditionalize type definitions based on the platform.

**executionEnvironments** [array of objects, optional]: Specifies a list of execution environments (see below). Execution environments are searched from start to finish by comparing the path of a source file with the root path specified in the execution environment.


## Type Check Diagnostics Settings
The following settings control pyright’s diagnostic output (warnings or errors). Unless otherwise specified, each diagnostic setting can specify a boolean value (`false` indicating that no error is generated and `true` indicating that an error is generated). Alternatively, a string value of `"none"`, `"warning"`, or `"error"` can be used to specify the diagnostic level.

**strictListInference** [boolean]: When inferring the type of a list, use strict type assumptions. For example, the expression `[1, 'a', 3.4]` could be inferred to be of type `List[Any]` or `List[Union[int, str, float]]`. If this setting is true, it will use the latter (stricter) type. The default value for this setting is 'false'.

**strictDictionaryInference** [boolean]: When inferring the type of a dictionary’s keys and values, use strict type assumptions. For example, the expression `{'a': 1, 'b': 'a'}` could be inferred to be of type `Dict[str, Any]` or `Dict[str, Union[int, str]]`. If this setting is true, it will use the latter (stricter) type. The default value for this setting is 'false'.

**strictParameterNoneValue** [boolean]: PEP 484 indicates that when a function parameter is assigned a default value of None, its type should implicitly be Optional even if the explicit type is not. When enabled, this rule requires that parameter type annotations use Optional explicitly in this case. The default value for this setting is 'false'.

**enableTypeIgnoreComments** [boolean]: PEP 484 defines support for "# type: ignore" comments. This switch enables or disables support for these comments. The default value for this setting is 'true'.

**reportTypeshedErrors** [boolean or string, optional]: Generate or suppress diagnostics for typeshed type stub files. In general, these type stub files should be “clean” and generate no errors. The default value for this setting is 'none'.

**reportMissingImports** [boolean or string, optional]: Generate or suppress diagnostics for imports that have no corresponding imported python file or type stub file. The default value for this setting is 'none', although pyright can do a much better job of static type checking if type stub files are provided for all imports.

**reportMissingTypeStubs** [boolean or string, optional]: Generate or suppress diagnostics for imports that have no corresponding type stub file (either a typeshed file or a custom type stub). The type checker requires type stubs to do its best job at analysis. The default value for this setting is 'none'. Note that there is a corresponding quick fix for this diagnostics that let you generate custom type stub to improve editing experiences.

**reportImportCycles** [boolean or string, optional]: Generate or suppress diagnostics for cyclical import chains. These are not errors in Python, but they do slow down type analysis and often hint at architectural layering issues. Generally, they should be avoided. The default value for this setting is 'none'. Note that there are import cycles in the typeshed stdlib typestub files that are ignored by this setting.

**reportUnusedImport** [boolean or string, optional]: Generate or suppress diagnostics for an imported symbol that is not referenced within that file. The default value for this setting is 'none'.

**reportUnusedClass** [boolean or string, optional]: Generate or suppress diagnostics for a class with a private name (starting with an underscore) that is not accessed. The default value for this setting is 'none'.

**reportUnusedFunction** [boolean or string, optional]: Generate or suppress diagnostics for a function or method with a private name (starting with an underscore) that is not accessed. The default value for this setting is 'none'.

**reportUnusedVariable** [boolean or string, optional]: Generate or suppress diagnostics for a variable that is not accessed. The default value for this setting is 'none'.

**reportDuplicateImport** [boolean or string, optional]: Generate or suppress diagnostics for an imported symbol or module that is imported more than once. The default value for this setting is 'none'.

**reportOptionalSubscript** [boolean or string, optional]: Generate or suppress diagnostics for an attempt to subscript (index) a variable with an Optional type. The default value for this setting is 'none'.

**reportOptionalMemberAccess** [boolean or string, optional]: Generate or suppress diagnostics for an attempt to access a member of a variable with an Optional type. The default value for this setting is 'none'.

**reportOptionalCall** [boolean or string, optional]: Generate or suppress diagnostics for an attempt to call a variable with an Optional type. The default value for this setting is 'none'.

**reportOptionalIterable** [boolean or string, optional]: Generate or suppress diagnostics for an attempt to use an Optional type as an iterable value (e.g. within a `for` statement). The default value for this setting is 'none'.

**reportOptionalContextManager** [boolean or string, optional]: Generate or suppress diagnostics for an attempt to use an Optional type as a context manager (as a parameter to a `with` statement). The default value for this setting is 'none'.

**reportOptionalOperand** [boolean or string, optional]: Generate or suppress diagnostics for an attempt to use an Optional type as an operand to a binary or unary operator (like '+', '==', 'or', 'not'). The default value for this setting is 'none'.

**reportUntypedFunctionDecorator** [boolean or string, optional]: Generate or suppress diagnostics for function decorators that have no type annotations. These obscure the function type, defeating many type analysis features. The default value for this setting is 'none'.

**reportUntypedClassDecorator** [boolean or string, optional]: Generate or suppress diagnostics for class decorators that have no type annotations. These obscure the class type, defeating many type analysis features. The default value for this setting is 'none'.

**reportUntypedBaseClass** [boolean or string, optional]: Generate or suppress diagnostics for base classes whose type cannot be determined statically. These obscure the class type, defeating many type analysis features. The default value for this setting is 'none'.

**reportUntypedNamedTuple** [boolean or string, optional]: Generate or suppress diagnostics when “namedtuple” is used rather than “NamedTuple”. The former contains no type information, whereas the latter does. The default value for this setting is 'none'.

**reportPrivateUsage** [boolean or string, optional]: Generate or suppress diagnostics for incorrect usage of private or protected variables or functions. Protected class members begin with a single underscore (“_”) and can be accessed only by subclasses. Private class members begin with a double underscore but do not end in a double underscore and can be accessed only within the declaring class. Variables and functions declared outside of a class are considered private if their names start with either a single or double underscore, and they cannot be accessed outside of the declaring module. The default value for this setting is 'none'.

**reportConstantRedefinition** [boolean or string, optional]: Generate or suppress diagnostics for attempts to redefine variables whose names are all-caps with underscores and numerals. The default value for this setting is 'none'.

**reportIncompatibleMethodOverride** [boolean or string, optional]: Generate or suppress diagnostics for methods that override a method of the same name in a base class in an incompatible manner (different number of parameters, different parameter types, or a different return type). The default value for this setting is 'none'.

**reportInvalidStringEscapeSequence** [boolean or string, optional]: Generate or suppress diagnostics for invalid escape sequences used within string literals. The Python specification indicates that such sequences will generate a syntax error in future versions. The default value for this setting is 'warning'.

**reportUnknownParameterType** [boolean or string, optional]: Generate or suppress diagnostics for input or return parameters for functions or methods that have an unknown type. The default value for this setting is 'none'.

**reportUnknownArgumentType** [boolean or string, optional]: Generate or suppress diagnostics for call arguments for functions or methods that have an unknown type. The default value for this setting is 'none'.

**reportUnknownLambdaType** [boolean or string, optional]: Generate or suppress diagnostics for input or return parameters for lambdas that have an unknown type. The default value for this setting is 'none'.

**reportUnknownVariableType** [boolean or string, optional]: Generate or suppress diagnostics for variables that have an unknown type. The default value for this setting is 'none'.

**reportUnknownMemberType** [boolean or string, optional]: Generate or suppress diagnostics for class or instance variables that have an unknown type. The default value for this setting is 'none'.

**reportCallInDefaultInitializer** [boolean or string, optional]: Generate or suppress diagnostics for function calls within a default value initialization expression. Such calls can mask expensive operations that are performed at module initialization time. The default value for this setting is 'none'.

**reportUnnecessaryIsInstance** [boolean or string, optional]: Generate or suppress diagnostics for 'isinstance' or 'issubclass' calls where the result is statically determined to be always true or always false. Such calls are often indicative of a programming error. The default value for this setting is 'none'.

**reportUnnecessaryCast** [boolean or string, optional]: Generate or suppress diagnostics for 'cast' calls that are statically determined to be unnecessary. Such calls are sometimes indicative of a programming error. The default value for this setting is 'none'.

**reportAssertAlwaysTrue** [boolean or string, optional]: Generate or suppress diagnostics for 'assert' statement that will provably always assert. This can be indicative of a programming error. The default value for this setting is 'warning'.

**reportSelfClsParameterName** [boolean or string, optional]: Generate or suppress diagnostics for a missing or misnamed “self” parameter in instance methods and “cls” parameter in class methods. Instance methods in metaclasses (classes that derive from “type”) are allowed to use “cls” for instance methods. The default value for this setting is 'warning'.

**reportImplicitStringConcatenation** [boolean or string, optional]: Generate or suppress diagnostics for two or more string literals that follow each other, indicating an implicit concatenation. This is considered a bad practice and often masks bugs such as missing commas. The default value for this setting is 'none'.


## Execution Environment Options
Pyright allows multiple “execution environments” to be defined for different portions of your source tree. For example, a subtree may be designed to run with different import search paths or a different version of the python interpreter than the rest of the source base.

The following settings can be specified for each execution environment.

**root** [string, required]: Root path for the code that will execute within this execution environment.

**extraPaths** [array of strings, optional]: Additional search paths (in addition to the root path) that will be used when searching for packages. At runtime, these will be specified in the PYTHONPATH environment variable.

**venv** [string, optional]: The virtual environment to use for this execution environment. If not specified, the global `venv` setting is used instead.

**pythonVersion** [string, optional]: The version of Python used for this execution environment. If not specified, the global `pythonVersion` setting is used instead.

**pythonPlatform** [string, optional]: Specifies the target platform that will be used for this execution environment. If not specified, the global `pythonPlatform` setting is used instead.


# VS Code Extension Settings
Pyright will import the following settings set through VS Code. These override the values provided in the configuration file.

**python.venvPath**: Same as the **venvPath** setting described above.

**python.analysis.typeshedPaths**: An array of typeshed paths to search. Pyright supports only one such path. If provided in the VS Code setting, the first entry overrides the **typeshedPath** configuration file entry described above.


## Sample Config File
The following is an example of a pyright config file:
```json
{
  "include": [
    "src"
  ],
  
  "exclude": [
    "**/node_modules",
    "**/__pycache__",
    "src/experimental",
    "src/web/node_modules",
    "src/typestubs"
  ],

  "ignore": [
    "src/oldstuff"
  ],

  "typingsPath": "src/typestubs",
  "venvPath": "/home/foo/.venvs",

  "reportTypeshedErrors": false,
  "reportMissingImports": true,
  "reportMissingTypeStubs": false,

  "pythonVersion": "3.6",
  "pythonPlatform": "Linux",

  "executionEnvironments": [
    {
      "root": "src/web",
      "pythonVersion": "3.5",
      "pythonPlatform": "Windows",
      "extraPaths": [
        "src/service_libs"
      ]
    },
    {
      "root": "src/sdk",
      "pythonVersion": "3.0",
      "extraPaths": [
        "src/backend"
      ],
      "venv": "venv_bar"
    },
    {
      "root": "src/tests",
      "extraPaths": [
        "src/tests/e2e",
        "src/sdk"
      ]
    },
    {
      "root": "src"
    }
  ]
}
```
