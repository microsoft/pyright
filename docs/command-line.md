# Pyright Command-Line Options

Usage: pyright [options] [files...] (1)

Pyright can be run as either a VS Code extension or as a node-based command-line tool. The command-line version allows for the following options:

| Flag                               | Description                                           |
| :--------------------------------- | :---------------------------------------------------  |
| --createstub `<IMPORT>`                 | Create type stub file(s) for import                  |
| --dependencies                          | Emit import dependency information                   |
| -h, --help                              | Show help message                                    |
| --ignoreexternal                        | Ignore external imports for --verifytypes            |
| --lib                                   | Use library code for types when stubs are missing    |
| --outputjson                            | Output results in JSON format                        |
| -p, --project `<FILE OR DIRECTORY>`     | Use the configuration file at this location          |
| --pythonplatform `<PLATFORM>`           | Analyze for platform (Darwin, Linux, Windows)        |
| --pythonversion `<VERSION>`             | Analyze for version (3.3, 3.4, etc.)                 |
| --skipunannotated                       | Skip type analysis of unannotated functions?         |
| --stats                                 | Print detailed performance stats                     |
| -t, --typeshed-path `<DIRECTORY>`       | Use typeshed type stubs at this location (2)         |
| -v, --venv-path `<DIRECTORY>`           | Directory that contains virtual environments (3)     |
| --verbose                               | Emit verbose diagnostics                             |
| --verifytypes `<IMPORT>`                | Verify completeness of types in py.typed package     |
| --version                               | Print pyright version                                |
| --warnings                              | Use exit code of 1 if warnings are reported          |
| -w, --watch                             | Continue to run and watch for changes (4)            |

(1) If specific files are specified on the command line, the pyrightconfig.json file is ignored.

(2) Pyright has built-in typeshed type stubs for Python stdlib functionality. To use a different version of typeshed type stubs, specify the directory with this option.

(3) This option is used in conjunction with configuration file, which can refer to different virtual environments by name. For more details, refer to the [configuration](/docs/configuration.md) documentation. This allows a common config file to be checked in to the project and shared by everyone on the development team without making assumptions about the local paths to the venv directory on each developer’s computer.

(4) When running in watch mode, pyright will reanalyze only those files that have been modified. These “deltas” are typically much faster than the initial analysis, which needs to analyze all files in the source tree.


# Pyright Exit Codes

| Exit Code   | Meaning                                                           |
| :---------- | :---------------------------------------------------------------  |
| 0           | No errors reported                                                |
| 1           | One or more errors reported                                       |
| 2           | Fatal error occurred with no errors or warnings reported          |
| 3           | Config file could not be read or parsed                           |
| 4           | Illegal command-line parameters specified                         |


# JSON Output

If the “--outputjson” option is specified on the command line, diagnostics are output in JSON format. The JSON structure is as follows:
```javascript
{
    version: string,
    time: string,
    generalDiagnostics: Diagnostic[],
    summary: {
        filesAnalyzed: number,
        errorCount: number,
        warningCount: number,
        informationCount: number,
        timeInSec: number
    }
}
```

Each Diagnostic is output in the following format:

```javascript
{
    file: string,
    severity: 'error' | 'warning' | 'information',
    message: string,
    rule?: string,
    range: {
        start: {
            line: number,
            character: number
        },
        end: {
            line: number,
            character: number
        }
    }
}
```

Diagnostic line and character numbers are zero-based.

Not all diagnostics have an associated diagnostic rule. Diagnostic rules are used only for diagnostics that can be disabled or enabled. If a rule is associated with the diagnostic, it is included in the output. If it’s not, the rule field is omitted from the JSON output.
