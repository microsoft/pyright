## Pyright Settings

The Pyright language server honors the following settings.

**basedpyright.disableLanguageServices** [boolean]: Disables all language services. This includes type completion, signature completion, find definition, find references, and find symbols in file. This option is useful if you want to use pyright only as a type checker but want to run another Python language server for language service features.

**basedpyright.disableOrganizeImports** [boolean]: Disables the “Organize Imports” command. This is useful if you are using another extension that provides similar functionality and you don’t want the two extensions to fight each other.

**basedpyright.disableTaggedHints** [boolean]: Disables the use of hint diagnostics with special tags to tell the client to display text ranges in a "grayed out" manner (to indicate unreachable code or unreferenced symbols) or in a "strike through" manner (to indicate use of a deprecated feature).

**basedpyright.openFilesOnly** [boolean]: Determines whether pyright analyzes (and reports errors for) all files in the workspace, as indicated by the config file. If this option is set to true, pyright analyzes only open files. This setting is deprecated in favor of basedpyright.analysis.diagnosticMode. It will be removed at a future time.

**basedpyright.useLibraryCodeForTypes** [boolean]: This setting is deprecated in favor of basedpyright.analysis.useLibraryCodeForTypes. It will be removed at a future time.

**basedpyright.analysis.autoImportCompletions** [boolean]: Determines whether pyright offers auto-import completions.

**basedpyright.analysis.autoSearchPaths** [boolean]: Determines whether pyright automatically adds common search paths like "src" if there are no execution environments defined in the config file.

**basedpyright.analysis.diagnosticMode** ["openFilesOnly", "workspace"]: Determines whether pyright analyzes (and reports errors for) all files in the workspace, as indicated by the config file. If this option is set to "openFilesOnly", pyright analyzes only open files.

**basedpyright.analysis.diagnosticSeverityOverrides** [map]: Allows a user to override the severity levels for individual diagnostic rules. "reportXXX" rules in the type check diagnostics settings in [configuration](configuration.md#type-check-diagnostics-settings) are supported. Use the rule name as a key and one of "error," "warning," "information," "true," "false," or "none" as value.

**basedpyright.analysis.exclude** [array of paths]: Paths of directories or files that should not be included. This can be overridden in the configuration file.

**basedpyright.analysis.extraPaths** [array of paths]: Paths to add to the default execution environment extra paths if there are no execution environments defined in the config file.

**basedpyright.analysis.ignore** [array of paths]: Paths of directories or files whose diagnostic output (errors and warnings) should be suppressed. This can be overridden in the configuration file.

**basedpyright.analysis.include** [array of paths]: Paths of directories or files that should be included. This can be overridden in the configuration file.

**basedpyright.analysis.logLevel** ["Error", "Warning", "Information", or "Trace"]: Level of logging for Output panel. The default value for this option is "Information".

**basedpyright.analysis.stubPath** [path]: Path to directory containing custom type stub files.

**basedpyright.analysis.typeCheckingMode** ["off", "basic", "standard", "strict", "all"]: Determines the default type-checking level used by pyright. This can be overridden in the configuration file. (Note: This setting used to be called "pyright.typeCheckingMode". The old name is deprecated but is still currently honored.)

**basedpyright.analysis.typeshedPaths** [array of paths]: Paths to look for typeshed modules. Pyright currently honors only the first path in the array.

**basedpyright.analysis.useLibraryCodeForTypes** [boolean]: Determines whether pyright reads, parses and analyzes library code to extract type information in the absence of type stub files. Type information will typically be incomplete. We recommend using type stubs where possible. The default value for this option is true.

**python.pythonPath** [path]: Path to Python interpreter. This setting is being deprecated by the VS Code Python extension in favor of a setting that is stored in the Python extension’s internal configuration store. Pyright supports both mechanisms but prefers the new one if both settings are present.

**python.venvPath** [path]: Path to folder with subdirectories that contain virtual environments. The `python.pythonPath` setting is recommended over this mechanism for most users. For more details, refer to the [import resolution](import-resolution.md#configuring-your-python-environment) documentation.

