# Pyright Configuration

Pyright offers flexible configuration options specified in a JSON-formatted text configuration. By default, the file is called "pyrightconfig.json" and is located within the root directory of your project. Relative paths specified within the config file are relative to the config file’s location. Paths with shell variables (including `~`) are not supported.

## Master Pyright Config Options

**include** [array of paths, optional]: Paths of directories that should be included. If no paths are specified, pyright defaults to the directory that contains the config file.

**exclude** [array of paths, optional]: Paths of directories that should not be included. These override the includes directories, allowing specific subdirectories to be ignored. Note that files in the exclude paths may still be included in the analysis if they are referenced (imported) by source files that are not excluded.

**typeshedPath** [path, optional]: Path to a directory that contains typeshed type stub files. Pyright ships with an internal copy of some typeshed type stubs (those that cover the Python stdlib packages). If you want to use a full copy of the typeshed type stubs (including those for third-party packages), you can clone the [typeshed github repo](https://github.com/python/typeshed) to a local directory and reference the location with this path.

**typingsPath** [path, optional]: Path to a directory that contains custom type stubs. Each package's type stub file(s) are expected to be in its own subdirectory.

**pythonPath** [path, optional]: Path to the Python execution environment. This is used to resolve third-party modules when there is no `venvPath` specified in the config file.

**venvPath** [path, optional]: Path to a directory containing one or more subdirectories, each of which contains a virtual environment. Each execution environment (see below for details) can refer to a different virtual environment. This optional overrides the `pythonPath` option described above.

**venv** [string, optional]: Used in conjunction with the venvPath, specifies the virtual environment to use. Individual execution environments may override this setting.

**pythonVersion** [string, optional]: Specifies the version of Python that will be used to execute the source code. The version should be specified as a string in the format "M.m" where M is the major version and m is the minor (e.g. `"3.0"` or `"3.6"`). If a version is provided, pyright will generate errors if the source code makes use of language features that are not supported in that version. It will also tailor its use of type stub files, which conditionalize type definitions based on the version.

**pythonPlatform** [string, optional]: Specifies the target platform that will be used to execute the source code. Should be one of `"Windows"`, `"Darwin"` or `"Linux"`. If specified, pyright will tailor its use of type stub files, which conditionalize type definitions based on the platform.

**executionEnvironments** [array of objects, optional]: Specifies a list of execution environments (see below). Execution environments are searched from start to finish by comparing the path of a source file with the root path specified in the execution environment.


## Type Check Diagnostics Settings
The following settings control pyright's diagnostic output (warnings or errors). Unless otherwise specified, each diagnostic setting can specify a boolean value (`false` indicating that no error is generated and `true` indicating that an error is generated). Alternatively, a string value of `"none"`, `"warn"`, or `"error"` can be used to specify the diagnostic level.

**reportTypeshedErrors** [boolean or string, optional]: Generate or suppress diagnostics for typeshed type stub files. In general, these type stub files should be “clean” and generate no errors. The default value for this setting is 'none'.

**reportMissingImports** [boolean or string, optional]: Generate or suppress diagnostics for imports that have no corresponding imported python file or type stub file. The default value for this setting is 'none', although pyright can do a much better job of static type checking if type stub files are provided for all imports.

**reportMissingTypeStubs** [boolean or string, optiona]: Generate or suppress diagnostics for imports that have no corresponding type stub file (either a typeshed file or a custom type stub). The type checker requires type stubs to do its best job at analysis. The default value for this setting is 'none', although pyright can do a much better job of static type checking if type stub files are provided for all imports.


## Execution Environment Options
Pyright allows multiple “execution environments” to be defined for different portions of your source tree. For example, a subtree may be designed to run with a different PYTHONPATH or a different version of the python interpreter than the rest of the source base.

The following settings can be specified for each execution environment.

**root** [string, required]: Root path for the code that will execute within this execution environment.

**extraPaths** [array of strings, optional]: Additional search paths (in addition to the root path) that will be used when searching for packages. At runtime, these will be specified in the PYTHONPATH environment variable.

**venv** [string, optional]: The virtual environment to use for this execution environment. If not specified, the global `venv` setting is used instead.

**pythonVersion** [string, optional]: The version of Python used for this execution environment. If not specified, the global `pythonVersion` setting is used instead.

**pythonPlatform** [string, optional]: Specifies the target platform that will be used for this execution environment. If not specified, the global `pythonPlatform` setting is used instead.


# VS Code Extension Settings
Pyright will import the following settings set through VS Code. These override the values provided in the configuration file.

**python.pythonPath**: Same as the **pythonPath** setting described above.
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
      "src/experimental",
      "src/web/node_modules",
      "src/typestubs"
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
