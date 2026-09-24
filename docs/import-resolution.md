## Import Resolution

### Resolution Order
If the import is relative (the module name starts with one or more dots), it resolves the import relative to the path of the importing source file.

For absolute (non-relative) imports, Pyright employs the following resolution order:

1. Try to resolve using the **stubPath** as defined in the `stubPath` config entry or the `python.analysis.stubPath` setting.

2. Try to resolve using **code within the workspace**.
    
    * Try to resolve relative to the **root directory** of the execution environment. If no execution environments are specified in the config file, use the root of the workspace. For more information about execution environments, refer to the [configuration documentation](configuration.md#execution-environment-options).

    * Try to resolve using any of the **extra paths** defined for the execution environment in the config file. If no execution environment applies, use the `python.analysis.extraPaths` setting. Extra paths are searched in the order in which they are provided in the config file or setting. Extra path entries may contain glob patterns, which are expanded to matching directories; see [Extra path glob expansion](#extra-path-glob-expansion).

    * If no execution environment is configured, try to resolve using the **local directory `src`**. It is common for Python projects to place local source files within a directory of this name.

3. Try to resolve using **stubs or inlined types found within installed packages**. Pyright uses the configured Python environment to determine whether a package has been installed. For more details about how to configure your Python environment for Pyright, see below. If a Python environment is configured, Pyright looks in the `lib/site-packages`, `Lib/site-packages`, or `python*/site-packages` subdirectory. If no site-packages directory can be found, Pyright attempts to run the configured Python interpreter and ask it for its search paths. If no Python environment is configured, Pyright will use the default Python interpreter by invoking `python`.
    
    * For a given package, try to resolve first using a **stub package**. Stub packages, as defined in [PEP 561](https://www.python.org/dev/peps/pep-0561/#type-checker-module-resolution-order), are named the same as the original package but with “-stubs” appended.
    * Try to resolve using an **inline stub**, a “.pyi” file that ships within the package.
    * If the package contains a “py.typed” file as described in [PEP 561](https://www.python.org/dev/peps/pep-0561/), use inlined type annotations provided in “.py” files within the package.
    * If the `python.analysis.useLibraryCodeForTypes` setting is set to true, try to resolve using the **library implementation** (“.py” file). Some “.py” files may contain partial or complete type annotations. Pyright will use type annotations that are provided and do its best to infer any missing type information.

4. Try to resolve using a **stdlib typeshed stub**. If the `typeshedPath` is configured, use this instead of the typeshed stubs that are packaged with Pyright. This allows for the use of a newer or a patched version of the typeshed stdlib stubs.

5. Try to resolve using a **third-party typeshed** stub. If the `typeshedPath` is configured, use this instead of the typeshed stubs that are packaged with Pyright. This allows for the use of a newer or a patched version of the typeshed third-party stubs.

6. For an absolute import, if all of the above attempts fail, attempt to import a module from the same directory as the importing file and parent directories that are also children of the root workspace. This accommodates cases where it is assumed that a Python script will be executed from one of these subdirectories rather than from the root directory.


### Extra Path Glob Expansion
Each entry in `extraPaths` may contain glob wildcards. This applies to every source of extra paths: the top-level `extraPaths` config entry, an execution environment's `extraPaths`, and the `python.analysis.extraPaths` setting. Glob entries are expanded to the set of matching directories before import resolution, using the same wildcard syntax as `include`, `exclude`, and `ignore`:

- `*` matches any sequence of characters within a single path segment.
- `**` matches any number of characters, including path separators (a recursive directory wildcard).
- `?` matches a single character.

Only **directories** are matched; a file is never added as an extra path. An entry that contains no wildcard character is treated as a literal path and, as before, is not required to exist. An empty or whitespace-only entry is ignored. Relative entries are resolved against the same base directory as literal extra paths (the config file's directory for config entries, or the project root for the setting).

Expansion is deterministic and preserves the order-sensitive contract of `extraPaths` (extra paths are searched in the order in which they are provided):

1. **In-place expansion.** A glob entry is replaced, at its position in the list, by the directories it matches, sorted in ascending order by their path. The comparison is case-sensitive and ordinal (paths are compared by Unicode code point after normalizing to NFC), so it is independent of the user's locale, culture, Unicode normalization form, and operating system, and the expanded order is identical everywhere. Locale-aware collation is deliberately not used.
2. **Precedence on duplicates.** When the same directory would be produced more than once, an explicit (non-wildcard) entry always wins and keeps its own position, even relative to an earlier glob; among glob entries, the earlier glob in the list wins. The losing duplicate is dropped. Two literal entries that resolve to the same path keep the first occurrence.

The comparison used for de-duplication drops a trailing path separator and is **case-sensitive**: two entries that differ only in case are treated as distinct, because case affects the resolved module name. Symbolic links are **not** resolved — the matched path is used as-is so that it maps to the intended module name — but symbolic-link cycles are guarded against during expansion, the same way they are when scanning `include` file specs.

A glob that matches no directory contributes nothing; this is not an error. The fully resolved extra paths, after expansion, are written to the log when verbose logging is enabled.

Glob expansion applies only to local (`file`-scheme) paths. An entry on a virtual or non-`file` filesystem is treated as a literal path (its wildcards are not expanded), so glob syntax has no effect on virtual workspaces.

De-duplication and ordering are computed independently for each resolved `extraPaths` list. Because an execution environment's `extraPaths` overrides (rather than merges with) the default `extraPaths`, expansion runs on whichever list applies to a given file.

For example, consider this directory layout:

```
libs/
├── auth/src/
├── core/src/
└── shared/src/
```

Given `extraPaths` of `["libs/shared/src", "libs/*/src"]`:

- `libs/shared/src` is a literal entry, so it keeps its position at the front of the list.
- `libs/*/src` expands, in ascending order, to `libs/auth/src`, `libs/core/src`, and `libs/shared/src`, but `libs/shared/src` is dropped from the expansion because the literal entry already owns that path.

The resulting order is `libs/shared/src`, `libs/auth/src`, `libs/core/src`.

When two globs match the same directory, the earlier glob keeps it. For example, over a tree that contains `external/pip310_numpy/site-packages`, the list `["external/pip310_*/site-packages", "external/pip3??_numpy/site-packages"]` contributes that directory from the first glob and drops it from the second.


### Configuring Your Python Environment
Pyright does not require a Python environment to be configured if all imports can be resolved using local files and type stubs. If a Python environment is configured, it will attempt to use the packages installed in the `site-packages` subdirectory during import resolution.

Pyright uses the following mechanisms (in priority order) to determine which Python environment to use:

1. If a `venv` name is specified along with a `python.venvPath` setting (or a `--venvpath` command-line argument), it appends the venv name to the specified venv path. This mechanism is not recommended for most users because it is less robust than the next two options because it relies on pyright’s internal logic to determine the import resolution paths based on the virtual environment directories and files. The other two mechanisms (2 and 3 below) use the configured python interpreter to determine the import resolution paths (the value of `sys.path`).

2. Use the `python.pythonPath` setting. This setting is defined by the VS Code Python extension and can be configured using the Python extension’s environment picker interface. More recent versions of the Python extension no longer store the selected Python environment in the `python.pythonPath` setting and instead use a storage mechanism that is private to the extension. Pyright is able to access this through an API exposed by the Python extension.

3. As a fallback, use the default Python environment (i.e. the one that is invoked when typing `python` in the shell).

### Editable installs
If you want to use static analysis tools with an editable install, you should configure the editable install to use `.pth` files that contain file paths rather than executable lines (prefixed with `import`) that install import hooks.

Import hooks can provide an editable installation that is a more accurate representation of your real installation. However, because resolving module locations using an import hook requires executing Python code, they are not usable by Pyright and other static analysis tools. Therefore, if your editable install is configured to use import hooks, Pyright will be unable to find the corresponding source files.

Notably, setuptools uses import hooks by default. For setuptools-based editable installs to be usable with Pyright, setuptools needs to be configured to use path-based `.pth` files through the build frontend.

#### pip with setuptools
`pip` with `setuptools` supports two ways to avoid import hooks:
- [compat mode](https://setuptools.pypa.io/en/latest/userguide/development_mode.html#legacy-behavior)
- [strict mode](https://setuptools.pypa.io/en/latest/userguide/development_mode.html#strict-editable-installs)

#### uv with setuptools
When using uv with setuptools, uv can be [configured](https://docs.astral.sh/uv/reference/settings/#config-settings) to avoid import hooks:

```toml
[tool.uv]
config-settings = { editable_mode = "compat" }
```

The `uv_build` backend always uses path-based `.pth` files.

#### Hatch / Hatchling
[Hatchling](https://hatch.pypa.io/latest/config/build/#dev-mode) uses path-based `.pth` files by
default. It will only use import hooks if you set `dev-mode-exact` to `true`.

#### PDM
[PDM](https://pdm.fming.dev/latest/pyproject/build/#editable-build-backend) uses path-based `.pth`
files by default. It will only use import hooks if you set `editable-backend` to
`"editables"`.

### Debugging Import Resolution Problems
The import resolution mechanisms in Python are complicated, and Pyright offers many configuration options. If you are encountering problems with import resolution, Pyright provides additional logging that may help you identify the cause. To enable verbose logging, pass `--verbose` as a command-line argument or add the following entry to the config file `"verboseOutput": true`. If you are using the Pyright VS Code extension, the additional logging will appear in the Output tab (select “Pyright” from the menu). Please include this verbose logging when reporting import resolution bugs.
