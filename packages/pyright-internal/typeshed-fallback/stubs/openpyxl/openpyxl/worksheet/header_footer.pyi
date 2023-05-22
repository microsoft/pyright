from _typeshed import Incomplete
from typing import ClassVar
from typing_extensions import Literal

from openpyxl.descriptors import Strict
from openpyxl.descriptors.base import Alias, Bool, Integer, MatchPattern, String, Typed, _ConvertibleToBool, _ConvertibleToInt
from openpyxl.descriptors.serialisable import Serialisable

FONT_PATTERN: str
COLOR_PATTERN: str
SIZE_REGEX: str
FORMAT_REGEX: Incomplete

class _HeaderFooterPart(Strict):
    text: String[Literal[True]]
    font: String[Literal[True]]
    size: Integer[Literal[True]]
    RGB: str
    color: MatchPattern[str, Literal[True]]
    def __init__(
        self, text: str | None = None, font: str | None = None, size: _ConvertibleToInt | None = None, color: str | None = None
    ) -> None: ...
    def __bool__(self) -> bool: ...
    @classmethod
    def from_str(cls, text): ...

class HeaderFooterItem(Strict):
    left: Typed[_HeaderFooterPart, Literal[False]]
    center: Typed[_HeaderFooterPart, Literal[False]]
    centre: Alias
    right: Typed[_HeaderFooterPart, Literal[False]]
    def __init__(
        self,
        left: _HeaderFooterPart | None = None,
        right: _HeaderFooterPart | None = None,
        center: _HeaderFooterPart | None = None,
    ) -> None: ...
    def __bool__(self) -> bool: ...
    def to_tree(self, tagname): ...
    @classmethod
    def from_tree(cls, node): ...

class HeaderFooter(Serialisable):
    tagname: str
    differentOddEven: Bool[Literal[True]]
    differentFirst: Bool[Literal[True]]
    scaleWithDoc: Bool[Literal[True]]
    alignWithMargins: Bool[Literal[True]]
    oddHeader: Typed[HeaderFooterItem, Literal[True]]
    oddFooter: Typed[HeaderFooterItem, Literal[True]]
    evenHeader: Typed[HeaderFooterItem, Literal[True]]
    evenFooter: Typed[HeaderFooterItem, Literal[True]]
    firstHeader: Typed[HeaderFooterItem, Literal[True]]
    firstFooter: Typed[HeaderFooterItem, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        differentOddEven: _ConvertibleToBool | None = None,
        differentFirst: _ConvertibleToBool | None = None,
        scaleWithDoc: _ConvertibleToBool | None = None,
        alignWithMargins: _ConvertibleToBool | None = None,
        oddHeader: HeaderFooterItem | None = None,
        oddFooter: HeaderFooterItem | None = None,
        evenHeader: HeaderFooterItem | None = None,
        evenFooter: HeaderFooterItem | None = None,
        firstHeader: HeaderFooterItem | None = None,
        firstFooter: HeaderFooterItem | None = None,
    ) -> None: ...
    def __bool__(self) -> bool: ...
