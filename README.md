![Pyright](/docs/img/PyrightLarge.png)

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

### Command-line Tool or Visual Studio Code Extension
Pyright includes both a [command-line tool](/docs/command-line.md) and an [extension for Visual Studio Code](https://github.com/Microsoft/pyright) that implements the [Language Server Protocol](https://microsoft.github.io/language-server-protocol/).

For rich Python editing and debugging capabilities with Visual Studio Code, be sure to also install the official [Microsoft Python extension for Visual Studio Code](https://marketplace.visualstudio.com/itemdetails?itemName=ms-python.python) as Pyright only provides syntax and type checking.


## Installation
You can install the latest-published version of the Pyright VS Code extension directly from VS Code. Simply open the extensions panel and search for `pyright`.

The latest version of the command-line tool can be installed with npm, which is part of node. If you don't have a recent version of node on your system, install that first from [nodejs.org](nodejs.org). 

To install pyright globally:
`npm install -g pyright`

On MacOS or Linux, sudo is required to install globally:
`sudo npm install -g pyright`

Once installed, you can run the tool from the command line as follows:
`pyright <options>`

To update to the latest version:
`sudo npm update -g pyright`


## Documentation
* [Getting Started with Type Checking](/docs/getting-started.md)
* [Command-line Options](/docs/command-line.md)
* [Configuration](/docs/configuration.md)
* [Comments](/docs/comments.md)
* [Import Resolution](/docs/import-resolution.md)
* [Building & Debugging](/docs/build-debug.md)
* [Pyright Internals](/docs/internals.md)


## Limitations
Pyright currently provides support for Python 3.0 and newer. There is currently no plan to support older versions.


## FAQ
**Q:** What is the difference between pyright and the [Microsoft Python Visual Studio Code plugin](https://github.com/Microsoft/vscode-python)?

**A:** Pyright is focused on type checking. The Python VS Code plugin is Microsoft’s officially-supported extension for VS Code and provides a diverse array of features including auto-complete, debugging, linter plugins, type-checking plugins, and much more. Pyright can be used alongide the Microsoft Python extension.

**Q:** What is the difference between Pyright and the [Microsoft Python Language Server](https://github.com/Microsoft/python-language-server)?

**A:** The Microsoft Python Language Server is a [language server protocol (LSP)](https://microsoft.github.io/language-server-protocol/) implementation that works with the Microsoft Python VS Code plugin. It is officially supported by a team of Microsoft engineers. It focuses on providing core editing capabilities such as auto-completion, code navigation and documentation. Pyright is focused on providing fast syntax and type checking with features such as more configurabilty and command-line execution.

**Q:** What is the long-term plan for Pyright?

**A:** Pyright is a side project with no dedicated team. There is no guarantee of continued development on the project. If you find it useful, feel free to use it and contribute to the code base.


## Contributing

This project welcomes contributions and suggestions. Most contributions require you to agree to a Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us the rights to use your contribution. For details, visit https://cla.microsoft.com.

When you submit a pull request, a CLA-bot will automatically determine whether you need to provide a CLA and decorate the PR appropriately (e.g., label, comment). Simply follow the instructions provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.
