# Pyright Settings

The Pyright VS Code extension honors the following settings.

**pyright.disableLanguageServices** [boolean]: Disables all language services except for “hover”. This includes type completion, signature completion, find definition, find references, and find symbols in file. This option is useful if you want to use pyright only as a type checker but want to run another Python language server for langue service features.

**pyright.disableOrganizeImports** [boolean]: Disables the “Organize Imports” command. This is useful if you are using another extension that provides similar functionality and you don’t want the two extensions to fight each other.

**pyright.openFilesOnly** [boolean]: Determines whether pyright analyzes (and reports errors for) all files in the workspace, as indicated by the config file. If this option is set to true, pyright analyzes only open files. This setting is deprecated in favor of python.analysis.diagnosticMode. It will be removed at a future time.

**pyright.typeCheckingMode** ["off", "basic", "strict"]: Determines the default type-checking level used by pyright. This can be overridden in the configuration file.

**pyright.useLibraryCodeForTypes** [boolean]: Determines whether pyright reads, parses and analyzes library code to extract type information in the absence of type stub files. This can add significant overhead and may result in poor-quality type information. The default value for this option is false.

**python.analysis.typeshedPaths** [array of paths]: Paths to look for typeshed modules. Pyright currently honors only the first path in the array.

**python.analysis.autoSearchPaths** [boolean]: Determines whether pyright automatically adds common search paths like "src" if there are no execution environments defined in the config file.

**python.analysis.extraPaths** [array of paths]: Paths to add to the default execution environment extra paths if there are no execution environments defined in the config file.

**python.analysis.logLevel** ["error", "warning", "info", or "trace"]: Level of logging for Output panel. The default value for this option is "info".

**python.analysis.stubPath** [path]: Path to directory containing custom type stub files.

**python.analysis.diagnosticMode** ["openFilesOnly", "workspace"]: Determines whether pyright analyzes (and reports errors for) all files in the workspace, as indicated by the config file. If this option is set to "openFilesOnly", pyright analyzes only open files.

**python.analysis.diagnosticSeverityOverrides** [map]: Allows a user to override the severity levels for individual diagnostic rules. "reportXXX" rules in the type check diagnostics settings in [configuration](https://github.com/microsoft/pyright/blob/master/docs/configuration.md#type-check-diagnostics-settings) are supported. Use the rule name as a key and one of "error," "warning," "information," "true," "false," or "none" as value.

**python.pythonPath** [path]: Path to Python interpreter. This setting is being deprecated by the VS Code Python extension in favor of a setting that is stored in the Python extension’s internal configuration store. Pyright supports both mechanisms but prefers the new one if both settings are present.

**python.venvPath** [path]: Path to folder with subdirectories that contain virtual environments.

