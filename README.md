![Pyright](/docs/img/PyrightLarge.png)

# Static type checker for Python

Pyright is a full-featured, standards-based static type checker for Python. It is designed for high performance and can be used with large Python source bases.

### Command-line Tool or Visual Studio Code Extension
Pyright includes both a [command-line tool](/docs/command-line.md) and an [extension for Visual Studio Code](https://marketplace.visualstudio.com/items?itemName=ms-pyright.pyright) that implements the [Language Server Protocol](https://microsoft.github.io/language-server-protocol/).


## Installation
### VS Code Extension
For most VS Code users, we recommend using the Pylance extension rather than Pyright. Pylance incorporates the Pyright type checker but features additional capabilities such as semantic token highlighting and symbol indexing. You can install the latest-published version of the Pylance VS Code extension directly from VS Code. Simply open the extensions panel and search for “Pylance”.

### Vim
Vim/neovim users can install [coc-pyright](https://github.com/fannheyward/coc-pyright), the Pyright extension for coc.nvim.

Alternatively, [ALE](https://github.com/dense-analysis/ale) will automatically check your code with Pyright if added to the linters list.

### Sublime Text
Sublime text users can install the [LSP-pyright](https://github.com/sublimelsp/LSP-pyright) plugin from [package control](https://packagecontrol.io/packages/LSP-pyright).

### Emacs
Emacs users can install [eglot](https://github.com/joaotavora/eglot) or [lsp-mode](https://github.com/emacs-lsp/lsp-mode) with [lsp-pyright](https://github.com/emacs-lsp/lsp-pyright).

### Command-line
A [community-maintained](https://github.com/RobertCraigie/pyright-python) Python package by the name of “pyright” is available on pypi and conda-forge. This package will automatically install node (which Pyright requires) and keep Pyright up to date.

`pip install pyright`

or

`conda install pyright`

Once installed, you can run the tool from the command line as follows:
`pyright <options>`


Alternatively, you can install the command-line version of Pyright directly from npm, which is part of node. If you don't have a recent version of node on your system, install that first from [nodejs.org](https://nodejs.org). 

To install pyright globally:
`npm install -g pyright`

On MacOS or Linux, sudo may be required to install globally:
`sudo npm install -g pyright`

To update to the latest version:
`sudo npm update -g pyright`


## Documentation
* [Pyright Features](/docs/features.md)
* [Getting Started with Type Checking](/docs/getting-started.md)
* [Type Concepts](/docs/type-concepts.md)
* [Continuous Integration (CI)](/docs/ci-integration.md)
* [Command-line Options](/docs/command-line.md)
* [Configuration](/docs/configuration.md)
* [Settings](/docs/settings.md)
* [Comments](/docs/comments.md)
* [Type Inference](/docs/type-inference.md)
* [Import Statements](/docs/import-statements.md)
* [Differences from Mypy](/docs/mypy-comparison.md)
* [Import Resolution](/docs/import-resolution.md)
* [Extending Builtins](/docs/builtins.md)
* [Type Stubs](/docs/type-stubs.md)
* [Types in Libraries](/docs/typed-libraries.md)
* [Commands](/docs/commands.md)
* [Building & Debugging](/docs/build-debug.md)
* [Pyright Internals](/docs/internals.md)

For additional information about Python static typing, refer to this community-maintained [Python Type School](https://github.com/python/typing/discussions).


## Community
Do you have questions about Pyright or Python type annotations in general? Post your questions in [the discussion section](https://github.com/microsoft/pyright/discussions).

If you would like to report a bug or request an enhancement, file a new issue in either the [pyright](https://github.com/microsoft/pyright/issues) or [pylance-release](https://github.com/microsoft/pylance-release/issues) issue tracker. In general, core type checking functionality is associated with Pyright while language service functionality is associated with Pylance, but the same contributors monitor both repos. For best results, provide the information requested in the issue template.


## FAQ
**Q:** What is the difference between Pyright and [Pylance](https://github.com/microsoft/pylance-release)? 

**A:** Pyright is an open-source Python type checker and language server. Pylance leverages Pyright’s functionality with additional features, some of which are not open-sourced. 

**Q:** What is the long-term plan for Pyright?

**A:** Pyright is an officially-supported Microsoft type checker for Python. It will continue to be developed and maintained as an open-source project under its original MIT license terms.


## Contributing

This project welcomes contributions and suggestions. For feature and complex bug fix contributions, it is recommended that you first discuss the proposed change with Pyright’s maintainers before submitting the pull request. Most contributions require you to agree to a Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us the rights to use your contribution. For details, visit https://cla.microsoft.com.

When you submit a pull request, a CLA-bot will automatically determine whether you need to provide a CLA and decorate the PR appropriately (e.g., label, comment). Simply follow the instructions provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.
