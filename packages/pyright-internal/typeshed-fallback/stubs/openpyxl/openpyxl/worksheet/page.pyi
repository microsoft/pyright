from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class PrintPageSetup(Serialisable):
    tagname: str
    orientation: Incomplete
    paperSize: Incomplete
    scale: Incomplete
    fitToHeight: Incomplete
    fitToWidth: Incomplete
    firstPageNumber: Incomplete
    useFirstPageNumber: Incomplete
    paperHeight: Incomplete
    paperWidth: Incomplete
    pageOrder: Incomplete
    usePrinterDefaults: Incomplete
    blackAndWhite: Incomplete
    draft: Incomplete
    cellComments: Incomplete
    errors: Incomplete
    horizontalDpi: Incomplete
    verticalDpi: Incomplete
    copies: Incomplete
    id: Incomplete
    def __init__(
        self,
        worksheet: Incomplete | None = None,
        orientation: Incomplete | None = None,
        paperSize: Incomplete | None = None,
        scale: Incomplete | None = None,
        fitToHeight: Incomplete | None = None,
        fitToWidth: Incomplete | None = None,
        firstPageNumber: Incomplete | None = None,
        useFirstPageNumber: Incomplete | None = None,
        paperHeight: Incomplete | None = None,
        paperWidth: Incomplete | None = None,
        pageOrder: Incomplete | None = None,
        usePrinterDefaults: Incomplete | None = None,
        blackAndWhite: Incomplete | None = None,
        draft: Incomplete | None = None,
        cellComments: Incomplete | None = None,
        errors: Incomplete | None = None,
        horizontalDpi: Incomplete | None = None,
        verticalDpi: Incomplete | None = None,
        copies: Incomplete | None = None,
        id: Incomplete | None = None,
    ) -> None: ...
    def __bool__(self) -> bool: ...
    @property
    def sheet_properties(self): ...
    @property
    def fitToPage(self): ...
    @fitToPage.setter
    def fitToPage(self, value) -> None: ...
    @property
    def autoPageBreaks(self): ...
    @autoPageBreaks.setter
    def autoPageBreaks(self, value) -> None: ...
    @classmethod
    def from_tree(cls, node): ...

class PrintOptions(Serialisable):
    tagname: str
    horizontalCentered: Incomplete
    verticalCentered: Incomplete
    headings: Incomplete
    gridLines: Incomplete
    gridLinesSet: Incomplete
    def __init__(
        self,
        horizontalCentered: Incomplete | None = None,
        verticalCentered: Incomplete | None = None,
        headings: Incomplete | None = None,
        gridLines: Incomplete | None = None,
        gridLinesSet: Incomplete | None = None,
    ) -> None: ...
    def __bool__(self) -> bool: ...

class PageMargins(Serialisable):
    tagname: str
    left: Incomplete
    right: Incomplete
    top: Incomplete
    bottom: Incomplete
    header: Incomplete
    footer: Incomplete
    def __init__(
        self, left: float = 0.75, right: float = 0.75, top: int = 1, bottom: int = 1, header: float = 0.5, footer: float = 0.5
    ) -> None: ...
