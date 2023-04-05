from _typeshed import Incomplete
from abc import abstractmethod

from ._chart import ChartBase

class _AreaChartBase(ChartBase):
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
    x_axis: Incomplete
    y_axis: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(self, axId: Incomplete | None = None, extLst: Incomplete | None = None, **kw) -> None: ...

class AreaChart3D(AreaChart):
    tagname: str
    grouping: Incomplete
    varyColors: Incomplete
    ser: Incomplete
    dLbls: Incomplete
    dropLines: Incomplete
    gapDepth: Incomplete
    x_axis: Incomplete
    y_axis: Incomplete
    z_axis: Incomplete
    __elements__: Incomplete
    def __init__(self, gapDepth: Incomplete | None = None, **kw) -> None: ...
