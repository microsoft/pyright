# Static type checker for Python

### Speed
Pyright is a fast type checker meant for large Python source bases. It can run in a “watch” mode and performs fast incremental updates when files are modified.

### No Dependency on Python Environment
Pyright does not require a Python environment or imported third-party packages to be installed.

### Configurability
Pyright supports [configuration files](/docs/configuration.md) that provide granular control over settings. Different “execution environments” can be associated subdirectories within a source base. Each environment can specify different module search paths, python language versions, and platform targets.

### Type Checking Features
Pyright supports:

* [PEP 484](https://www.python.org/dev/peps/pep-0484/) type hints including generics
* [PEP 526](https://www.python.org/dev/peps/pep-0526/) syntax for variable annotations
* [PEP 544](https://www.python.org/dev/peps/pep-0544/) structural subtyping
* Type inference for function return values, instance variables, class variables, and globals
* Smart type constraints that understand conditional code flow constructs like if/else statements

### Built-in Type Stubs
Pyright includes a recent copy of the stdlib type stubs from [Typeshed](https://github.com/python/typeshed). It can be configured to use another (perhaps more recent or modified) copy of the Typeshed type stubs. Of course, it also works with custom type stub files that are part of your project.


For more details, refer to the [README](https://github.com/Microsoft/pyright/blob/master/README.md) on the Pyright GitHub site.
