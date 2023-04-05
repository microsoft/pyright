from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class PivotSource(Serialisable):
    tagname: str
    name: Incomplete
    fmtId: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self, name: Incomplete | None = None, fmtId: Incomplete | None = None, extLst: Incomplete | None = None
    ) -> None: ...

class PivotFormat(Serialisable):
    tagname: str
    idx: Incomplete
    spPr: Incomplete
    graphicalProperties: Incomplete
    txPr: Incomplete
    TextBody: Incomplete
    marker: Incomplete
    dLbl: Incomplete
    DataLabel: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        idx: int = 0,
        spPr: Incomplete | None = None,
        txPr: Incomplete | None = None,
        marker: Incomplete | None = None,
        dLbl: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...
