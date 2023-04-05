from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class ManualLayout(Serialisable):
    tagname: str
    layoutTarget: Incomplete
    xMode: Incomplete
    yMode: Incomplete
    wMode: Incomplete
    hMode: Incomplete
    x: Incomplete
    y: Incomplete
    w: Incomplete
    width: Incomplete
    h: Incomplete
    height: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        layoutTarget: Incomplete | None = None,
        xMode: Incomplete | None = None,
        yMode: Incomplete | None = None,
        wMode: str = "factor",
        hMode: str = "factor",
        x: Incomplete | None = None,
        y: Incomplete | None = None,
        w: Incomplete | None = None,
        h: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class Layout(Serialisable):
    tagname: str
    manualLayout: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(self, manualLayout: Incomplete | None = None, extLst: Incomplete | None = None) -> None: ...
