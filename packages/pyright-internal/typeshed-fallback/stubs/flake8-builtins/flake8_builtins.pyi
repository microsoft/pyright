import ast
from typing import Any, Generator, Type

class BuiltinsChecker:
    name: str
    version: str
    def __init__(self, tree: ast.AST, filename: str) -> None: ...
    def run(self) -> Generator[tuple[int, int, str, Type[Any]], None, None]: ...

def __getattr__(name: str) -> Any: ...  # incomplete (other attributes are normally not accessed)
