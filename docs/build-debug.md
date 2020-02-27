## Building Pyright

To build the project:
1. Install [nodejs](https://nodejs.org/en/)
2. Open terminal window in main directory of cloned source
3. Execute `npm run install:all` to install dependencies
4. Execute `npm run build`

To build the VS Code extension package:
Same as above, plus
1. Execute `npm run package`

The resulting package (pyright-X.Y.Z.vsix) can be found in the client directory.
To install in VS Code, go to the extensions panel and choose “Install from VSIX...” from the menu, then select the package.


## Running Pyright Locally

Once built, you can run the command-line tool directly from the built sources by executing the following:

`node ./index.js`


## Debugging Pyright

To debug pyright, open the root source directory within VS Code. Open the debug sub-panel and choose “Pyright CLI” from the debug target menu. Click on the green “run” icon or press F5 to build and launch the command-line version in the VS Code debugger.

To debug the VS Code extension, select “Pyright Language Client” from the debug target menu. Click on the green “run” icon or press F5 to build and launch a second copy of VS Code with the extension. Within the second VS Code instance, open a python source file so the pyright extension is loaded. Return to the first instance of VS Code and select “Pyright Language Server” from the debug target menu and click the green “run” icon. This will attach the debugger to the process that hosts the type checker. You can now set breakpoints, etc.

