from _typeshed import Incomplete, Unused
from typing import ClassVar
from typing_extensions import Literal

from openpyxl.chart.axis import NumericAxis, TextAxis
from openpyxl.chart.label import DataLabelList
from openpyxl.descriptors.base import Alias, Typed
from openpyxl.descriptors.excel import ExtensionList

from ._chart import ChartBase

class RadarChart(ChartBase):
    tagname: str
    radarStyle: Incomplete
    type: Alias
    varyColors: Incomplete
    ser: Incomplete
    dLbls: Typed[DataLabelList, Literal[True]]
    dataLabels: Alias
    extLst: Typed[ExtensionList, Literal[True]]
    x_axis: Typed[TextAxis, Literal[False]]
    y_axis: Typed[NumericAxis, Literal[False]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        radarStyle: str = "standard",
        varyColors: Incomplete | None = None,
        ser=(),
        dLbls: DataLabelList | None = None,
        extLst: Unused = None,
        **kw,
    ) -> None: ...
