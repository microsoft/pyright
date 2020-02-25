## Getting Started with Type Checking

A static type checker like pyright can add incremental value to your source code as more type information is provided.

Here is a typical progression:
1. Install pyright (either the VS Code extension or command-line tool).
2. Write a minimal `pyrightconfig.json` that defines `include` entries. Place the config file in your project’s top-level directory and commit it to your repo.
3. Run pyright over your source base with the default settings. Fix any errors and warnings that it emits.
4. Enable the `reportMissingTypeStubs` setting in the config file and add (minimal) type stub files for the imported files. You may wish to create a “typestubs” directory within your code base -- a common location for all of your custom type stub files. You may be able to find preexisting type stub files for some of your imports within the typeshed repo (in the [third-party directory](https://github.com/python/typeshed/tree/master/third_party)).
5. Check in your custom type stub files and configure pyright to run as part of your continuous integration (CI) environment to keep the project “type clean”.
6. Incrementally add type annotations to your code files. The annotations that provide most value are on function input parameters, instance variables, and return parameters (in that order). Note that annotation of variables (instance, class and local) requires Python 3.6 or newer.
7. Enable stricter type checking options like "reportOptionalSubscript", "reportOptionalMemberAccess", "reportOptionalCall", and "reportUntypedFunctionDecorator".
8. On a file-by-file basis, enable all type checking options by adding the comment `# pyright: strict` somewhere in the file.

