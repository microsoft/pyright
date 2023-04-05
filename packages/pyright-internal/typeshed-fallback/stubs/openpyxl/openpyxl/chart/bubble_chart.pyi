from _typeshed import Incomplete

from ._chart import ChartBase

class BubbleChart(ChartBase):
    tagname: str
    varyColors: Incomplete
    ser: Incomplete
    dLbls: Incomplete
    dataLabels: Incomplete
    bubble3D: Incomplete
    bubbleScale: Incomplete
    showNegBubbles: Incomplete
    sizeRepresents: Incomplete
    extLst: Incomplete
    x_axis: Incomplete
    y_axis: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        varyColors: Incomplete | None = None,
        ser=(),
        dLbls: Incomplete | None = None,
        bubble3D: Incomplete | None = None,
        bubbleScale: Incomplete | None = None,
        showNegBubbles: Incomplete | None = None,
        sizeRepresents: Incomplete | None = None,
        extLst: Incomplete | None = None,
        **kw,
    ) -> None: ...
