from _typeshed import Incomplete

from openpyxl.descriptors import Strict
from openpyxl.descriptors.serialisable import Serialisable

FONT_PATTERN: str
COLOR_PATTERN: str
SIZE_REGEX: str
FORMAT_REGEX: Incomplete

class _HeaderFooterPart(Strict):
    text: Incomplete
    font: Incomplete
    size: Incomplete
    RGB: str
    color: Incomplete
    def __init__(
        self,
        text: Incomplete | None = None,
        font: Incomplete | None = None,
        size: Incomplete | None = None,
        color: Incomplete | None = None,
    ) -> None: ...
    def __bool__(self) -> bool: ...
    @classmethod
    def from_str(cls, text): ...

class HeaderFooterItem(Strict):
    left: Incomplete
    center: Incomplete
    centre: Incomplete
    right: Incomplete
    def __init__(
        self, left: Incomplete | None = None, right: Incomplete | None = None, center: Incomplete | None = None
    ) -> None: ...
    def __bool__(self) -> bool: ...
    def to_tree(self, tagname): ...
    @classmethod
    def from_tree(cls, node): ...

class HeaderFooter(Serialisable):
    tagname: str
    differentOddEven: Incomplete
    differentFirst: Incomplete
    scaleWithDoc: Incomplete
    alignWithMargins: Incomplete
    oddHeader: Incomplete
    oddFooter: Incomplete
    evenHeader: Incomplete
    evenFooter: Incomplete
    firstHeader: Incomplete
    firstFooter: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        differentOddEven: Incomplete | None = None,
        differentFirst: Incomplete | None = None,
        scaleWithDoc: Incomplete | None = None,
        alignWithMargins: Incomplete | None = None,
        oddHeader: Incomplete | None = None,
        oddFooter: Incomplete | None = None,
        evenHeader: Incomplete | None = None,
        evenFooter: Incomplete | None = None,
        firstHeader: Incomplete | None = None,
        firstFooter: Incomplete | None = None,
    ) -> None: ...
    def __bool__(self) -> bool: ...
