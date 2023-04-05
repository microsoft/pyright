## Getting Started with Type Checking

A static type checker like Pyright can add incremental value to your source code as more type information is provided.

Here is a typical progression:

### 1. Initial Type Checking
* Install pyright (either the language server or command-line tool).
* Write a minimal `pyrightconfig.json` that defines `include` entries. Place the config file in your project’s top-level directory and commit it to your repo. Alternatively, you can add a pyright section to a `pyproject.toml` file. For additional details and a sample config file, refer to [this documentation](configuration.md).
* Run pyright over your source base with the default settings. Fix any errors and warnings that it emits. Optionally disable specific diagnostic rules if they are generating too many errors. They can be re-enabled at a later time.

### 2. Types For Imported Libraries
* Update dependent libraries to recent versions. Many popular libraries have recently added inlined types, which eliminates the need to install or create type stubs.
* Enable the `reportMissingTypeStubs` setting in the config file and add (minimal) type stub files for the imported files. You may wish to create a stubs directory within your code base — a location for all of your custom type stub files. Configure the “stubPath” config entry to refer to this directory.
* Look for type stubs for the packages you use. Some package authors opt to ship stubs as a separate companion package named that has “-stubs” appended to the name of the original package.
* In cases where type stubs do not yet exist for a package you are using, consider creating a custom type stub that defines the portion of the interface that your source code consumes. Check in your custom type stub files and configure pyright to run as part of your continuous integration (CI) environment to keep the project “type clean”.

### 3. Incremental Typing
* Incrementally add type annotations to your code files. The annotations that provide most value are on function input parameters, instance variables, and return parameters (in that order).
* Enable stricter type checking options like "reportUnknownParameterType", and "reportUntypedFunctionDecorator".

### 4. Strict Typing
* On a file-by-file basis, enable all type checking options by adding the comment `# pyright: strict` somewhere in the file.
* Optionally add entire subdirectories to the `strict` config entry to indicate that all files within those subdirectories should be strictly typed.


