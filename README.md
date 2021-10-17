![Pyright](/docs/img/PyrightLarge.png)

# Static type checker for Python

### Speed
Pyright is a fast type checker meant for large Python source bases. It can run in a “watch” mode and performs fast incremental updates when files are modified.

### Configurability
Pyright supports [configuration files](/docs/configuration.md) that provide granular control over settings. Different “execution environments” can be associated with subdirectories within a source base. Each environment can specify different module search paths, python language versions, and platform targets.

### Type Checking Features
* [PEP 484](https://www.python.org/dev/peps/pep-0484/) type hints including generics
* [PEP 487](https://www.python.org/dev/peps/pep-0487/) simpler customization of class creation
* [PEP 526](https://www.python.org/dev/peps/pep-0526/) syntax for variable annotations
* [PEP 544](https://www.python.org/dev/peps/pep-0544/) structural subtyping
* [PEP 561](https://www.python.org/dev/peps/pep-0561/) distributing and packaging type information
* [PEP 563](https://www.python.org/dev/peps/pep-0563/) postponed evaluation of annotations
* [PEP 570](https://www.python.org/dev/peps/pep-0570/) position-only parameters
* [PEP 585](https://www.python.org/dev/peps/pep-0585/) type hinting generics in standard collections
* [PEP 586](https://www.python.org/dev/peps/pep-0586/) literal types
* [PEP 589](https://www.python.org/dev/peps/pep-0589/) typed dictionaries
* [PEP 591](https://www.python.org/dev/peps/pep-0591/) final qualifier
* [PEP 593](https://www.python.org/dev/peps/pep-0593/) flexible variable annotations
* [PEP 604](https://www.python.org/dev/peps/pep-0604/) complementary syntax for unions
* [PEP 612](https://www.python.org/dev/peps/pep-0612/) parameter specification variables
* [PEP 613](https://www.python.org/dev/peps/pep-0613/) explicit type aliases
* [PEP 635](https://www.python.org/dev/peps/pep-0635/) structural pattern matching
* [PEP 646](https://www.python.org/dev/peps/pep-0646/) variadic generics
* [PEP 647](https://www.python.org/dev/peps/pep-0647/) user-defined type guards
* [PEP 655](https://www.python.org/dev/peps/pep-0655/) required typed dictionary items
* Type inference for function return values, instance variables, class variables, and globals
* Type guards that understand conditional code flow constructs like if/else statements

### VS Code Integration
Pyright ships as both a command-line tool and a VS Code extension that provides many powerful features that help improve programming efficiency.

### VS Code Language Features
The VS Code extension supports many time-saving language features including:

* Intelligent type completion of keywords, symbols, and import names appears when editing
* Import statements are automatically inserted when necessary for type completions
* Signature completion tips help when filling in arguments for a call
* Hover over symbols to provide type information and doc strings
* Find Definitions to quickly go to the location of a symbol’s definition
* Find References to find all references to a symbol within a code base
* Rename Symbol to rename all references to a symbol within a code base
* Find Symbols within the current document or within the entire workspace
* View call hierarchy information — calls made within a function and places where a function is called
* Organize Imports command for automatically ordering imports according to PEP8 rules
* Type stub generation for third-party libraries

### Built-in Type Stubs
Pyright includes a recent copy of the stdlib type stubs from [Typeshed](https://github.com/python/typeshed). It can be configured to use another (perhaps more recent or modified) copy of the Typeshed type stubs. Of course, it also works with custom type stub files that are part of your project.

### Command-line Tool or Visual Studio Code Extension
Pyright includes both a [command-line tool](/docs/command-line.md) and an [extension for Visual Studio Code](https://marketplace.visualstudio.com/items?itemName=ms-pyright.pyright) that implements the [Language Server Protocol](https://microsoft.github.io/language-server-protocol/).

For rich Python editing and debugging capabilities with Visual Studio Code, be sure to also install the official [Microsoft Python extension for Visual Studio Code](https://marketplace.visualstudio.com/itemdetails?itemName=ms-python.python) as Pyright only provides syntax and type checking.


## Installation
### VS Code Extension
For most VS Code users, we recommend using the Pylance extension rather than Pyright. Pylance incorporates the pyright type checker but features additional capabilities such as IntelliCode and semantic token highlighting. You can install the latest-published version of the Pylance VS Code extension directly from VS Code. Simply open the extensions panel and search for `pylance`.

### Vim
For vim/neovim users, you can install [coc-pyright](https://github.com/fannheyward/coc-pyright), the Pyright extension for coc.nvim.

Alternatively, [ALE](https://github.com/dense-analysis/ale) will automatically check your code with Pyright, without requiring any additional configuration.

### Sublime Text
For sublime text users, you can install the [LSP-pyright](https://github.com/sublimelsp/LSP-pyright) plugin from [package control](https://packagecontrol.io/packages/LSP-pyright).

### Emacs
For emacs users, you can install [lsp-mode](https://github.com/emacs-lsp/lsp-mode) that includes [lsp-pyright](https://github.com/emacs-lsp/lsp-pyright).
To activate the pyright extension follow the instructions in the [docs](https://emacs-lsp.github.io/lsp-pyright/).

### Command-line
The latest version of the command-line tool can be installed with npm, which is part of node. If you don't have a recent version of node on your system, install that first from [nodejs.org](https://nodejs.org). 

To install pyright globally:
`npm install -g pyright`

On MacOS or Linux, sudo is required to install globally:
`sudo npm install -g pyright`

Once installed, you can run the tool from the command line as follows:
`pyright <options>`

To update to the latest version:
`sudo npm update -g pyright`


## Using Pyright with VS Code Python Extension
Pyright’s type-checking functionality and language features are now incorporated into a VS Code extension called [Pylance](https://github.com/microsoft/pylance-release), the officially supported Python Language Server from Microsoft. Pylance is designed to work with the Python extension for VS Code. In addition to Pyright’s functionality, Pylance adds compatibility with several advanced features including IntelliCode for AI-assisted completions. If you are a VS Code user, we recommend that you uninstall Pyright and instead install Pylance. You will get all the benefits of Pyright and more! 


## Documentation
* [Getting Started with Type Checking](/docs/getting-started.md)
* [Type Concepts](/docs/type-concepts.md)
* [Continuous Integration (CI)](/docs/ci-integration.md)
* [Command-line Options](/docs/command-line.md)
* [Configuration](/docs/configuration.md)
* [Settings](/docs/settings.md)
* [Comments](/docs/comments.md)
* [Type Inference](/docs/type-inference.md)
* [Import Resolution](/docs/import-resolution.md)
* [Type Stubs](/docs/type-stubs.md)
* [Types in Libraries](/docs/typed-libraries.md)
* [Commands](/docs/commands.md)
* [Building & Debugging](/docs/build-debug.md)
* [Pyright Internals](/docs/internals.md)

For additional information about Python static typing, refer to this community-maintained [Python Type School](https://github.com/python/typing/discussions).

## Limitations
Pyright provides support for Python 3.0 and newer. There is currently no plan to support older versions.


## Community
Do you have questions about Pyright or Python type annotations in general? Post your questions in [the discussion section](https://github.com/microsoft/pyright/discussions).

If you would like to report a bug or request an enhancement, file a new issue in either the [pyright](https://github.com/microsoft/pyright/issues) or [pylance-release](https://github.com/microsoft/pylance-release/issues) issue tracker. In general, core type checking functionality is associated with pyright while language service functionality is associated with pylance, but the same contributors monitor both repos. For best results, provide the information requested in the issue template.


## FAQ
**Q:** What is the difference between Pyright and [Pylance](https://github.com/microsoft/pylance-release)? 

**A:** Pyright is an open-source Python type checker and language server. Pylance leverages Pyright’s functionality with additional features, some of which are not open-sourced. 

**Q:** What is the long-term plan for Pyright?

**A:** Pyright is now an officially-supported Microsoft type checker for Python. It will continue to be developed and maintained as an open-source project under its original MIT license terms. The Pyright extension for VSCode is a reference implementation and is not guaranteed to be fully functional or maintained long-term.


## Contributing

This project welcomes contributions and suggestions. Most contributions require you to agree to a Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us the rights to use your contribution. For details, visit https://cla.microsoft.com.

When you submit a pull request, a CLA-bot will automatically determine whether you need to provide a CLA and decorate the PR appropriately (e.g., label, comment). Simply follow the instructions provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.
