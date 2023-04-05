from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class CustomChartsheetView(Serialisable):
    tagname: str
    guid: Incomplete
    scale: Incomplete
    state: Incomplete
    zoomToFit: Incomplete
    pageMargins: Incomplete
    pageSetup: Incomplete
    headerFooter: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        guid: Incomplete | None = None,
        scale: Incomplete | None = None,
        state: str = "visible",
        zoomToFit: Incomplete | None = None,
        pageMargins: Incomplete | None = None,
        pageSetup: Incomplete | None = None,
        headerFooter: Incomplete | None = None,
    ) -> None: ...

class CustomChartsheetViews(Serialisable):
    tagname: str
    customSheetView: Incomplete
    __elements__: Incomplete
    def __init__(self, customSheetView: Incomplete | None = None) -> None: ...
