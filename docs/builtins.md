# Extending Builtins

The Python interpreter implicitly adds a set of symbols that are available within every module even though they are not explicitly imported. These so-called “built in” symbols include commonly-used types and functions such as “list”, “dict”, “int”, “float”, “min”, and “len”.

Pyright gains knowledge of which types are included in “builtins” scope through the type stub file `builtins.pyi`. This stub file comes from the typeshed github repo and is bundled with pyright, along with type stubs that describe other stdlib modules.

Some Python environments are customized to include additional builtins symbols. If you are using such an environment, you may want to tell Pyright about these additional symbols that are available at runtime. To do so, you can add a local type stub file called `__builtins__.pyi`. This file can be placed at the root of your project directory or at the root of the subdirectory specified in the `stubPath` setting (which is named `typings` by default).

