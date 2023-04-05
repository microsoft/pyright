from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class Pane(Serialisable):  # type: ignore[misc]
    xSplit: Incomplete
    ySplit: Incomplete
    topLeftCell: Incomplete
    activePane: Incomplete
    state: Incomplete
    def __init__(
        self,
        xSplit: Incomplete | None = None,
        ySplit: Incomplete | None = None,
        topLeftCell: Incomplete | None = None,
        activePane: str = "topLeft",
        state: str = "split",
    ) -> None: ...

class Selection(Serialisable):  # type: ignore[misc]
    pane: Incomplete
    activeCell: Incomplete
    activeCellId: Incomplete
    sqref: Incomplete
    def __init__(
        self, pane: Incomplete | None = None, activeCell: str = "A1", activeCellId: Incomplete | None = None, sqref: str = "A1"
    ) -> None: ...

class SheetView(Serialisable):
    tagname: str
    windowProtection: Incomplete
    showFormulas: Incomplete
    showGridLines: Incomplete
    showRowColHeaders: Incomplete
    showZeros: Incomplete
    rightToLeft: Incomplete
    tabSelected: Incomplete
    showRuler: Incomplete
    showOutlineSymbols: Incomplete
    defaultGridColor: Incomplete
    showWhiteSpace: Incomplete
    view: Incomplete
    topLeftCell: Incomplete
    colorId: Incomplete
    zoomScale: Incomplete
    zoomScaleNormal: Incomplete
    zoomScaleSheetLayoutView: Incomplete
    zoomScalePageLayoutView: Incomplete
    zoomToFit: Incomplete
    workbookViewId: Incomplete
    selection: Incomplete
    pane: Incomplete
    def __init__(
        self,
        windowProtection: Incomplete | None = None,
        showFormulas: Incomplete | None = None,
        showGridLines: Incomplete | None = None,
        showRowColHeaders: Incomplete | None = None,
        showZeros: Incomplete | None = None,
        rightToLeft: Incomplete | None = None,
        tabSelected: Incomplete | None = None,
        showRuler: Incomplete | None = None,
        showOutlineSymbols: Incomplete | None = None,
        defaultGridColor: Incomplete | None = None,
        showWhiteSpace: Incomplete | None = None,
        view: Incomplete | None = None,
        topLeftCell: Incomplete | None = None,
        colorId: Incomplete | None = None,
        zoomScale: Incomplete | None = None,
        zoomScaleNormal: Incomplete | None = None,
        zoomScaleSheetLayoutView: Incomplete | None = None,
        zoomScalePageLayoutView: Incomplete | None = None,
        zoomToFit: Incomplete | None = None,
        workbookViewId: int = 0,
        selection: Incomplete | None = None,
        pane: Incomplete | None = None,
    ) -> None: ...

class SheetViewList(Serialisable):
    tagname: str
    sheetView: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(self, sheetView: Incomplete | None = None, extLst: Incomplete | None = None) -> None: ...
