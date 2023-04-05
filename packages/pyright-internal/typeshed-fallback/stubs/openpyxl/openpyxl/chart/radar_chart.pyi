from _typeshed import Incomplete

from ._chart import ChartBase

class RadarChart(ChartBase):
    tagname: str
    radarStyle: Incomplete
    type: Incomplete
    varyColors: Incomplete
    ser: Incomplete
    dLbls: Incomplete
    dataLabels: Incomplete
    extLst: Incomplete
    x_axis: Incomplete
    y_axis: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        radarStyle: str = "standard",
        varyColors: Incomplete | None = None,
        ser=(),
        dLbls: Incomplete | None = None,
        extLst: Incomplete | None = None,
        **kw,
    ) -> None: ...
