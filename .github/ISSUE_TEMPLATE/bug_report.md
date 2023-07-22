---
name: Bug report
about: Report incorrect or unintended behaviors
title: ''
labels: bug
assignees: ''

---

Note: if you are reporting a wrong signature of a function or a class in the standard library, then the typeshed tracker is better suited for this report: https://github.com/python/typeshed/issues.

If you have a question about typing or a behavior that you’re seeing in Pyright (as opposed to a bug report or enhancement request), consider posting to the [Pyright discussion forum](https://github.com/microsoft/pyright/discussions).

**Describe the bug**
A clear and concise description of the behavior you are seeing and the expected behavior along with steps to reproduce it.

**Code or Screenshots**
If possible, provide a minimal, self-contained code sample (surrounded by triple back ticks) to demonstrate the issue. The code should define or import all referenced symbols.

```python
def foo(self) -> str:
    return 3
```

If your code relies on symbols that are imported from a third-party library, include the associated import statements and specify which versions of those libraries you have installed.

**VS Code extension or command-line**
Are you running pyright as a VS Code extension, a language server in another editor, integrated into Pylance, or the command-line tool? Which version?
