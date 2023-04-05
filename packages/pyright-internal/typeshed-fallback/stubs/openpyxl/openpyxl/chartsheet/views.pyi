from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class ChartsheetView(Serialisable):
    tagname: str
    tabSelected: Incomplete
    zoomScale: Incomplete
    workbookViewId: Incomplete
    zoomToFit: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        tabSelected: Incomplete | None = None,
        zoomScale: Incomplete | None = None,
        workbookViewId: int = 0,
        zoomToFit: Incomplete | None = True,
        extLst: Incomplete | None = None,
    ) -> None: ...

class ChartsheetViewList(Serialisable):
    tagname: str
    sheetView: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(self, sheetView: Incomplete | None = None, extLst: Incomplete | None = None) -> None: ...
