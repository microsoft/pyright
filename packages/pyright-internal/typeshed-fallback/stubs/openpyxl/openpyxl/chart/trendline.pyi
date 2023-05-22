from _typeshed import Incomplete, Unused
from typing import ClassVar
from typing_extensions import Literal

from openpyxl.chart.data_source import NumFmt
from openpyxl.chart.layout import Layout
from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.chart.text import RichText, Text
from openpyxl.descriptors.base import Alias, String, Typed
from openpyxl.descriptors.excel import ExtensionList
from openpyxl.descriptors.serialisable import Serialisable

class TrendlineLabel(Serialisable):
    tagname: str
    layout: Typed[Layout, Literal[True]]
    tx: Typed[Text, Literal[True]]
    numFmt: Typed[NumFmt, Literal[True]]
    spPr: Typed[GraphicalProperties, Literal[True]]
    graphicalProperties: Alias
    txPr: Typed[RichText, Literal[True]]
    textProperties: Alias
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        layout: Layout | None = None,
        tx: Text | None = None,
        numFmt: NumFmt | None = None,
        spPr: GraphicalProperties | None = None,
        txPr: RichText | None = None,
        extLst: Unused = None,
    ) -> None: ...

class Trendline(Serialisable):
    tagname: str
    name: String[Literal[True]]
    spPr: Typed[ExtensionList, Literal[True]]
    graphicalProperties: Alias
    trendlineType: Incomplete
    order: Incomplete
    period: Incomplete
    forward: Incomplete
    backward: Incomplete
    intercept: Incomplete
    dispRSqr: Incomplete
    dispEq: Incomplete
    trendlineLbl: Typed[ExtensionList, Literal[True]]
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        name: str | None = None,
        spPr: ExtensionList | None = None,
        trendlineType: str = "linear",
        order: Incomplete | None = None,
        period: Incomplete | None = None,
        forward: Incomplete | None = None,
        backward: Incomplete | None = None,
        intercept: Incomplete | None = None,
        dispRSqr: Incomplete | None = None,
        dispEq: Incomplete | None = None,
        trendlineLbl: ExtensionList | None = None,
        extLst: Unused = None,
    ) -> None: ...
