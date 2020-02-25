# Static type checker for Python

### Speed

Pyright is a fast type checker meant for large Python source bases. It can run in a "watch" mode and performs fast incremental updates when files are modified.

### Configurability

Pyright supports [configuration files](/docs/configuration.md) that provide granular control over settings. Different "execution environments" can be associated with subdirectories within a source base. Each environment can specify different module search paths, python language versions, and platform targets.

### Type Checking Features

-   [PEP 484](https://www.python.org/dev/peps/pep-0484/) type hints including generics
-   [PEP 526](https://www.python.org/dev/peps/pep-0526/) syntax for variable annotations
-   [PEP 544](https://www.python.org/dev/peps/pep-0544/) structural subtyping
-   [PEP 589](https://www.python.org/dev/peps/pep-0589/) typed dictionaries
-   Type inference for function return values, instance variables, class variables, and globals
-   Smart type constraints that understand conditional code flow constructs like if/else statements

### VS Code Language Features

The VS Code extension supports many time-saving language features including:

-   Intelligent type completion of keywords, symbols, and import names appears when editing
-   Import statements are automatically inserted when necessary for type completions
-   Signature completion tips help when filling in arguments for a call
-   Hover over symbols to provide type information and doc strings
-   Find Definitions to quickly go to the location of a symbol's definition
-   Find References to find all references to a symbol within a code base
-   Rename Symbol to rename all references to a symbol within a code base
-   Find Symbols within the current document or within the entire workspace
-   Organize Imports command for automatically ordering imports according to PEP8 rules
-   Type stub generation for third-party libraries

### Built-in Type Stubs

Pyright includes a recent copy of the stdlib type stubs from [Typeshed](https://github.com/python/typeshed). It can be configured to use another (perhaps more recent or modified) copy of the Typeshed type stubs. Of course, it also works with custom type stub files that are part of your project.

For more details, refer to the [README](https://github.com/Microsoft/pyright/blob/master/README.md) on the Pyright GitHub site.
