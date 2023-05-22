from _typeshed import Incomplete, Unused
from abc import abstractmethod
from typing import ClassVar
from typing_extensions import Literal

from openpyxl.chart.axis import ChartLines
from openpyxl.chart.label import DataLabelList
from openpyxl.descriptors.base import Alias, Typed
from openpyxl.descriptors.excel import ExtensionList
from openpyxl.descriptors.serialisable import Serialisable

from ._chart import ChartBase

class _PieChartBase(ChartBase):
    varyColors: Incomplete
    ser: Incomplete
    dLbls: Typed[DataLabelList, Literal[True]]
    dataLabels: Alias
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(self, varyColors: bool = True, ser=(), dLbls: DataLabelList | None = None) -> None: ...
    @property
    @abstractmethod
    def tagname(self) -> str: ...

class PieChart(_PieChartBase):
    tagname: str
    varyColors: Incomplete
    ser: Incomplete
    dLbls: Incomplete
    firstSliceAng: Incomplete
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(self, firstSliceAng: int = 0, extLst: Unused = None, **kw) -> None: ...

class PieChart3D(_PieChartBase):
    tagname: str
    varyColors: Incomplete
    ser: Incomplete
    dLbls: Incomplete
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]

class DoughnutChart(_PieChartBase):
    tagname: str
    varyColors: Incomplete
    ser: Incomplete
    dLbls: Incomplete
    firstSliceAng: Incomplete
    holeSize: Incomplete
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(self, firstSliceAng: int = 0, holeSize: int = 10, extLst: Unused = None, **kw) -> None: ...

class CustomSplit(Serialisable):
    tagname: str
    secondPiePt: Incomplete
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(self, secondPiePt=()) -> None: ...

class ProjectedPieChart(_PieChartBase):
    tagname: str
    varyColors: Incomplete
    ser: Incomplete
    dLbls: Incomplete
    ofPieType: Incomplete
    type: Alias
    gapWidth: Incomplete
    splitType: Incomplete
    splitPos: Incomplete
    custSplit: Typed[CustomSplit, Literal[True]]
    secondPieSize: Incomplete
    serLines: Typed[ChartLines, Literal[True]]
    join_lines: Alias
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        ofPieType: str = "pie",
        gapWidth: Incomplete | None = None,
        splitType: str = "auto",
        splitPos: Incomplete | None = None,
        custSplit: CustomSplit | None = None,
        secondPieSize: int = 75,
        serLines: ChartLines | None = None,
        extLst: Unused = None,
        **kw,
    ) -> None: ...
