from _typeshed import Incomplete, Unused
from abc import abstractmethod
from typing import ClassVar
from typing_extensions import Literal

from openpyxl.chart.axis import ChartLines, NumericAxis, _BaseAxis
from openpyxl.chart.label import DataLabelList
from openpyxl.chart.updown_bars import UpDownBars
from openpyxl.descriptors.base import Alias, Typed
from openpyxl.descriptors.excel import ExtensionList

from ._chart import ChartBase

class _LineChartBase(ChartBase):
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
        **kw,
    ) -> None: ...
    @property
    @abstractmethod
    def tagname(self) -> str: ...

class LineChart(_LineChartBase):
    tagname: str
    grouping: Incomplete
    varyColors: Incomplete
    ser: Incomplete
    dLbls: Incomplete
    dropLines: Incomplete
    hiLowLines: Typed[ChartLines, Literal[True]]
    upDownBars: Typed[UpDownBars, Literal[True]]
    marker: Incomplete
    smooth: Incomplete
    extLst: Typed[ExtensionList, Literal[True]]
    x_axis: Typed[_BaseAxis, Literal[False]]
    y_axis: Typed[NumericAxis, Literal[False]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        hiLowLines: ChartLines | None = None,
        upDownBars: UpDownBars | None = None,
        marker: Incomplete | None = None,
        smooth: Incomplete | None = None,
        extLst: Unused = None,
        **kw,
    ) -> None: ...

class LineChart3D(_LineChartBase):
    tagname: str
    grouping: Incomplete
    varyColors: Incomplete
    ser: Incomplete
    dLbls: Incomplete
    dropLines: Incomplete
    gapDepth: Incomplete
    hiLowLines: Typed[ChartLines, Literal[True]]
    upDownBars: Typed[UpDownBars, Literal[True]]
    marker: Incomplete
    smooth: Incomplete
    extLst: Typed[ExtensionList, Literal[True]]
    x_axis: Typed[ExtensionList, Literal[False]]
    y_axis: Typed[ExtensionList, Literal[False]]
    z_axis: Typed[ExtensionList, Literal[False]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        gapDepth: Incomplete | None = None,
        hiLowLines: ChartLines | None = None,
        upDownBars: UpDownBars | None = None,
        marker: Incomplete | None = None,
        smooth: Incomplete | None = None,
        **kw,
    ) -> None: ...
