from _typeshed import Incomplete, Unused
from typing import ClassVar
from typing_extensions import Literal, TypeAlias

from openpyxl.chart.data_source import AxDataSource, NumDataSource, StrRef
from openpyxl.chart.error_bar import ErrorBars
from openpyxl.chart.label import DataLabelList
from openpyxl.chart.marker import Marker
from openpyxl.chart.picture import PictureOptions
from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.chart.trendline import Trendline
from openpyxl.descriptors.base import Alias, Typed, _ConvertibleToBool, _ConvertibleToInt
from openpyxl.descriptors.excel import ExtensionList
from openpyxl.descriptors.nested import NestedBool, NestedInteger, NestedNoneSet, NestedText, _HasTagAndGet, _NestedNoneSetParam
from openpyxl.descriptors.serialisable import Serialisable

_SeriesShape: TypeAlias = Literal["cone", "coneToMax", "box", "cylinder", "pyramid", "pyramidToMax"]

attribute_mapping: Incomplete

class SeriesLabel(Serialisable):
    tagname: ClassVar[str]
    strRef: Typed[StrRef, Literal[True]]
    v: NestedText[str, Literal[True]]
    value: Alias
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(self, strRef: StrRef | None = None, v: object = None) -> None: ...

class Series(Serialisable):
    tagname: ClassVar[str]
    idx: NestedInteger[Literal[False]]
    order: NestedInteger[Literal[False]]
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
    invertIfNegative: NestedBool[Literal[True]]
    shape: NestedNoneSet[_SeriesShape]
    xVal: Typed[AxDataSource, Literal[True]]
    yVal: Typed[NumDataSource, Literal[True]]
    bubbleSize: Typed[NumDataSource, Literal[True]]
    zVal: Alias
    bubble3D: NestedBool[Literal[True]]
    marker: Typed[Marker, Literal[True]]
    smooth: NestedBool[Literal[True]]
    explosion: NestedInteger[Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        idx: _HasTagAndGet[_ConvertibleToInt] | _ConvertibleToInt = 0,
        order: _HasTagAndGet[_ConvertibleToInt] | _ConvertibleToInt = 0,
        tx: SeriesLabel | None = None,
        spPr: GraphicalProperties | None = None,
        pictureOptions: PictureOptions | None = None,
        dPt=(),
        dLbls: DataLabelList | None = None,
        trendline: Trendline | None = None,
        errBars: ErrorBars | None = None,
        cat: AxDataSource | None = None,
        val: NumDataSource | None = None,
        invertIfNegative: _HasTagAndGet[_ConvertibleToBool | None] | _ConvertibleToBool | None = None,
        shape: _NestedNoneSetParam[_SeriesShape] = None,
        xVal: AxDataSource | None = None,
        yVal: NumDataSource | None = None,
        bubbleSize: NumDataSource | None = None,
        bubble3D: _HasTagAndGet[_ConvertibleToBool | None] | _ConvertibleToBool | None = None,
        marker: Marker | None = None,
        smooth: _HasTagAndGet[_ConvertibleToBool | None] | _ConvertibleToBool | None = None,
        explosion: _HasTagAndGet[_ConvertibleToInt | None] | _ConvertibleToInt | None = None,
        extLst: Unused = None,
    ) -> None: ...
    def to_tree(self, tagname: str | None = None, idx: Incomplete | None = None): ...  # type: ignore[override]

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
