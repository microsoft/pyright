from typing import ClassVar, Final
from typing_extensions import deprecated

from docutils import nodes
from docutils.transforms import Transform

__docformat__: Final = "reStructuredText"

@deprecated("docutils.transforms.writer_aux.Compound is deprecated and will be removed in Docutils 0.21 or later.")
class Compound(Transform):
    default_priority: ClassVar[int]
    def __init__(self, document: nodes.document, startnode: nodes.Node | None = None) -> None: ...
    def apply(self) -> None: ...

class Admonitions(Transform):
    default_priority: ClassVar[int]
    def apply(self) -> None: ...
