from _typeshed import Incomplete, Unused
from abc import abstractmethod
from typing import ClassVar
from typing_extensions import Literal

from openpyxl.chart.axis import ChartLines, NumericAxis, SeriesAxis, TextAxis
from openpyxl.chart.label import DataLabelList
from openpyxl.descriptors.base import Alias, Typed
from openpyxl.descriptors.excel import ExtensionList

from ._chart import ChartBase

class _AreaChartBase(ChartBase):
    grouping: Incomplete
    varyColors: Incomplete
    ser: Incomplete
    dLbls: Typed[DataLabelList, Literal[True]]
    dataLabels: Alias
    dropLines: Typed[ChartLines, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        grouping: str = "standard",
        varyColors: Incomplete | None = None,
        ser=(),
        dLbls: DataLabelList | None = None,
        dropLines: ChartLines | None = None,
    ) -> None: ...
    @property
    @abstractmethod
    def tagname(self) -> str: ...

class AreaChart(_AreaChartBase):
    tagname: str
    grouping: Incomplete
    varyColors: Incomplete
    ser: Incomplete
    dLbls: Incomplete
    dropLines: Incomplete
    x_axis: Typed[TextAxis, Literal[False]]
    y_axis: Typed[NumericAxis, Literal[False]]
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(self, axId: Unused = None, extLst: Unused = None, **kw) -> None: ...

class AreaChart3D(AreaChart):
    tagname: str
    grouping: Incomplete
    varyColors: Incomplete
    ser: Incomplete
    dLbls: Incomplete
    dropLines: Incomplete
    gapDepth: Incomplete
    x_axis: Typed[TextAxis, Literal[False]]
    y_axis: Typed[NumericAxis, Literal[False]]
    z_axis: Typed[SeriesAxis, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(self, gapDepth: Incomplete | None = None, **kw) -> None: ...
