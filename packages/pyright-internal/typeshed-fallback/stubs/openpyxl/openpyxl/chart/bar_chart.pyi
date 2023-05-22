from _typeshed import Incomplete, Unused
from abc import abstractmethod
from typing import ClassVar
from typing_extensions import Literal

from openpyxl.chart.axis import ChartLines, NumericAxis, SeriesAxis, TextAxis
from openpyxl.chart.label import DataLabelList
from openpyxl.descriptors.base import Alias, Typed
from openpyxl.descriptors.excel import ExtensionList

from ._3d import _3DBase
from ._chart import ChartBase

class _BarChartBase(ChartBase):
    barDir: Incomplete
    type: Alias
    grouping: Incomplete
    varyColors: Incomplete
    ser: Incomplete
    dLbls: Typed[DataLabelList, Literal[True]]
    dataLabels: Alias
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        barDir: str = "col",
        grouping: str = "clustered",
        varyColors: Incomplete | None = None,
        ser=(),
        dLbls: DataLabelList | None = None,
        **kw,
    ) -> None: ...
    @property
    @abstractmethod
    def tagname(self) -> str: ...

class BarChart(_BarChartBase):
    tagname: str
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
    tagname: str
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
    shape: Incomplete
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
        shape: Incomplete | None = None,
        serLines: ChartLines | None = None,
        extLst: Unused = None,
        **kw,
    ) -> None: ...
