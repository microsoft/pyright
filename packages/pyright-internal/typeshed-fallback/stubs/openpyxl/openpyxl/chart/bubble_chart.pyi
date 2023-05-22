from _typeshed import Incomplete, Unused
from typing import ClassVar
from typing_extensions import Literal

from openpyxl.chart.axis import NumericAxis
from openpyxl.chart.label import DataLabelList
from openpyxl.descriptors.base import Alias, Typed
from openpyxl.descriptors.excel import ExtensionList

from ._chart import ChartBase

class BubbleChart(ChartBase):
    tagname: str
    varyColors: Incomplete
    ser: Incomplete
    dLbls: Typed[DataLabelList, Literal[True]]
    dataLabels: Alias
    bubble3D: Incomplete
    bubbleScale: Incomplete
    showNegBubbles: Incomplete
    sizeRepresents: Incomplete
    extLst: Typed[ExtensionList, Literal[True]]
    x_axis: Typed[NumericAxis, Literal[False]]
    y_axis: Typed[NumericAxis, Literal[False]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        varyColors: Incomplete | None = None,
        ser=(),
        dLbls: DataLabelList | None = None,
        bubble3D: Incomplete | None = None,
        bubbleScale: Incomplete | None = None,
        showNegBubbles: Incomplete | None = None,
        sizeRepresents: Incomplete | None = None,
        extLst: Unused = None,
        **kw,
    ) -> None: ...
