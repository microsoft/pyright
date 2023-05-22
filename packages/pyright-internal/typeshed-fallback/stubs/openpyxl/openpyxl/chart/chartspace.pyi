from _typeshed import Incomplete, Unused
from typing import ClassVar, overload
from typing_extensions import Literal

from openpyxl.chart.legend import Legend
from openpyxl.chart.pivot import PivotSource
from openpyxl.chart.plotarea import PlotArea
from openpyxl.chart.print_settings import PrintSettings
from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.chart.text import RichText
from openpyxl.chart.title import Title
from openpyxl.descriptors.base import Alias, String, Typed
from openpyxl.descriptors.excel import ExtensionList
from openpyxl.descriptors.serialisable import Serialisable
from openpyxl.drawing.colors import ColorMapping

class ChartContainer(Serialisable):
    tagname: str
    title: Typed[Title, Literal[True]]
    autoTitleDeleted: Incomplete
    pivotFmts: Incomplete
    view3D: Incomplete
    floor: Incomplete
    sideWall: Incomplete
    backWall: Incomplete
    plotArea: Typed[PlotArea, Literal[False]]
    legend: Typed[Legend, Literal[True]]
    plotVisOnly: Incomplete
    dispBlanksAs: Incomplete
    showDLblsOverMax: Incomplete
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        title: Title | None = None,
        autoTitleDeleted: Incomplete | None = None,
        pivotFmts=(),
        view3D: Incomplete | None = None,
        floor: Incomplete | None = None,
        sideWall: Incomplete | None = None,
        backWall: Incomplete | None = None,
        plotArea: PlotArea | None = None,
        legend: Legend | None = None,
        plotVisOnly: bool = True,
        dispBlanksAs: str = "gap",
        showDLblsOverMax: Incomplete | None = None,
        extLst: Unused = None,
    ) -> None: ...

class Protection(Serialisable):
    tagname: str
    chartObject: Incomplete
    data: Incomplete
    formatting: Incomplete
    selection: Incomplete
    userInterface: Incomplete
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        chartObject: Incomplete | None = None,
        data: Incomplete | None = None,
        formatting: Incomplete | None = None,
        selection: Incomplete | None = None,
        userInterface: Incomplete | None = None,
    ) -> None: ...

class ExternalData(Serialisable):
    tagname: str
    autoUpdate: Incomplete
    id: String[Literal[False]]
    @overload
    def __init__(self, autoUpdate: Incomplete | None = None, *, id: str) -> None: ...
    @overload
    def __init__(self, autoUpdate: Incomplete | None, id: str) -> None: ...

class ChartSpace(Serialisable):
    tagname: str
    date1904: Incomplete
    lang: Incomplete
    roundedCorners: Incomplete
    style: Incomplete
    clrMapOvr: Typed[ColorMapping, Literal[True]]
    pivotSource: Typed[PivotSource, Literal[True]]
    protection: Typed[Protection, Literal[True]]
    chart: Typed[ChartContainer, Literal[False]]
    spPr: Typed[GraphicalProperties, Literal[True]]
    graphicalProperties: Alias
    txPr: Typed[RichText, Literal[True]]
    textProperties: Alias
    externalData: Typed[ExternalData, Literal[True]]
    printSettings: Typed[PrintSettings, Literal[True]]
    userShapes: Incomplete
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    @overload
    def __init__(
        self,
        date1904: Incomplete | None = None,
        lang: Incomplete | None = None,
        roundedCorners: Incomplete | None = None,
        style: Incomplete | None = None,
        clrMapOvr: ColorMapping | None = None,
        pivotSource: PivotSource | None = None,
        protection: Protection | None = None,
        *,
        chart: ChartContainer,
        spPr: GraphicalProperties | None = None,
        txPr: RichText | None = None,
        externalData: ExternalData | None = None,
        printSettings: PrintSettings | None = None,
        userShapes: Incomplete | None = None,
        extLst: Unused = None,
    ) -> None: ...
    @overload
    def __init__(
        self,
        date1904: Incomplete | None,
        lang: Incomplete | None,
        roundedCorners: Incomplete | None,
        style: Incomplete | None,
        clrMapOvr: ColorMapping | None,
        pivotSource: PivotSource | None,
        protection: Protection | None,
        chart: ChartContainer,
        spPr: GraphicalProperties | None = None,
        txPr: RichText | None = None,
        externalData: ExternalData | None = None,
        printSettings: PrintSettings | None = None,
        userShapes: Incomplete | None = None,
        extLst: Unused = None,
    ) -> None: ...
    def to_tree(self, tagname: Incomplete | None = None, idx: Incomplete | None = None, namespace: Incomplete | None = None): ...
