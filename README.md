# basedpyright

Basedpyright is a static type checker for Python that is built on top of the work done by the [pyright project](https://github.com/Microsoft/pyright).

## why?

pyright has several serious limitations which were the main motivation behind this fork.

### pyright has no way to pin the version used by vscode

this means if the extension gets updated, you may see errors in your project that don't appear in the CI, or vice-versa. see [this issue](https://github.com/microsoft/pylance-release/issues/5207)

### no way to run the pyright CLI without nodejs

python developers should not be expected to have to install nodejs in order to typecheck their python code. it should just be a regular pypi package, just mypy, ruff, and pretty much every other python command line tool

### issues with unreachable code

pyright often incorrectly marks code as unreachable. in most cases, unreachable code is a mistake and therefore should be an error, but pyright does not have an option to report unreachable code. in fact, unreachable code is not even type-checked at all:

```py
if sys.platform == "win32": 
  1 + "" # no error
```

by default, pyright will treat the body in the code above as unreachable if pyright itself was run on an operating system other than windows. this is bad of course, because chances are if you write such a check, you intend for your code to be executed on multiple platforms.

to make things worse, unreachable code is not even type-checked, so the obviously invalid `1 + ""` above will go completely unnoticed by the type checker.

basedpyright solves this issue with a `reportUnreachable` option, which will report an error on any code that it thinks cannot be reached. from there, you can either [update your pyright config to specify more platforms using the `pythonPlatform` option](https://github.com/detachhead/basedpyright/blob/main/docs/configuration.md#main-configuration-options) if you intend for the code to be reachable.

### basedmypy feature parity

[basedmypy](https://github.com/kotlinisland/basedmypy) is a fork of mypy with a similar goal in mind: to fix some of the serious problems in mypy that do not seem to be a priority for the maintainers. it also adds many new features which may not be standardized but greatly improve the developer experience when working with python's far-from-perfect type system.

we aim to [port most of basedmypy's features to basedpyright](https://github.com/DetachHead/basedpyright/issues?q=is%3Aissue+is%3Aopen+label%3A%22basedmypy+feature+parity%22), however as mentioned above our priority is to first fix the critical problems with pyright.

# pypi package

[![](https://img.shields.io/pypi/v/basedpyright?color=blue)](https://pypi.org/project/basedpyright/)

basedpyright differs from pyright by publishing the command line tool as a pypi package instead of an npm package. this makes it far more convenient for python developers to use.

```shell
> basedpyright --help
Usage: basedpyright [options] files...
  Options:
  --createstub <IMPORT>              Create type stub file(s) for import
  --dependencies                     Emit import dependency information
  -h,--help                          Show this help message
  --ignoreexternal                   Ignore external imports for --verifytypes
  --level <LEVEL>                    Minimum diagnostic level (error or warning)
  --outputjson                       Output results in JSON format
  -p,--project <FILE OR DIRECTORY>   Use the configuration file at this location
  --pythonplatform <PLATFORM>        Analyze for a specific platform (Darwin, Linux, Windows)
  --pythonpath <FILE>                Path to the Python interpreter
  --pythonversion <VERSION>          Analyze for a specific version (3.3, 3.4, etc.)
  --skipunannotated                  Skip analysis of functions with no type annotations
  --stats                            Print detailed performance stats
  -t,--typeshedpath <DIRECTORY>      Use typeshed type stubs at this location
  -v,--venvpath <DIRECTORY>          Directory that contains virtual environments
  --verbose                          Emit verbose diagnostics
  --verifytypes <PACKAGE>            Verify type completeness of a py.typed package
  --version                          Print Pyright version and exit
  --warnings                         Use exit code of 1 if warnings are reported
  -w,--watch                         Continue to run and watch for changes
  -                                  Read files from stdin
```

# vscode extension

## install

install the extension from [the vscode extension marketplace](https://marketplace.visualstudio.com/items?itemName=detachhead.basedpyright)

## usage

the basedpyright vscode extension will automatically look for the pypi package in your python environment. see the recommended setup section below for more information

# recommended setup

it's recommended to use both the basedpyright cli and vscode extension in your project. the vscode extension is for local development and the cli is for your CI.

below are the changes i recommend making to your project when adopting basedpyright

## `.vscode/extensions.json`

```jsonc
{
  "recommendations": [
    "detachhead.basedpyright" // this will prompt developers working on your project to install the extension
  ],
  "unwantedRecommendations": [
    "ms-python.vscode-pylance" // the pylance extension must be disabled when using pyright on its own
  ]
}
```

## `.vscode/settings.json`

- remove any settings starting with `python.analysis`, as they can interfere with the vscode extension and cause it to behave differently to the CLI. these settings can be specified using the `tool.basedpyright` (or `tool.pyright`) section in `pyroject.toml` instead (see below)

- disable the built in language server support from the python extension, as it seems to conflict with basedpyright's language server:
  ```json
  {
      "python.languageServer": "None"
  }
  ```

## `.github/workflows/check.yaml`

```yaml
jobs:
  check:
    steps:
      - run: ...  # checkout repo, install dependencies, etc
      - run: basedpyright  # add this line
```

## `pyproject.toml`

we recommend using [pdm](https://pdm-project.org/) or [poetry](https://python-poetry.org/) to manage your dependencies.

```toml
[tool.pdm.dev-dependencies]  # or the poetry equivalent
dev = [
    "basedpyright", # you can pin the version here if you want, or just rely on the lockfile
]

[tool.basedpyright]
# many settings are not enabled even in strict mode, which is why basedpyright includes an "all" option
# you can then decide which rules you want to disable
typeCheckingMode = "all"
```

pinning your dependencies is important because it allows your CI builds to be reproducible (ie. two runs on the same commit will always produce the same result). basedpyright ensures that the version of pyright used by vscode always matches this pinned version
