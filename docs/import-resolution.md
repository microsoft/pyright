# Import Resolution

## Resolution Order
If the import is relative (the module name starts with one or more dots), it resolves the import relative to the path of the importing source file.

For absolute (non-relative) imports, Pyright employs the following resolution order:

1. Try to resolve using a **stdlib typeshed stub**. If the `typeshedPath` is configured, use this instead of the typeshed stubs that are packaged with Pyright. This allows for the use of a newer or a patched version of the typeshed stdlib stubs.

2. Try to resolve using the **stubPath** as defined in the `stubPath` config entry or the `python.analysis.stubPath` setting.

3. Try to resolve using **code within the workspace**.
    
    * Try to resolve relative to the **root directory** of the execution environment. If no execution environments are specified in the config file, use the root of the workspace. For more information about execution environments, refer to the [configuration documentation](https://github.com/microsoft/pyright/blob/main/docs/configuration.md#execution-environment-options).

    * Try to resolve using any of the **extra paths** defined for the execution environment in the config file. If no execution environment applies, use the `python.analysis.extraPaths` setting. Extra paths are searched in the order in which they are provided in the config file or setting.

    * If no execution environment or extraPaths are configured, try to resolve using the **local directory `src`**. It is common for Python projects to place local source files within a directory of this name.

4. Try to resolve using **stubs or inlined types found within installed packages**. Pyright uses the configured Python environment to determine whether a package has been installed. For more details about how to configure your Python environment for Pyright, see below. If a Python environment is configured, Pyright looks in the `lib/site-packages`, `Lib/site-packages`, or `python*/site-packages` subdirectory. If no site-packages directory can be found, Pyright attempts to run the configured Python interpreter and ask it for its search paths. If no Python environment is configured, Pyright will use the default Python interpreter by invoking `python`.
    
    * For a given package, try to resolve first using a **stub package**. Stub packages, as defined in [PEP 561](https://www.python.org/dev/peps/pep-0561/#type-checker-module-resolution-order), are named the same as the original package but with “-stubs” appended.
    * Try to resolve using an **inline stub**, a “.pyi” file that ships within the package.
    * If the package contains a “py.typed” file as described in [PEP 561](https://www.python.org/dev/peps/pep-0561/), use inlined type annotations provided in “.py” files within the package.

5. Try to resolve using a **third-party typeshed** stub. If the `typeshedPath` is configured, use this instead of the typeshed stubs that are packaged with Pyright. This allows for the use of a newer or a patched version of the typeshed third-party stubs.

6. If the `python.analysis.useLibraryCodeForTypes` setting is set to true (or the `--lib` command-line argument was specified), try to resolve using the **library implementation** (“.py” file). Some “.py” files may contain partial or complete type annotations. Pyright will use type annotations that are provided and do its best to infer any missing type information. If you are using Pyright, `python.analysis.useLibraryCodeForTypes` is false by default. If you are using Pylance, it is true.



## Configuring Your Python Environment
Pyright does not require a Python environment to be configured if all imports can be resolved using local files and type stubs. If a Python environment is configured, it will attempt to use the packages installed in the `site-packages` subdirectory during import resolution.

Pyright uses the following mechanisms (in priority order) to determine which Python environment to use:

1. If a `venv` name is specified along with a `python.venvPath` setting (or a `--venv-path` command-line argument), it appends the venv name to the specified venv path.

2. If no `venv` is specified in the config file, use the `python.pythonPath` setting. This setting is defined by the VS Code Python extension and can be configured using the Python extension’s environment picker interface. More recent versions of the Python extension no longer store the selected Python environment in the `python.pythonPath` setting and instead use a storage mechanism that is private to the extension. Pyright is able to access this through an API exposed by the Python extension.

3. As a fallback, use the default Python environment (i.e. the one that is invoked when typing `python` in the shell).

## Debugging Import Resolution Problems
The import resolution mechanisms in Python are complicated, and Pyright offers many configuration options. If you are encountering problems with import resolution, Pyright provides additional logging that may help you identify the cause. To enable verbose logging, pass `--verbose` as a command-line argument or add the following entry to the config file `"verboseOutput": true`. If you are using the Pyright VS Code extension, the additional logging will appear in the Output tab (select “Pyright” from the menu). Please include this verbose logging when reporting import resolution bugs.
