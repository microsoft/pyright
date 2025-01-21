## Import Statements

### Loader Side Effects

An import statement instructs the Python import loader to perform several operations. For example, the statement `from a.b import Foo as Bar` causes the following steps to be performed at runtime:
1. Load and execute module `a` if it hasn’t previously been loaded. Cache a reference to `a`.
2. Load and execute submodule `b` if it hasn’t previously been loaded.
3. Store a reference to submodule `b` to the variable `b` within module `a`’s namespace.
4. Look up attribute `Foo` within module `b`.
5. Assign the value of attribute `Foo` to a local variable called `Bar`.

If another source file were to subsequently execute the statement `import a`, it would observe `b` in the namespace of `a` as a side effect of step 3 in the the earlier import operation. Relying on such side effects leads to fragile code because a change in execution ordering or a modification to one module can break code in another module. Reliance on such side effects is therefore considered a bug by Pyright, which intentionally does not attempt to model such side effects.

### Implicit Module Loads

Pyright models two loader side effects that are considered safe and are commonly used in Python code.

1. If an import statement targets a multi-part module name and does not use an alias, all modules within the multi-part module name are assumed to be loaded. For example, the statement `import a.b.c` is treated as though it is three back-to-back import statements: `import a`, `import a.b` and `import a.b.c`. This allows for subsequent use of all symbols in `a`, `a.b`, and `a.b.c`. If an alias is used (e.g. `import a.b.c as abc`), this is assumed to load only module `c`. A subsequent `import a` would not provide access to `a.b` or `a.b.c`.

2. If an `__init__.py` file includes an import statement of the form `from .a import b`, the local variable `a` is assigned a reference to submodule `a`. This statement form is treated as though it is two back-to-back import statements: `from . import a` followed by `from .a import b`.


### Unsupported Loader Side Effects

All other module loader side effects are intentionally _not_ modeled by Pyright and should not be relied upon in code. Examples include:

- If one module contains the statement `import a.b` and a second module includes `import a`, the second module should not rely on the fact that `a.b` is now accessible as a side effect of the first module’s import.

- If a module contains the statement `import a.b` in the global scope and a function that includes the statement `import a` or `import a.c`, the function should not assume that it can access `a.b`. This assumption might or might not be safe depending on execution order.

- If a module contains the statements `import a.b as foo` and `import a`, code within that module should not assume that it can access `a.b`. Such an assumption might be safe depending on the relative order of the statements and the order in which they are executed, but it leads to fragile code.
