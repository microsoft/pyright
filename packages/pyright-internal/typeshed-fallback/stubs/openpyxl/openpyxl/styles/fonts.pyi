from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class Font(Serialisable):
    UNDERLINE_DOUBLE: str
    UNDERLINE_DOUBLE_ACCOUNTING: str
    UNDERLINE_SINGLE: str
    UNDERLINE_SINGLE_ACCOUNTING: str
    name: Incomplete
    charset: Incomplete
    family: Incomplete
    sz: Incomplete
    size: Incomplete
    b: Incomplete
    bold: Incomplete
    i: Incomplete
    italic: Incomplete
    strike: Incomplete
    strikethrough: Incomplete
    outline: Incomplete
    shadow: Incomplete
    condense: Incomplete
    extend: Incomplete
    u: Incomplete
    underline: Incomplete
    vertAlign: Incomplete
    color: Incomplete
    scheme: Incomplete
    tagname: str
    __elements__: Incomplete
    def __init__(
        self,
        name: Incomplete | None = None,
        sz: Incomplete | None = None,
        b: Incomplete | None = None,
        i: Incomplete | None = None,
        charset: Incomplete | None = None,
        u: Incomplete | None = None,
        strike: Incomplete | None = None,
        color: Incomplete | None = None,
        scheme: Incomplete | None = None,
        family: Incomplete | None = None,
        size: Incomplete | None = None,
        bold: Incomplete | None = None,
        italic: Incomplete | None = None,
        strikethrough: Incomplete | None = None,
        underline: Incomplete | None = None,
        vertAlign: Incomplete | None = None,
        outline: Incomplete | None = None,
        shadow: Incomplete | None = None,
        condense: Incomplete | None = None,
        extend: Incomplete | None = None,
    ) -> None: ...
    @classmethod
    def from_tree(cls, node): ...

DEFAULT_FONT: Incomplete
