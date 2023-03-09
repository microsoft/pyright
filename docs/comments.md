## Comments

Some behaviors of pyright can be controlled through the use of comments within the source file.

### File-level Type Controls
Strict type checking, where most supported type-checking switches generate errors, can be enabled for a file through the use of a special comment. Typically this comment is placed at or near the top of a code file on its own line.

```python
# pyright: strict
```

Likewise, basic type checking can be enabled for a file. If you use `# pyright: basic`, the settings for the file use the default “basic” settings, not any override settings specified in the configuration file or language server settings. You can override the basic default settings within the file by specifying them individually (see below).

```python
# pyright: basic
```

Individual configuration settings can also be overridden on a per-file basis and optionally combined with “strict” or “basic” type checking. For example, if you want to enable all type checks except for “reportPrivateUsage”, you could add the following comment:

```python
# pyright: strict, reportPrivateUsage=false
```

Diagnostic levels are also supported.

```python
# pyright: reportPrivateUsage=warning, reportOptionalCall=error
```


### Line-level Diagnostic Suppression

PEP 484 defines a special comment `# type: ignore` that can be used at the end of a line to suppress all diagnostics emitted by a type checker on that line. Pyright supports this mechanism.

Pyright also supports a `# pyright: ignore` comment at the end of a line to suppress all Pyright diagnostics on that line. This can be useful if you use multiple type checkers on your source base and want to limit suppression of diagnostics to Pyright only.

The `# pyright: ignore` comment accepts an optional list of comma-delimited diagnostic rule names surrounded by square brackets. If such a list is present, only diagnostics within those diagnostic rule categories are suppressed on that line. For example, `# pyright: ignore [reportPrivateUsage, reportGeneralTypeIssues]` would suppress diagnostics related to those two categories but no others.

If the `reportUnnecessaryTypeIgnoreComment` configuration option is enabled, any unnecessary `# type: ignore` and `# pyright: ignore` comments will be reported so they can be removed.
