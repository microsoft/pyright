from collections.abc import Iterable
from typing import Any, Optional

from docutils.io import FileOutput

_list = list

class DependencyList:
    list: _list[str]
    file: Optional[FileOutput]
    def __init__(self, output_file: Optional[str] = ..., dependencies: Iterable[str] = ...) -> None: ...
    def set_output(self, output_file: Optional[str]) -> None: ...
    def add(self, *filenames: str) -> None: ...
    def close(self) -> None: ...

def __getattr__(name: str) -> Any: ...  # incomplete
