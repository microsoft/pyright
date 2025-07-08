from typing import ClassVar, TypeVar

from docutils import readers

_S = TypeVar("_S", bound=str | bytes)

class Reader(readers.ReReader[_S]):
    config_section_dependencies: ClassVar[tuple[str, ...]]
