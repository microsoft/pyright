from _typeshed import Incomplete, Unused
from typing import ClassVar
from typing_extensions import Literal

from openpyxl.chart.axis import NumericAxis, TextAxis
from openpyxl.chart.label import DataLabelList
from openpyxl.descriptors.base import Alias, Typed
from openpyxl.descriptors.excel import ExtensionList

from ._chart import ChartBase as ChartBase

class ScatterChart(ChartBase):
    tagname: str
    scatterStyle: Incomplete
    varyColors: Incomplete
    ser: Incomplete
    dLbls: Typed[DataLabelList, Literal[True]]
    dataLabels: Alias
    extLst: Typed[ExtensionList, Literal[True]]
    x_axis: Typed[NumericAxis | TextAxis, Literal[False]]
    y_axis: Typed[NumericAxis, Literal[False]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        scatterStyle: Incomplete | None = None,
        varyColors: Incomplete | None = None,
        ser=(),
        dLbls: DataLabelList | None = None,
        extLst: Unused = None,
        **kw,
    ) -> None: ...
