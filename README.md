![Pyright](/docs/img/PyrightLarge.png)

# Static type checker for Python

### Speed
Pyright is a fast type checker meant for large Python source bases. It can run in a “watch” mode and performs fast incremental updates when files are modified.

### No Dependency on Python Environment
Pyright does not require a Python environment or imported third-party packages to be installed.

### Configurability
Pyright supports flexible [configuration](/docs/configuration.md) that provides granular control over settings. Different “execution environments” can be specified for different subsets of a source base. Each environment can specify different module search paths, python language version, and platform target.

### Type Checking Features
Pyright supports:

* [PEP 484](https://www.python.org/dev/peps/pep-0484/) type hints including generics
* [PEP 526](https://www.python.org/dev/peps/pep-0526/) syntax for variable annotations
* [PEP 544](https://www.python.org/dev/peps/pep-0544/) structural subtyping
* Type inference for function return values, instance variables, class variables, and globals
* Smart type constraints that understand conditional code flow constructs like if/else statements

### Built-in Type Stubs
Pyright includes a recent copy of the stdlib type stubs from [Typeshed](https://github.com/python/typeshed). It can be configured to use another (perhaps more recent or modified) copy of the Typeshed type stubs. Of course, it also works with custom type stub files that are part of your project.

### Command-line or Language Service
Pyright includes both a [command-line tool](/docs/command-line.md) and a [Language Server Protocol](https://microsoft.github.io/language-server-protocol/) plugin for VS Code.



## Documentation
* [Command-line Options](/docs/command-line.md)
* [Configuration](/docs/configuration.md)
* [Import Resolution](/docs/import-resolution.md)
* [Getting Started](/docs/getting-started.md)
* [Building & Debugging](/docs/build-debug.md)
* [Pyright Internals](/docs/internals.md)


## Limitations
Pyright currently provides support for Python 3.0 and newer. There is currently no plan to support older versions.

Pyright is a work in progress. Type-checking capabilities are not fully implemented. For a list of incomplete functionality, refer to the TODO list below.


## FAQ
**Q:** What is the difference between pyright and the [Microsoft Python VS Code plugin](https://github.com/Microsoft/vscode-python)?

**A:** The Python VS Code plugin is the official Python support extension for VS Code. It is officially supported by a team of engineers at Microsoft. It supports a diverse array of features including debugging, linter plugins, type checking plugins, and much more. Pyright is focused entirely on type checking. It is a side project with no dedicated team.


**Q:** What is the difference between pyright and the [Microsoft Python Language Server](https://github.com/Microsoft/python-language-server)?

**A:** The Microsoft Python Language Server is a [language server protocol (LSP)](https://microsoft.github.io/language-server-protocol/) implementation that works with the Microsoft Python VS Code plugin, and it is officially supported by a team of Microsoft engineers. It also provides type checking capabilities. Pyright provides overlapping functionality but includes some unique features such as more configurabilty, command-line execution, and better performance.


## Installation
You can install the latest-published version of the Pyright VS Code extension directly from VS Code. Simply open the extensions panel and search for `pyright`.

The latest version of the command-line tool can be installed with npm:
`npm i pyright`

To install it globally:
`npm i -g pyright`

To run the command-line tool:
`npx pyright <options>`


## Code Structure

* client/src/extension.ts: Language Server Protocol (LSP) client entry point for VS Code extension.
* client/typeshed-fallback/: Recent copy of Typeshed type stub files for Python stdlib
* server/src/pyright.ts: Main entry point for command-line tool
* server/src/server.ts: Main entry point for LSP server
* server/src/analyzer: Modules that perform analysis passes over Python parse tree
* server/src/common: Modules  that are common to the parser and analyzer
* server/src/parser: Modules that perform tokenization and parsing of Python source
* server/src/tests: Tests for the parser and analyzer


## TODO

Pyright is a work in progress. The following functionality is not yet finished. If you would like to contribute to any of these areas, contact the maintainers of the repo.

* Type inference for generators and async functions
* Support for old-style type annotations within comments
* Address the many TODO comments in the code
* Better handling of function decorators (don't punt on type checking)
* Add more tests for type checker
* Validate that all abstract methods are overridden
* Validate parameters for magic functions
* Synthesize TypeVar param and return types for lambdas where possible
* Validate that overridden methods in subclass have same signature as base class methods
* Verify that exception classes inherit from base Exception
* Add support for inference of subclass type vars based on method parameter types declared in subclass
* Validate consistency of subclass type vars across all declared methods
* Validate await / async consistency
* Flag assignments to read-only values (None, True, False, __debug__) as errors
* Revamp support for properties - model with Descriptor protocol, detect missing setter
* Add numeric codes to diagnostics and a configuration mechanism for disabling errors by code
* Move error strings out of the main code files so they can be localized


## Contributing

This project welcomes contributions and suggestions.  Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit https://cla.microsoft.com.

When you submit a pull request, a CLA-bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., label, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.
