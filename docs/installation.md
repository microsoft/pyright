## Installation

⚠ basedpyright has only been tested on vscode. i don't use any other editor, so if you have issues with any of these other plugins feel free to raise an issue

### Language Server

#### VS Code
see https://github.com/DetachHead/basedpyright#vscode-extension

#### Neovim
BasedPyright is available through the [`nvim-lspconfig`](https://github.com/neovim/nvim-lspconfig/blob/master/doc/server_configurations.md#basedpyright) adapter for native Neovim's LSP support.  To configure it simply add this to your Neovim's settings:
```lua
local lspconfig = require("lspconfig")
lspconfig.basedpyright.setup {}
```

#### Vim
Vim/Neovim users can install [coc-pyright](https://github.com/fannheyward/coc-pyright), the Pyright extension for coc.nvim.

Alternatively, [ALE](https://github.com/dense-analysis/ale) will automatically check your code with Pyright if added to the linters list.

#### Sublime Text
Sublime text users can install the [LSP-pyright](https://github.com/sublimelsp/LSP-pyright) plugin from [package control](https://packagecontrol.io/packages/LSP-pyright).

#### Emacs
Emacs users can install [eglot](https://github.com/joaotavora/eglot) or [lsp-mode](https://github.com/emacs-lsp/lsp-mode) with [lsp-pyright](https://github.com/emacs-lsp/lsp-pyright).

### Command-line
see https://github.com/DetachHead/basedpyright#pypi-package
