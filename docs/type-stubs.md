# Type Stub Files

Type stubs are “.pyi” files that specify the public interface for a library. They use a variant of the Python syntax that allows for “...” to be used in place of any implementation details. Type stubs define the public contract for the library.

## Importance of Type Stub Files

Regardless of the search path, Pyright always attempts to resolve an import with a type stub (“.pyi”) file before falling back to a python source (“.py”) file. If a type stub cannot be located for an external import, Pyright will try to use inline type information if the module is part of a package that contains a “py.typed” file (defined in [PEP 561](https://www.python.org/dev/peps/pep-0561/)). If the module is part of a package that doesn’t contain a “py.typed” file, Pyright will treat all of the symbols imported from these modules will be of type “Unknown”, and wildcard imports (of the form `from foo import *`) will not populate the module’s namespace with specific symbol names.

Why does Pyright not attempt (by default) to determine types from imported python sources? There are several reasons.

1. Imported libraries can be quite large, so analyzing them can require significant time and computation.
2. Some libraries are thin shims on top of native (C++) libraries. Little or no type information would be inferable in these cases.
3. Some libraries override Python’s default loader logic. Static analysis is not possible in these cases.
4. Type information inferred from source files is often of low value because many types cannot be inferred correctly. Even if concrete types can be inferred, generic type definitions cannot.
5. Type analysis would expose all symbols from an imported module, even those that are not meant to be exposed by the author. Unlike many other languages, Python offers no way of differentiating between a symbol that is meant to be exported and one that isn’t.

If you’re serious about static type checking for your Python source base, it’s highly recommended that you consume “py.typed” packages or use type stub files for all external imports. If you are unable to find a type stub for a particular library, the recommended approach is to create a custom type stub file that defines the portion of that module’s interface used by your code. More library maintainers have started to provide inlined types or type stub files.

## Generating Type Stubs
If you use only a few classes, methods or functions within a library, writing a type stub file by hand is feasible. For large libraries, this can become tedious and error-prone. Pyright can generate “draft” versions of type stub files for you.

To generate a type stub file from within VS Code, enable the reportMissingTypeStubs” setting in your pyrightconfig.json file or by adding a comment `# pyright: reportMissingTypeStubs=true` to individual source files. Make sure you have the target library installed in the python environment that pyright is configured to use for import resolution. Optionally specify a “stubPath” in your pyrightconfig.json file. This is where pyright will generate your type stub files. By default, the stubPath is set to "./typings".

### Generating Type Stubs in VS Code
If “reportMissingTypeStubs” is enabled, pyright will highlight any imports that have no type stub. Hover over the error message, and you will see a “Quick Fix” link. Clicking on this link will reveal a popup menu item titled “Create Type Stub For XXX”. The example below shows a missing typestub for the `django` library.

![Pyright](/docs/img/CreateTypeStub1.png)

Click on the menu item to create the type stub. Depending on the size of the library, it may take pyright tens of seconds to analyze the library and generate type stub files. Once complete, you should see a message in VS Code indicating success or failure.

![Pyright](/docs/img/CreateTypeStub2.png)

### Generating Type Stubs from Command Line
The command-line version of pyright can also be used to generate type stubs. As with the VS Code version, it must be run within the context of your configured project. Then type `pyright --createstub [import-name]`.

For example:
`pyright --createstub django`

### Cleaning Up Generated Type Stubs
Pyright can give you a head start by creating type stubs, but you will typically need to clean up the first draft, fixing various errors and omissions that pyright was not able to infer from the original library code.

A few common situations that need to be cleaned up:

1. When generating a “.pyi” file, pyright removes any imports that are not referenced. Sometimes libraries import symbols that are meant to be simply re-exported from a module even though they are not referenced internally to that module. In such cases, you will need to manually add back these imports. Pyright does not perform this import culling in `__init__.pyi` files because this re-export technique is especially common in such files.

2. Some libraries attempt to import modules within a try statement. These constructs don’t work well in type stub files because they cannot be evaluated statically. Pyright omits any try statements when creating “.pyi” files, so you may need to add back in these import statements.

3. Decorator functions are especially problematic for static type analyzers. Unless properly typed, they completely hide the signature of any class or function they are applied to. For this reason, it is highly recommended that you enable the “reportUntypedFunctionDecorator” and “reportUntypedClassDecorator” switches in pyrightconfig.json. Most decorators simply return the same function they are passed. Those can easily be annotated with a TypeVar like this:

```python
from typings import Any, Callable, TypeVar

_FuncT = TypeVar('_FuncT', bound=Callable[..., Any])

def my_decorator(*args, **kw) -> Callable[[_FuncT], _FuncT]: ...
```

