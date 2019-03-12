![Pyright](/docs/img/PyrightLarge.png)

# Static type checker for the Python language

Pyright was created to address gaps in existing Python type checkers like [mypy](http://mypy-lang.org).
### Speed
Pyright is typically 5x or more faster than mypy and other type checkers that are written in Python. It is meant for large Python source bases. It can run in a "watch" mode and performs fast incremental updates when files are modified.

### No Dependency on Python Environment
Pyright is written in TypeScript and runs within node. It does not require a Python environment to be installed and does not rely on imported packages to be installed. This is especially useful when used with the VS Code editor, which uses node as its extension runtime.

### Configurability
Pyright supports a flexible configuration file that provides granular control over settings. Different "execution environments" can be specified for different subsets of a source base. Each environment can specify different PYTHON_PATH settings, python language version, and platform target.

### Type Checking Features
Pyright supports:

* [PEP 484](https://www.python.org/dev/peps/pep-0484/) type hints (currently missing support for generic)
* [PEP 526](https://www.python.org/dev/peps/pep-0526/) syntax for variable annotations
* [PEP 544](https://www.python.org/dev/peps/pep-0544/) structural subtyping
* Type inference for function return values, instance variables, class variables, and globals
* Smart conditional type exclusions


### Built-in Type Stubs
Pyright includes a recent copy of the stdlib type stubs from [Typeshed](https://github.com/python/typeshed). It can be configured to use another (perhaps more recent or modified) copy of the Typeshed type stubs. Of course, it also works with custom type stub files that are part of your project.

### Command-line or Language Service
Pyright includes both a command-line tool and a [Language Server Protocol](https://microsoft.github.io/language-server-protocol/) plugin for VS Code.

### Language Service Features
Pyright offers the following language service features:

* Hover tool tips that display type information
* Links to symbol definitions



## Build Instructions
1. Install [nodejs](https://nodejs.org/en/)
2. Open terminal window in main directory of cloned source
3. Execute "npm install" to download dependencies
4. Execute "npm run build"


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

* Support for generics
* Add numeric codes to diagnostics and a configuration mechanism for disabling errors by code
* Move error strings out of the main code files so they can be localized
* More complete documentation - especially for configuration options
* Add lots of tests
* Address the many TODO comments in the code
* Parameter type inference based on default value assignment
* Special-casing @abstract methods so they don't need to return the specified type
* Validate that @abstract classes are not instantiated
* Support for Python 2.7 type annotations within comments
* Validate that __init__ always has None as return type
* Validate that overridden methods in subclass have same signature as base class methods
* Verify that exception classes inherit from base Exception
* Validate await / async consitency
* Flag assignments to read-only values (None, True, False, __debug__) as errors


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
