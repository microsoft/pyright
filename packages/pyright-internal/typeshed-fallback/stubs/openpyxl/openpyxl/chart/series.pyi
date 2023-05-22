from _typeshed import Incomplete, Unused
from typing import ClassVar
from typing_extensions import Literal

from openpyxl.chart.data_source import AxDataSource, NumDataSource, StrRef
from openpyxl.chart.error_bar import ErrorBars
from openpyxl.chart.label import DataLabelList
from openpyxl.chart.marker import Marker
from openpyxl.chart.picture import PictureOptions
from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.chart.trendline import Trendline
from openpyxl.descriptors.base import Alias, Typed
from openpyxl.descriptors.excel import ExtensionList
from openpyxl.descriptors.serialisable import Serialisable

attribute_mapping: Incomplete

class SeriesLabel(Serialisable):
    tagname: str
    strRef: Typed[StrRef, Literal[True]]
    v: Incomplete
    value: Alias
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(self, strRef: StrRef | None = None, v: Incomplete | None = None) -> None: ...

class Series(Serialisable):
    tagname: str
    idx: Incomplete
    order: Incomplete
    tx: Typed[SeriesLabel, Literal[True]]
    title: Alias
    spPr: Typed[GraphicalProperties, Literal[True]]
    graphicalProperties: Incomplete
    pictureOptions: Typed[PictureOptions, Literal[True]]
    dPt: Incomplete
    data_points: Alias
    dLbls: Typed[DataLabelList, Literal[True]]
    labels: Alias
    trendline: Typed[Trendline, Literal[True]]
    errBars: Typed[ErrorBars, Literal[True]]
    cat: Typed[AxDataSource, Literal[True]]
    identifiers: Alias
    val: Typed[NumDataSource, Literal[True]]
    extLst: Typed[ExtensionList, Literal[True]]
    invertIfNegative: Incomplete
    shape: Incomplete
    xVal: Typed[AxDataSource, Literal[True]]
    yVal: Typed[NumDataSource, Literal[True]]
    bubbleSize: Typed[NumDataSource, Literal[True]]
    zVal: Alias
    bubble3D: Incomplete
    marker: Typed[Marker, Literal[True]]
    smooth: Incomplete
    explosion: Incomplete
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        idx: int = 0,
        order: int = 0,
        tx: SeriesLabel | None = None,
        spPr: GraphicalProperties | None = None,
        pictureOptions: PictureOptions | None = None,
        dPt=(),
        dLbls: DataLabelList | None = None,
        trendline: Trendline | None = None,
        errBars: ErrorBars | None = None,
        cat: AxDataSource | None = None,
        val: NumDataSource | None = None,
        invertIfNegative: Incomplete | None = None,
        shape: Incomplete | None = None,
        xVal: AxDataSource | None = None,
        yVal: NumDataSource | None = None,
        bubbleSize: NumDataSource | None = None,
        bubble3D: Incomplete | None = None,
        marker: Marker | None = None,
        smooth: Incomplete | None = None,
        explosion: Incomplete | None = None,
        extLst: Unused = None,
    ) -> None: ...
    def to_tree(self, tagname: Incomplete | None = None, idx: Incomplete | None = None): ...  # type: ignore[override]

class XYSeries(Series):
    idx: Incomplete
    order: Incomplete
    tx: Incomplete
    spPr: Incomplete
    dPt: Incomplete
    dLbls: Incomplete
    trendline: Incomplete
    errBars: Incomplete
    xVal: Incomplete
    yVal: Incomplete
    invertIfNegative: Incomplete
    bubbleSize: Incomplete
    bubble3D: Incomplete
    marker: Incomplete
    smooth: Incomplete
