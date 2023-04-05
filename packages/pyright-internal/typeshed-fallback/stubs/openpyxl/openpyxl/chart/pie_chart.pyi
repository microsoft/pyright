from _typeshed import Incomplete
from abc import abstractmethod

from openpyxl.descriptors.serialisable import Serialisable

from ._chart import ChartBase

class _PieChartBase(ChartBase):
    varyColors: Incomplete
    ser: Incomplete
    dLbls: Incomplete
    dataLabels: Incomplete
    __elements__: Incomplete
    def __init__(self, varyColors: bool = True, ser=(), dLbls: Incomplete | None = None) -> None: ...
    @property
    @abstractmethod
    def tagname(self) -> str: ...

class PieChart(_PieChartBase):
    tagname: str
    varyColors: Incomplete
    ser: Incomplete
    dLbls: Incomplete
    firstSliceAng: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(self, firstSliceAng: int = 0, extLst: Incomplete | None = None, **kw) -> None: ...

class PieChart3D(_PieChartBase):
    tagname: str
    varyColors: Incomplete
    ser: Incomplete
    dLbls: Incomplete
    extLst: Incomplete
    __elements__: Incomplete

class DoughnutChart(_PieChartBase):
    tagname: str
    varyColors: Incomplete
    ser: Incomplete
    dLbls: Incomplete
    firstSliceAng: Incomplete
    holeSize: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(self, firstSliceAng: int = 0, holeSize: int = 10, extLst: Incomplete | None = None, **kw) -> None: ...

class CustomSplit(Serialisable):
    tagname: str
    secondPiePt: Incomplete
    __elements__: Incomplete
    def __init__(self, secondPiePt=()) -> None: ...

class ProjectedPieChart(_PieChartBase):
    tagname: str
    varyColors: Incomplete
    ser: Incomplete
    dLbls: Incomplete
    ofPieType: Incomplete
    type: Incomplete
    gapWidth: Incomplete
    splitType: Incomplete
    splitPos: Incomplete
    custSplit: Incomplete
    secondPieSize: Incomplete
    serLines: Incomplete
    join_lines: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        ofPieType: str = "pie",
        gapWidth: Incomplete | None = None,
        splitType: str = "auto",
        splitPos: Incomplete | None = None,
        custSplit: Incomplete | None = None,
        secondPieSize: int = 75,
        serLines: Incomplete | None = None,
        extLst: Incomplete | None = None,
        **kw,
    ) -> None: ...
