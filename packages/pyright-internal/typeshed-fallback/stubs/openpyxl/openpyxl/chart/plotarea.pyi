from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class DataTable(Serialisable):
    tagname: str
    showHorzBorder: Incomplete
    showVertBorder: Incomplete
    showOutline: Incomplete
    showKeys: Incomplete
    spPr: Incomplete
    graphicalProperties: Incomplete
    txPr: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        showHorzBorder: Incomplete | None = None,
        showVertBorder: Incomplete | None = None,
        showOutline: Incomplete | None = None,
        showKeys: Incomplete | None = None,
        spPr: Incomplete | None = None,
        txPr: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class PlotArea(Serialisable):
    tagname: str
    layout: Incomplete
    dTable: Incomplete
    spPr: Incomplete
    graphicalProperties: Incomplete
    extLst: Incomplete
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
    __elements__: Incomplete
    def __init__(
        self,
        layout: Incomplete | None = None,
        dTable: Incomplete | None = None,
        spPr: Incomplete | None = None,
        _charts=(),
        _axes=(),
        extLst: Incomplete | None = None,
    ) -> None: ...
    def to_tree(self, tagname: Incomplete | None = None, idx: Incomplete | None = None, namespace: Incomplete | None = None): ...
    @classmethod
    def from_tree(cls, node): ...
