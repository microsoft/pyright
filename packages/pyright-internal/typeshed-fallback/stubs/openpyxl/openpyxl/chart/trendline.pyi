from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class TrendlineLabel(Serialisable):
    tagname: str
    layout: Incomplete
    tx: Incomplete
    numFmt: Incomplete
    spPr: Incomplete
    graphicalProperties: Incomplete
    txPr: Incomplete
    textProperties: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        layout: Incomplete | None = None,
        tx: Incomplete | None = None,
        numFmt: Incomplete | None = None,
        spPr: Incomplete | None = None,
        txPr: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class Trendline(Serialisable):
    tagname: str
    name: Incomplete
    spPr: Incomplete
    graphicalProperties: Incomplete
    trendlineType: Incomplete
    order: Incomplete
    period: Incomplete
    forward: Incomplete
    backward: Incomplete
    intercept: Incomplete
    dispRSqr: Incomplete
    dispEq: Incomplete
    trendlineLbl: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        name: Incomplete | None = None,
        spPr: Incomplete | None = None,
        trendlineType: str = "linear",
        order: Incomplete | None = None,
        period: Incomplete | None = None,
        forward: Incomplete | None = None,
        backward: Incomplete | None = None,
        intercept: Incomplete | None = None,
        dispRSqr: Incomplete | None = None,
        dispEq: Incomplete | None = None,
        trendlineLbl: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...
