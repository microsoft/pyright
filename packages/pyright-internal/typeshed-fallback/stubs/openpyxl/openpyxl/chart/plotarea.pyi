from _typeshed import Incomplete, Unused
from typing import ClassVar
from typing_extensions import Literal

from openpyxl.chart.layout import Layout
from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.chart.text import RichText
from openpyxl.descriptors.base import Alias, Typed
from openpyxl.descriptors.excel import ExtensionList
from openpyxl.descriptors.serialisable import Serialisable

class DataTable(Serialisable):
    tagname: str
    showHorzBorder: Incomplete
    showVertBorder: Incomplete
    showOutline: Incomplete
    showKeys: Incomplete
    spPr: Typed[GraphicalProperties, Literal[True]]
    graphicalProperties: Alias
    txPr: Typed[RichText, Literal[True]]
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        showHorzBorder: Incomplete | None = None,
        showVertBorder: Incomplete | None = None,
        showOutline: Incomplete | None = None,
        showKeys: Incomplete | None = None,
        spPr: GraphicalProperties | None = None,
        txPr: RichText | None = None,
        extLst: Unused = None,
    ) -> None: ...

class PlotArea(Serialisable):
    tagname: str
    layout: Typed[Layout, Literal[True]]
    dTable: Typed[DataTable, Literal[True]]
    spPr: Typed[GraphicalProperties, Literal[True]]
    graphicalProperties: Alias
    extLst: Typed[ExtensionList, Literal[True]]
    areaChart: Incomplete
    area3DChart: Incomplete
    lineChart: Incomplete
    line3DChart: Incomplete
    stockChart: Incomplete
    radarChart: Incomplete
    scatterChart: Incomplete
    pieChart: Incomplete
    pie3DChart: Incomplete
    doughnutChart: Incomplete
    barChart: Incomplete
    bar3DChart: Incomplete
    ofPieChart: Incomplete
    surfaceChart: Incomplete
    surface3DChart: Incomplete
    bubbleChart: Incomplete
    valAx: Incomplete
    catAx: Incomplete
    dateAx: Incomplete
    serAx: Incomplete
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        layout: Layout | None = None,
        dTable: DataTable | None = None,
        spPr: GraphicalProperties | None = None,
        _charts=(),
        _axes=(),
        extLst: Unused = None,
    ) -> None: ...
    def to_tree(self, tagname: Incomplete | None = None, idx: Incomplete | None = None, namespace: Incomplete | None = None): ...
    @classmethod
    def from_tree(cls, node): ...
