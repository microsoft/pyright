from typing import Any, Generic, TypeVar

from docutils import Component, nodes
from docutils.io import Output
from docutils.languages import LanguageImporter

_S = TypeVar("_S")

class Writer(Component, Generic[_S]):
    parts: dict[str, Any]
    language: LanguageImporter | None = None
    def __init__(self) -> None: ...
    document: nodes.document | None = None
    destination: Output | None = None
    output: _S | None = None
    def assemble_parts(self) -> None: ...
    def translate(self) -> None: ...
    def write(self, document: nodes.document, destination: Output) -> str | bytes | None: ...

class UnfilteredWriter(Writer[_S]): ...

def get_writer_class(writer_name: str) -> type[Writer[Any]]: ...
