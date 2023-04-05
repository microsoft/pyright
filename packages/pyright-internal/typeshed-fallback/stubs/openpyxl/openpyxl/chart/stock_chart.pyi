from _typeshed import Incomplete

from ._chart import ChartBase

class StockChart(ChartBase):
    tagname: str
    ser: Incomplete
    dLbls: Incomplete
    dataLabels: Incomplete
    dropLines: Incomplete
    hiLowLines: Incomplete
    upDownBars: Incomplete
    extLst: Incomplete
    x_axis: Incomplete
    y_axis: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        ser=(),
        dLbls: Incomplete | None = None,
        dropLines: Incomplete | None = None,
        hiLowLines: Incomplete | None = None,
        upDownBars: Incomplete | None = None,
        extLst: Incomplete | None = None,
        **kw,
    ) -> None: ...
