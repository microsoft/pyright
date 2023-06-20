from _typeshed import Incomplete, Unused
from typing import ClassVar
from typing_extensions import Literal, TypeAlias

from openpyxl.chart.axis import ChartLines, NumericAxis, SeriesAxis, TextAxis
from openpyxl.chart.label import DataLabelList
from openpyxl.descriptors.base import Alias, Typed, _ConvertibleToBool
from openpyxl.descriptors.excel import ExtensionList
from openpyxl.descriptors.nested import NestedBool, NestedNoneSet, NestedSet, _HasTagAndGet, _NestedNoneSetParam

from ._3d import _3DBase
from ._chart import ChartBase

_BarChartBaseBarDir: TypeAlias = Literal["bar", "col"]
_BarChartBaseGrouping: TypeAlias = Literal["percentStacked", "clustered", "standard", "stacked"]
_BarChart3DShape: TypeAlias = Literal["cone", "coneToMax", "box", "cylinder", "pyramid", "pyramidToMax"]

class _BarChartBase(ChartBase):
    barDir: NestedSet[_BarChartBaseBarDir]
    type: Alias
    grouping: NestedSet[_BarChartBaseGrouping]
    varyColors: NestedBool[Literal[True]]
    ser: Incomplete
    dLbls: Typed[DataLabelList, Literal[True]]
    dataLabels: Alias
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        barDir: _HasTagAndGet[_BarChartBaseBarDir] | _BarChartBaseBarDir = "col",
        grouping: _HasTagAndGet[_BarChartBaseGrouping] | _BarChartBaseGrouping = "clustered",
        varyColors: _HasTagAndGet[_ConvertibleToBool | None] | _ConvertibleToBool | None = None,
        ser=(),
        dLbls: DataLabelList | None = None,
        **kw,
    ) -> None: ...

class BarChart(_BarChartBase):
    tagname: ClassVar[str]
    barDir: Incomplete
    grouping: Incomplete
    varyColors: Incomplete
    ser: Incomplete
    dLbls: Incomplete
    gapWidth: Incomplete
    overlap: Incomplete
    serLines: Typed[ChartLines, Literal[True]]
    extLst: Typed[ExtensionList, Literal[True]]
    x_axis: Typed[TextAxis, Literal[False]]
    y_axis: Typed[NumericAxis, Literal[False]]
    __elements__: ClassVar[tuple[str, ...]]
    legend: Incomplete
    def __init__(
        self,
        gapWidth: int = 150,
        overlap: Incomplete | None = None,
        serLines: ChartLines | None = None,
        extLst: Unused = None,
        **kw,
    ) -> None: ...

class BarChart3D(_BarChartBase, _3DBase):
    tagname: ClassVar[str]
    barDir: Incomplete
    grouping: Incomplete
    varyColors: Incomplete
    ser: Incomplete
    dLbls: Incomplete
    view3D: Incomplete
    floor: Incomplete
    sideWall: Incomplete
    backWall: Incomplete
    gapWidth: Incomplete
    gapDepth: Incomplete
    shape: NestedNoneSet[_BarChart3DShape]
    serLines: Typed[ChartLines, Literal[True]]
    extLst: Typed[ExtensionList, Literal[True]]
    x_axis: Typed[TextAxis, Literal[False]]
    y_axis: Typed[NumericAxis, Literal[False]]
    z_axis: Typed[SeriesAxis, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        gapWidth: int = 150,
        gapDepth: int = 150,
        shape: _NestedNoneSetParam[_BarChart3DShape] = None,
        serLines: ChartLines | None = None,
        extLst: Unused = None,
        **kw,
    ) -> None: ...
