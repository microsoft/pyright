## Getting Started with Type Checking

A static type checker like Pyright can add incremental value to your source code as more type information is provided.

Here is a typical progression:
1. Install pyright (either the VS Code extension or command-line tool).
2. Write a minimal `pyrightconfig.json` that defines `include` entries. Place the config file in your project’s top-level directory and commit it to your repo.
3. Optionally enable the `python.analysis.useLibraryCodeForTypes` config option (or pass `--libs` to the command-line tool). This tells Pyright that it should attempt to infer type information from library code if a type stub is not available.
4. Run pyright over your source base with the default settings. Fix any errors and warnings that it emits.
5. Enable the `reportMissingTypeStubs` setting in the config file and add (minimal) type stub files for the imported files. You may wish to create a stubs directory within your code base — a location for all of your custom type stub files. Configure the “stubPath” config entry to refer to this directory.
6. Look for type stubs for the packages you use. Some package authors opt to ship stubs as a separate companion package named that has “-stubs” appended to the name of the original package.
7. In cases where type stubs do not yet exist for a package you are using, consider creating a custom type stub that defines the portion of the interface that your source code consumes. Check in your custom type stub files and configure pyright to run as part of your continuous integration (CI) environment to keep the project “type clean”.
8. Incrementally add type annotations to your code files. The annotations that provide most value are on function input parameters, instance variables, and return parameters (in that order). Note that annotation of variables (instance, class and local) requires Python 3.6 or newer.
9. Enable stricter type checking options like "reportOptionalSubscript", "reportOptionalMemberAccess", "reportOptionalCall", and "reportUntypedFunctionDecorator".
10. On a file-by-file basis, enable all type checking options by adding the comment `# pyright: strict` somewhere in the file.
11. Optionally add entire subdirectories to the `strict` config entry to indicate that all files within those subdirectories should be strictly typed.


