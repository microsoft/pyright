## Installation

### Language Server

#### VS Code
For most VS Code users, we recommend using the Pylance extension rather than Pyright. Pylance incorporates the Pyright type checker but features additional capabilities such as semantic token highlighting and symbol indexing. You can install the latest-published version of the Pylance VS Code extension directly from VS Code. Simply open the extensions panel and search for “Pylance”.

#### Vim
Vim/neovim users can install [coc-pyright](https://github.com/fannheyward/coc-pyright), the Pyright extension for coc.nvim.

Alternatively, [ALE](https://github.com/dense-analysis/ale) will automatically check your code with Pyright if added to the linters list.

#### Sublime Text
Sublime text users can install the [LSP-pyright](https://github.com/sublimelsp/LSP-pyright) plugin from [package control](https://packagecontrol.io/packages/LSP-pyright).

#### Emacs
Emacs users can install [eglot](https://github.com/joaotavora/eglot) or [lsp-mode](https://github.com/emacs-lsp/lsp-mode) with [lsp-pyright](https://github.com/emacs-lsp/lsp-pyright).

#### PyCharm
PyCharm users can enable native Pyright support in the settings.
For more information, refer to [PyCharm documentation](https://www.jetbrains.com/help/pycharm/lsp-tools.html#pyright).

### Command-line

#### Python Package
A [community-maintained](https://github.com/RobertCraigie/pyright-python) Python package by the name of “pyright” is available on pypi and conda-forge. This package will automatically install node (which Pyright requires) and keep Pyright up to date.

`pip install pyright`

or

`conda install pyright`

Once installed, you can run the tool from the command line as follows:
`pyright <options>`


#### NPM Package
Alternatively, you can install the command-line version of Pyright directly from npm, which is part of node. If you don't have a recent version of node on your system, install that first from [nodejs.org](https://nodejs.org). 

To install pyright globally:
`npm install -g pyright`

On MacOS or Linux, sudo may be required to install globally:
`sudo npm install -g pyright`

To update to the latest version:
`sudo npm update -g pyright`

