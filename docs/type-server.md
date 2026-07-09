# Pyright Type Server

In addition to the [command-line tool](command-line.md) and the [language server](settings.md), Pyright ships a **type server** that speaks the Type Server Protocol (TSP). It is distributed as a separate npm package, `pyright-typeserver`, and is exposed through the `pyright-typeserver` executable.

## What is the Type Server Protocol?

The Language Server Protocol (LSP) is designed around editor features (completions, hover, go-to-definition, and so on). Some tools instead need direct access to a Python type checker's *type information* — the inferred type of an expression, the declared type of a symbol, resolved imports, and search paths — without going through editor-oriented requests.

The Type Server Protocol is a JSON-RPC protocol, layered on top of the same transport as LSP, that exposes this type information directly. A client can open Python documents in the usual LSP way (`textDocument/didOpen`, `textDocument/didChange`, …) and then ask the type server questions such as:

* `typeServer/getComputedType` — the inferred type at a parse node.
* `typeServer/getDeclaredType` — the declared type of a declaration.
* `typeServer/getExpectedType` — the expected (contextual) type at a node.
* `typeServer/resolveImport` — resolve an import to a file on disk.
* `typeServer/getPythonSearchPaths` — the search paths used for import resolution.
* `typeServer/getSnapshot` — the current analysis snapshot version, used to keep type queries consistent with the document state.

## Running the type server

The type server communicates over stdio, just like the language server:

```bash
pyright-typeserver --stdio
```

It is not intended to be run interactively; it is started by a client (for example, an editor extension or a code-generation tool) that drives it over the protocol.

## Notebook support

The type server understands Jupyter notebooks. When a client sends `notebookDocument/didOpen`, `notebookDocument/didChange`, and `notebookDocument/didClose`, the server models the notebook as a linear chain of chained cell source files so that names defined in earlier cells are visible in later cells, matching notebook execution semantics.

## Virtual file redirection

The type server supports redirecting the contents of a file on disk to a virtual document supplied by the client. This is used, for example, by stub generators that synthesize a merged view of a module and want the type server to analyze the synthesized contents in place of the file on disk. Clients drive this through the `pyright/setVirtualFileRedirect` and `pyright/removeVirtualFileRedirect` notifications.

## Relationship to Pyright

The type server is built on the same analyzer, binder, and type evaluator as the Pyright command-line tool and language server. It reuses Pyright's `Service` / `Program` / `SourceFile` infrastructure, so type results are identical to what Pyright's other front ends produce. The TSP-specific code lives in `packages/pyright-internal/src/typeServer/`, and the `pyright-typeserver` package is a thin bundling shim over it (mirroring how the `pyright` package wraps the command-line tool and language server).
