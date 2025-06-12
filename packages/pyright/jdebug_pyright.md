# Building and Running Pyright From Source

This guide outlines the steps to build the Pyright CLI from its source code, test it with a sample Python file, configure stricter type checking, and add a custom debug print statement.

## Prerequisites

1.  **Node.js and npm:** Ensure you have Node.js version 16.x or newer and npm (which typically comes with Node.js) installed.
    *   You can check your versions with `node -v` and `npm -v`.
2.  **Pyright Repository:** You should have the Pyright repository cloned to your local machine. All commands assume you are operating within this repository.

## 1. Install Project Dependencies

From the root directory of the `pyright` repository, install dependencies for all sub-packages.

```bash
# Navigate to the root of the pyright repository if you aren't already there
# cd /path/to/pyright

npm run install:all
```

This command is defined in the root package.json and will ensure all necessary modules for Pyright and its internal packages are downloaded.

## 2. Build the Pyright CLI

Navigate to the CLI package directory and run its build script. This compiles the TypeScript source code into runnable JavaScript.
```bash
cd packages/pyright
npm run build
```
The compiled JavaScript output is typically placed in a dist subdirectory within packages/pyright.

## 3. Prepare Test File and Configuration

### a. Create a Python File for Testing
Create a Python file that Pyright can analyze. This example includes a deliberate type error.
File: pyright/packages/pyright/your_python_file.py
```bash
// filepath: pyright/packages/pyright/your_python_file.py
# file to check type check

import os


a: int = 1
a = os.getcwd()  # Pyright will now report an error here: Expression of type "str" cannot be assigned to declared type "int"


print(a)
```
### b. (Optional) Create a Pyright Configuration File

For stricter type checking, you can add a pyrightconfig.json file.
File: pyright/packages/pyright/pyrightconfig.json
```bash
// filepath: /pyright/packages/pyright/pyrightconfig.json
{
  "typeCheckingMode": "strict"
}
```
Place this file in the pyright/packages/pyright/ directory. Pyright will automatically detect and use it when run from this directory.


### 4. Run the Pyright CLI from Source

After the build is complete, you can run the CLI from the pyright/packages/pyright/ directory using Node.js.

```bash
# Ensure you are in the packages/pyright directory
# cd /path/to/pyright/packages/pyright

node index.js your_python_file.py
```


### 5. Adding Debug Prints

#### a. Modify the Source Code

For example, to add a debug print in Program._parseFile:
File: pyright/packages/pyright-internal/src/analyzer/program.ts
```ts
// ...existing code...
private _parseFile(fileToParse: SourceFileInfo, content?: string, skipFileNeededCheck?: boolean) {
    if (!this._isFileNeeded(fileToParse, skipFileNeededCheck) || !fileToParse.sourceFile.isParseRequired()) {
        return;
    }

    this._console.info(`[Copilot Debug] Program._parseFile: Parsing ${fileToParse.uri.toString()}`); // <--- ADD THIS LINE

    // SourceFile.parse should only be called here in the program, as calling it
// ...existing code...
}
// ...existing code...
```

#### b. Rebuild the Pyright CLI

After modifying any TypeScript files (especially in pyright-internal which pyright depends on), you need to rebuild the CLI package.

```bash
# Ensure you are in the packages/pyright directory
# cd /path/to/pyright/packages/pyright

npm run build
```

#### c. Run Pyright with Debug Output
Run the CLI again. You can use the --verbose flag to see more output, including your custom info logs.
```bash
# Ensure you are in the packages/pyright directory
node index.js --verbose your_python_file.py
```
