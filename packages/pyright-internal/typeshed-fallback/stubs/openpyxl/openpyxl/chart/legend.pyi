from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class LegendEntry(Serialisable):
    tagname: str
    idx: Incomplete
    delete: Incomplete
    txPr: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self, idx: int = 0, delete: bool = False, txPr: Incomplete | None = None, extLst: Incomplete | None = None
    ) -> None: ...

class Legend(Serialisable):
    tagname: str
    legendPos: Incomplete
    position: Incomplete
    legendEntry: Incomplete
    layout: Incomplete
    overlay: Incomplete
    spPr: Incomplete
    graphicalProperties: Incomplete
    txPr: Incomplete
    textProperties: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        legendPos: str = "r",
        legendEntry=(),
        layout: Incomplete | None = None,
        overlay: Incomplete | None = None,
        spPr: Incomplete | None = None,
        txPr: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...
