from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable
from openpyxl.styles.fonts import Font

class PhoneticProperties(Serialisable):
    tagname: str
    fontId: Incomplete
    type: Incomplete
    alignment: Incomplete
    def __init__(
        self, fontId: Incomplete | None = None, type: Incomplete | None = None, alignment: Incomplete | None = None
    ) -> None: ...

class PhoneticText(Serialisable):
    tagname: str
    sb: Incomplete
    eb: Incomplete
    t: Incomplete
    text: Incomplete
    def __init__(self, sb: Incomplete | None = None, eb: Incomplete | None = None, t: Incomplete | None = None) -> None: ...

class InlineFont(Font):
    tagname: str
    rFont: Incomplete
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
    __elements__: Incomplete
    def __init__(
        self,
        rFont: Incomplete | None = None,
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
    tagname: str
    rPr: Incomplete
    font: Incomplete
    t: Incomplete
    text: Incomplete
    __elements__: Incomplete
    def __init__(self, rPr: Incomplete | None = None, t: Incomplete | None = None) -> None: ...

class Text(Serialisable):
    tagname: str
    t: Incomplete
    plain: Incomplete
    r: Incomplete
    formatted: Incomplete
    rPh: Incomplete
    phonetic: Incomplete
    phoneticPr: Incomplete
    PhoneticProperties: Incomplete
    __elements__: Incomplete
    def __init__(self, t: Incomplete | None = None, r=(), rPh=(), phoneticPr: Incomplete | None = None) -> None: ...
    @property
    def content(self): ...
