# Comments

Some behaviors of pyright can be controlled through the use of comments within the source file.

## Type Annotations
Versions of Python prior to 3.6 did not support type annotations for variables. Pyright honors type annotations found within a comment at the end of the same line where a variable is assigned.

```python
offsets = [] # type: List[int]

self._target = 3 # type: Union[int, str]
```

## File-level Type Controls
Strict typing controls (where all supported type-checking switches generate errors) can be enabled for a file through the use of a special comment. Typically this comment is placed at or near the top of a code file on its own line.

```python
# pyright: strict
```

Individual configuration settings can also be overridden on a per-file basis and combined with “strict” typing. For example, if you want to enable all type checks except for “reportPrivateUsage”, you could add the following comment:

```python
# pyright: strict, reportPrivateUsage=false
```

Diagnostic levels are also supported.

```python
# pyright: reportPrivateUsage=warning, reportOptionalCall=error
```

