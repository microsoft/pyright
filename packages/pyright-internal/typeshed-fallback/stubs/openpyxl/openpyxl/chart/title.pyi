from _typeshed import Incomplete

from openpyxl.descriptors import Typed
from openpyxl.descriptors.serialisable import Serialisable

class Title(Serialisable):
    tagname: str
    tx: Incomplete
    text: Incomplete
    layout: Incomplete
    overlay: Incomplete
    spPr: Incomplete
    graphicalProperties: Incomplete
    txPr: Incomplete
    body: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        tx: Incomplete | None = None,
        layout: Incomplete | None = None,
        overlay: Incomplete | None = None,
        spPr: Incomplete | None = None,
        txPr: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

def title_maker(text): ...

class TitleDescriptor(Typed):
    expected_type: Incomplete
    allow_none: bool
    def __set__(self, instance, value) -> None: ...
