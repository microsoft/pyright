from _typeshed import Incomplete, Unused
from typing import ClassVar
from typing_extensions import Literal, TypeAlias

from openpyxl.chartsheet.custom import CustomChartsheetViews
from openpyxl.chartsheet.properties import ChartsheetProperties
from openpyxl.chartsheet.protection import ChartsheetProtection
from openpyxl.chartsheet.publish import WebPublishItems
from openpyxl.chartsheet.relation import DrawingHF, SheetBackgroundPicture
from openpyxl.chartsheet.views import ChartsheetViewList
from openpyxl.descriptors.base import Alias, Set, Typed
from openpyxl.descriptors.excel import ExtensionList
from openpyxl.descriptors.serialisable import Serialisable
from openpyxl.workbook.child import _WorkbookChild
from openpyxl.worksheet.drawing import Drawing
from openpyxl.worksheet.header_footer import HeaderFooter as _HeaderFooter
from openpyxl.worksheet.page import PageMargins, PrintPageSetup

_ChartsheetSheetState: TypeAlias = Literal["visible", "hidden", "veryHidden"]

class Chartsheet(_WorkbookChild, Serialisable):
    tagname: str
    mime_type: str
    sheetPr: Typed[ChartsheetProperties, Literal[True]]
    sheetViews: Typed[ChartsheetViewList, Literal[False]]
    sheetProtection: Typed[ChartsheetProtection, Literal[True]]
    customSheetViews: Typed[CustomChartsheetViews, Literal[True]]
    pageMargins: Typed[PageMargins, Literal[True]]
    pageSetup: Typed[PrintPageSetup, Literal[True]]
    drawing: Typed[Drawing, Literal[True]]
    drawingHF: Typed[DrawingHF, Literal[True]]
    picture: Typed[SheetBackgroundPicture, Literal[True]]
    webPublishItems: Typed[WebPublishItems, Literal[True]]
    extLst: Typed[ExtensionList, Literal[True]]
    sheet_state: Set[_ChartsheetSheetState]
    headerFooter: Typed[_HeaderFooter, Literal[False]]
    HeaderFooter: Alias
    __elements__: ClassVar[tuple[str, ...]]
    __attrs__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        sheetPr: ChartsheetProperties | None = None,
        sheetViews: ChartsheetViewList | None = None,
        sheetProtection: ChartsheetProtection | None = None,
        customSheetViews: CustomChartsheetViews | None = None,
        pageMargins: PageMargins | None = None,
        pageSetup: PrintPageSetup | None = None,
        headerFooter: _HeaderFooter | None = None,
        drawing: Unused = None,
        drawingHF: DrawingHF | None = None,
        picture: SheetBackgroundPicture | None = None,
        webPublishItems: WebPublishItems | None = None,
        extLst: Unused = None,
        parent: Incomplete | None = None,
        title: str = "",
        sheet_state: _ChartsheetSheetState = "visible",
    ) -> None: ...
    def add_chart(self, chart) -> None: ...
    def to_tree(self): ...
