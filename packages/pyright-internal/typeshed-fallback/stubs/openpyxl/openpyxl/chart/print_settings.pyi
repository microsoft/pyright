from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class PageMargins(Serialisable):
    tagname: str
    l: Incomplete
    left: Incomplete
    r: Incomplete
    right: Incomplete
    t: Incomplete
    top: Incomplete
    b: Incomplete
    bottom: Incomplete
    header: Incomplete
    footer: Incomplete
    def __init__(
        self, l: float = 0.75, r: float = 0.75, t: int = 1, b: int = 1, header: float = 0.5, footer: float = 0.5
    ) -> None: ...

class PrintSettings(Serialisable):
    tagname: str
    headerFooter: Incomplete
    pageMargins: Incomplete
    pageSetup: Incomplete
    __elements__: Incomplete
    def __init__(
        self, headerFooter: Incomplete | None = None, pageMargins: Incomplete | None = None, pageSetup: Incomplete | None = None
    ) -> None: ...
