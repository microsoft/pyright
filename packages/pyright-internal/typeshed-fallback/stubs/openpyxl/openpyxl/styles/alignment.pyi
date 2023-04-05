from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

horizontal_alignments: Incomplete
vertical_aligments: Incomplete

class Alignment(Serialisable):
    tagname: str
    __fields__: Incomplete
    horizontal: Incomplete
    vertical: Incomplete
    textRotation: Incomplete
    text_rotation: Incomplete
    wrapText: Incomplete
    wrap_text: Incomplete
    shrinkToFit: Incomplete
    shrink_to_fit: Incomplete
    indent: Incomplete
    relativeIndent: Incomplete
    justifyLastLine: Incomplete
    readingOrder: Incomplete
    def __init__(
        self,
        horizontal: Incomplete | None = None,
        vertical: Incomplete | None = None,
        textRotation: int = 0,
        wrapText: Incomplete | None = None,
        shrinkToFit: Incomplete | None = None,
        indent: int = 0,
        relativeIndent: int = 0,
        justifyLastLine: Incomplete | None = None,
        readingOrder: int = 0,
        text_rotation: Incomplete | None = None,
        wrap_text: Incomplete | None = None,
        shrink_to_fit: Incomplete | None = None,
        mergeCell: Incomplete | None = None,
    ) -> None: ...
    def __iter__(self): ...
