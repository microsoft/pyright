# Pyright Command-Line Options

Pyright can be run as either a VS Code extension or as a node-based command-line tool. The command-line version allows for the following options:

| Flag                               | Description                                           |
| :--------------------------------- | :---------------------------------------------------  |
| --createstub IMPORT                 | Create type stub file(s) for import                  |
| --dependencies                      | Emit import dependency information                   |
| -h, --help                          | Show help message                                    |
| --lib                               | Use library code for types when stubs are missing    |
| --outputjson                        | Output results in JSON format                        |
| -p, --project FILE OR DIRECTORY     | Use the configuration file at this location          |
| --stats                             | Print detailed performance stats                     |
| -t, --typeshed-path DIRECTORY       | Use typeshed type stubs at this location (1)         |
| -v, --venv-path DIRECTORY           | Directory that contains virtual environments (2)     |
| --verbose                           | Emit verbose diagnostics                             |
| --version                           | Print pyright version                                |
| -w, --watch                         | Continue to run and watch for changes (3)            |


(1) Pyright has built-in typeshed type stubs for Python stdlib functionality. To use a different version of typeshed type stubs, specify the directory with this option.

(2) This option is used in conjunction with configuration file, which can refer to different virtual environments by name. For more details, refer to the [configuration](/docs/configuration.md) documentation. This allows a common config file to be checked in to the project and shared by everyone on the development team without making assumptions about the local paths to the venv directory on each developer’s computer.

(3) When running in watch mode, pyright will reanalyze only those files that have been modified. These “deltas” are typically much faster than the initial analysis, which needs to analyze all files in the source tree.


# Pyright Exit Codes

| Exit Code   | Meaning                                                           |
| :---------- | :---------------------------------------------------------------  |
| 0           | No errors reported                                                |
| 1           | One or more errors reported                                       |
| 2           | Fatal error occurred with no errors or warnings reported          |
| 3           | Config file could not be read or parsed                           |

