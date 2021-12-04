import ast
from typing import Any, Generator, Type

class Plugin:
    name: str
    version: str
    def __init__(self, tree: ast.AST) -> None: ...
    def run(self) -> Generator[tuple[int, int, str, Type[Any]], None, None]: ...
