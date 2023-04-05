from _typeshed import Incomplete
from abc import abstractmethod

from ._chart import ChartBase

class _LineChartBase(ChartBase):
    grouping: Incomplete
    varyColors: Incomplete
    ser: Incomplete
    dLbls: Incomplete
    dataLabels: Incomplete
    dropLines: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        grouping: str = "standard",
        varyColors: Incomplete | None = None,
        ser=(),
        dLbls: Incomplete | None = None,
        dropLines: Incomplete | None = None,
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
    hiLowLines: Incomplete
    upDownBars: Incomplete
    marker: Incomplete
    smooth: Incomplete
    extLst: Incomplete
    x_axis: Incomplete
    y_axis: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        hiLowLines: Incomplete | None = None,
        upDownBars: Incomplete | None = None,
        marker: Incomplete | None = None,
        smooth: Incomplete | None = None,
        extLst: Incomplete | None = None,
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
    hiLowLines: Incomplete
    upDownBars: Incomplete
    marker: Incomplete
    smooth: Incomplete
    extLst: Incomplete
    x_axis: Incomplete
    y_axis: Incomplete
    z_axis: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        gapDepth: Incomplete | None = None,
        hiLowLines: Incomplete | None = None,
        upDownBars: Incomplete | None = None,
        marker: Incomplete | None = None,
        smooth: Incomplete | None = None,
        **kw,
    ) -> None: ...
