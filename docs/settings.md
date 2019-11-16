# Pyright Settings

The Pyright VS Code extension honors the following settings.

**pyright.disableLanguageServices** [boolean]: Disables all language services except for “hover”. This includes type completion, signature completion, find definition, find references, and find symbols in file. This option is useful if you want to use pyright only as a type checker but want to run another Python language server for langue service features.

**pyright.openFilesOnly** [boolean]: Determines whether pyright analyzes (and reports errors for) all files in the workspace, as indicated by the config file. If this option is set to true, pyright analyzes only open files.

**python.analysis.typeshedPaths** [array of paths]: Paths to look for typeshed modules. Pyright currently honors only the first path in the array.

**python.pythonPath** [path]: Path to Python interpreter.

**python.venvPath** [path]: Path to folder with subdirectories that contain virtual environments.


