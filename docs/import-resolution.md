# Import Resolution

Pyright resolves external imports based on several configuration settings. If a venvPath and venv are specified, these are used to locate the `site-packages` directory within the virtual environment.

If no venvPath is specified, Pyright falls back to the paths found in the default python interpreter's search paths (or the python interpreter pointed to by the "python.pythonPath" setting in VS Code). Only directory-based paths are supported (as opposed to zip files or other loader packages).

The Pyright configuration file supports "execution environment" definitions, each of which can define additional paths. These are searched in addition to the venv or PYTHONPATH directories.

If Pyright is reporting import resolution errors, additional diagnostic information may help you determine why. If you are using the command-line version, try adding the "--verbose" switch. If you are using the VS Code extension, look at the "Output" window (View -> Output) and choose the "Pyright" view from the popup menu.
