# VS Code Commands

Pyright offers the following commands, which can be invoked from VS Code's "Command Palette", which can be accessed from the View menu or by pressing Cmd-Shift-P.

## Organize Imports

This command reorders all imports found in the global (module-level) scope of the source file. As recommended in PEP8, imports are grouped into three groups, each separated by an empty line. The first group includes all built-in modules, the second group includes all third-party modules, and the third group includes all local modules.

Within each group, imports are sorted alphabetically. And within each "from X import Y" statement, the imported symbols are sorted alphabetically. Pyright also rewraps any imports that don't fit within a single line, switching to multi-line formatting.
