## Import Resolution

### Resolution Order
If the import is relative (the module name starts with one or more dots), it resolves the import relative to the path of the importing source file.

For absolute (non-relative) imports, Pyright employs the following resolution order:

1. Try to resolve using the **stubPath** as defined in the `stubPath` config entry or the `python.analysis.stubPath` setting.

2. Try to resolve using **code within the workspace**.
    
    * Try to resolve relative to the **root directory** of the execution environment. If no execution environments are specified in the config file, use the root of the workspace. For more information about execution environments, refer to the [configuration documentation](configuration.md#execution-environment-options).

    * Try to resolve using any of the **extra paths** defined for the execution environment in the config file. If no execution environment applies, use the `python.analysis.extraPaths` setting. Extra paths are searched in the order in which they are provided in the config file or setting.

    * If no execution environment is configured, try to resolve using the **local directory `src`**. It is common for Python projects to place local source files within a directory of this name.

3. Try to resolve using **stubs or inlined types found within installed packages**. Pyright uses the configured Python environment to determine whether a package has been installed. For more details about how to configure your Python environment for Pyright, see below. If a Python environment is configured, Pyright looks in the `lib/site-packages`, `Lib/site-packages`, or `python*/site-packages` subdirectory. If no site-packages directory can be found, Pyright attempts to run the configured Python interpreter and ask it for its search paths. If no Python environment is configured, Pyright will use the default Python interpreter by invoking `python`.
    
    * For a given package, try to resolve first using a **stub package**. Stub packages, as defined in [PEP 561](https://www.python.org/dev/peps/pep-0561/#type-checker-module-resolution-order), are named the same as the original package but with “-stubs” appended.
    * Try to resolve using an **inline stub**, a “.pyi” file that ships within the package.
    * If the package contains a “py.typed” file as described in [PEP 561](https://www.python.org/dev/peps/pep-0561/), use inlined type annotations provided in “.py” files within the package.
    * If the `python.analysis.useLibraryCodeForTypes` setting is set to true, try to resolve using the **library implementation** (“.py” file). Some “.py” files may contain partial or complete type annotations. Pyright will use type annotations that are provided and do its best to infer any missing type information.

4. Try to resolve using a **stdlib typeshed stub**. If the `typeshedPath` is configured, use this instead of the typeshed stubs that are packaged with Pyright. This allows for the use of a newer or a patched version of the typeshed stdlib stubs.

5. Try to resolve using a **third-party typeshed** stub. If the `typeshedPath` is configured, use this instead of the typeshed stubs that are packaged with Pyright. This allows for the use of a newer or a patched version of the typeshed third-party stubs.



### Configuring Your Python Environment
Pyright does not require a Python environment to be configured if all imports can be resolved using local files and type stubs. If a Python environment is configured, it will attempt to use the packages installed in the `site-packages` subdirectory during import resolution.

Pyright uses the following mechanisms (in priority order) to determine which Python environment to use:

1. If a `venv` name is specified along with a `python.venvPath` setting (or a `--venvpath` command-line argument), it appends the venv name to the specified venv path. This mechanism is not recommended for most users because it is less robust than the next two options because it relies on pyright’s internal logic to determine the import resolution paths based on the virtual environment directories and files. The other two mechanisms (2 and 3 below) use the configured python interpreter to determine the import resolution paths (the value of `sys.path`).

2. Use the `python.pythonPath` setting. This setting is defined by the VS Code Python extension and can be configured using the Python extension’s environment picker interface. More recent versions of the Python extension no longer store the selected Python environment in the `python.pythonPath` setting and instead use a storage mechanism that is private to the extension. Pyright is able to access this through an API exposed by the Python extension.

3. As a fallback, use the default Python environment (i.e. the one that is invoked when typing `python` in the shell).

### Editable installs

[PEP 660](https://peps.python.org/pep-0660/) enables build backends (e.g. setuptools) to use import hooks to direct the [import machinery](https://docs.python.org/3/reference/import.html) to the package’s source files rather than putting the path to those files in a `.pth` file. Import hooks can provide an editable installation that is a more accurate representation of your real installation. However, because resolving module locations using an import hook requires executing Python code, they are not usable by Pyright and other static analysis tools. Therefore, if your editable install is configured to use import hooks, Pyright will be unable to find the corresponding source files.

If you want to use static analysis tools with an editable install, you should configure the editable install to use `.pth` files that contain file paths rather than executable lines (prefixed with `import`) that install import hooks. See your build backend’s documentation for details on how to do this. We have provided some basic information for common build backends below.

#### Setuptools
Setuptools currently supports two ways to request:
[“compat mode”](https://setuptools.pypa.io/en/latest/userguide/development_mode.html#legacy-behavior)
where a `.pth` file will be used -- a config setting and an environment variable. Another
option is [“strict mode”](https://setuptools.pypa.io/en/latest/userguide/development_mode.html#strict-editable-installs)
which uses symlinks instead.

#### Hatch/Hatchling
[Hatchling](https://hatch.pypa.io/latest/config/build/#dev-mode) uses `.pth` files by
default. It will only use import hooks if you set `dev-mode-exact` to `true`.

#### PDM
[PDM](https://pdm.fming.dev/latest/pyproject/build/#editable-build-backend) uses `.pth`
files by default. It will only use import hooks if you set `editable-backend` to
`"editables"`.

### Debugging Import Resolution Problems
The import resolution mechanisms in Python are complicated, and Pyright offers many configuration options. If you are encountering problems with import resolution, Pyright provides additional logging that may help you identify the cause. To enable verbose logging, pass `--verbose` as a command-line argument or add the following entry to the config file `"verboseOutput": true`. If you are using the Pyright VS Code extension, the additional logging will appear in the Output tab (select “Pyright” from the menu). Please include this verbose logging when reporting import resolution bugs.
