from _typeshed import Incomplete
from typing import ClassVar
from typing_extensions import Literal, TypeAlias

from openpyxl.descriptors.base import Alias, Integer, NoneSet, Typed, _ConvertibleToInt
from openpyxl.descriptors.nested import NestedString, NestedText
from openpyxl.descriptors.serialisable import Serialisable
from openpyxl.styles.fonts import Font

_PhoneticPropertiesType: TypeAlias = Literal["halfwidthKatakana", "fullwidthKatakana", "Hiragana", "noConversion"]
_PhoneticPropertiesAlignment: TypeAlias = Literal["noControl", "left", "center", "distributed"]

class PhoneticProperties(Serialisable):
    tagname: ClassVar[str]
    fontId: Integer[Literal[False]]
    type: NoneSet[_PhoneticPropertiesType]
    alignment: NoneSet[_PhoneticPropertiesAlignment]
    def __init__(
        self,
        fontId: _ConvertibleToInt,
        type: _PhoneticPropertiesType | Literal["none"] | None = None,
        alignment: _PhoneticPropertiesAlignment | Literal["none"] | None = None,
    ) -> None: ...

_PhoneticProperties: TypeAlias = PhoneticProperties

class PhoneticText(Serialisable):
    tagname: ClassVar[str]
    sb: Integer[Literal[False]]
    eb: Integer[Literal[False]]
    t: NestedText[str, Literal[False]]
    text: Alias
    def __init__(self, sb: _ConvertibleToInt, eb: _ConvertibleToInt, t: object = None) -> None: ...

class InlineFont(Font):
    tagname: ClassVar[str]
    rFont: NestedString[Literal[True]]
    charset: Incomplete
    family: Incomplete
    b: Incomplete
    i: Incomplete
    strike: Incomplete
    outline: Incomplete
    shadow: Incomplete
    condense: Incomplete
    extend: Incomplete
    color: Incomplete
    sz: Incomplete
    u: Incomplete
    vertAlign: Incomplete
    scheme: Incomplete
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        rFont: object = None,
        charset: Incomplete | None = None,
        family: Incomplete | None = None,
        b: Incomplete | None = None,
        i: Incomplete | None = None,
        strike: Incomplete | None = None,
        outline: Incomplete | None = None,
        shadow: Incomplete | None = None,
        condense: Incomplete | None = None,
        extend: Incomplete | None = None,
        color: Incomplete | None = None,
        sz: Incomplete | None = None,
        u: Incomplete | None = None,
        vertAlign: Incomplete | None = None,
        scheme: Incomplete | None = None,
    ) -> None: ...

class RichText(Serialisable):
    tagname: ClassVar[str]
    rPr: Typed[InlineFont, Literal[True]]
    font: Alias
    t: NestedText[str, Literal[True]]
    text: Alias
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(self, rPr: InlineFont | None = None, t: object = None) -> None: ...

class Text(Serialisable):
    tagname: ClassVar[str]
    t: NestedText[str, Literal[True]]
    plain: Alias
    r: Incomplete
    formatted: Alias
    rPh: Incomplete
    phonetic: Alias
    phoneticPr: Typed[_PhoneticProperties, Literal[True]]
    PhoneticProperties: Alias
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(self, t: object = None, r=(), rPh=(), phoneticPr: _PhoneticProperties | None = None) -> None: ...
    @property
    def content(self): ...
