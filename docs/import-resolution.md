## Import Resolution

Pyright resolves external imports based on several configuration settings. If a venvPath and venv are specified, these are used to locate the `site-packages` directory within the virtual environment.

If no venvPath is specified, Pyright falls back to the paths found in the default python interpreter’s search paths (or the python intpreter pointed to by the “python.pythonPath” setting in VS Code). Only directory-based paths are supported (as opposed to zip files or other loader packages). 

The Pyright configuration file supports “execution environment” definitions, each of which can define additional paths. These are searched in addition to the venv or PYTHONPATH directories.


## Importance of Type Stub Files

Regardless of the search path, Pyright always attempts to resolve an import with a type stub (“.pyi”) file before falling back to a python source (“.py”) file. If a type stub cannot be located for an external import, that import will be treated as a “black box” for purposes of type analysis. Any symbols imported from these modules will be of type “Unknown”, and wildcard imports (of the form `from foo import *`) will not populate the module’s namespace with specific symbol names.

Why does Pyright not attempt to determine types from imported python sources? There are several reasons.

1. Imported libraries can be quite large, so analyzing them would require significant time and computation.
2. Some libraries are thin shims on top of native (C++) libraries. Little or no type information would be inferable in these cases.
3. Some libraries override Python’s default loader logic. Static analysis is not possible in these cases.
4. Type information inferred from source files is often of low value because many types cannot be inferred correctly. Even if concrete types can be inferred, generic type definitions cannot.
5. Type analysis would expose all symbols from an imported module, even those that are not meant to be exposed by the author. Unlike many other languages, Python offers no way of differentiating between a symbol that is meant to be exported and one that isn’t.

If you’re serious about static type checking for your Python source base, it’s highly recommended that you use type stub files for all external imports. If you are unable to find a type stub for a particular library, the recommended approach is to create a custom type stub file that defines the portion of that module’s interface used by your code. Hopefully, more library authors will provide type stub files in the future.

