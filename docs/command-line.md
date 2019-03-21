# Pyright Command-Line Options

Pyright can be run as either a VS Code extension or as a node-based command-line tool. The command-line version allows for the following options:

| Flag                               | Description                                          |
| ---------------------------------- | ---------------------------------------------------- |
| -h,--help                          | Show help message                                    |
| -P,--python-path DIRECTORY         | Directory that contains the python environment (1)   |
| -p,--project FILE OR DIRECTORY     | Use the configuration file at this location          |
| -t,--typeshed-path DIRECTORY       | Use typeshed type stubs at this location (2)         |
| -v,--venv-path DIRECTORY           | Directory that contains virtual environments (3)     |
| -w,--watch                         | Continue to run and watch for changes (4)            |


(1) This option is used to find imports if not using typeshed files or a configuration file with virtual environments.
(2) Pyright has built-in typeshed type stubs for Python stdlib functionality. To use a different version of typeshed type stubs, specify the directory with this option.
(3) This option is used in conjunction with configuration file, which can refer to different virtual environments by name. For more details, refer to the [configuration](/docs/configuration.md) documentation.
(4) When running in watch mode, pyright will reanalyze only those files that have been modified. These “deltas” are typically much faster than the initial analysis, which needs to analyze all files in the source tree.

