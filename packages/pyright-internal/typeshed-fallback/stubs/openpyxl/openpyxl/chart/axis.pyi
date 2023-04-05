from _typeshed import Incomplete
from abc import abstractmethod

from openpyxl.descriptors.serialisable import Serialisable

class ChartLines(Serialisable):
    tagname: str
    spPr: Incomplete
    graphicalProperties: Incomplete
    def __init__(self, spPr: Incomplete | None = None) -> None: ...

class Scaling(Serialisable):
    tagname: str
    logBase: Incomplete
    orientation: Incomplete
    max: Incomplete
    min: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        logBase: Incomplete | None = None,
        orientation: str = "minMax",
        max: Incomplete | None = None,
        min: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class _BaseAxis(Serialisable):
    axId: Incomplete
    scaling: Incomplete
    delete: Incomplete
    axPos: Incomplete
    majorGridlines: Incomplete
    minorGridlines: Incomplete
    title: Incomplete
    numFmt: Incomplete
    number_format: Incomplete
    majorTickMark: Incomplete
    minorTickMark: Incomplete
    tickLblPos: Incomplete
    spPr: Incomplete
    graphicalProperties: Incomplete
    txPr: Incomplete
    textProperties: Incomplete
    crossAx: Incomplete
    crosses: Incomplete
    crossesAt: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        axId: Incomplete | None = None,
        scaling: Incomplete | None = None,
        delete: Incomplete | None = None,
        axPos: str = "l",
        majorGridlines: Incomplete | None = None,
        minorGridlines: Incomplete | None = None,
        title: Incomplete | None = None,
        numFmt: Incomplete | None = None,
        majorTickMark: Incomplete | None = None,
        minorTickMark: Incomplete | None = None,
        tickLblPos: Incomplete | None = None,
        spPr: Incomplete | None = None,
        txPr: Incomplete | None = None,
        crossAx: Incomplete | None = None,
        crosses: Incomplete | None = None,
        crossesAt: Incomplete | None = None,
    ) -> None: ...
    @property
    @abstractmethod
    def tagname(self) -> str: ...

class DisplayUnitsLabel(Serialisable):
    tagname: str
    layout: Incomplete
    tx: Incomplete
    text: Incomplete
    spPr: Incomplete
    graphicalProperties: Incomplete
    txPr: Incomplete
    textPropertes: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        layout: Incomplete | None = None,
        tx: Incomplete | None = None,
        spPr: Incomplete | None = None,
        txPr: Incomplete | None = None,
    ) -> None: ...

class DisplayUnitsLabelList(Serialisable):
    tagname: str
    custUnit: Incomplete
    builtInUnit: Incomplete
    dispUnitsLbl: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        custUnit: Incomplete | None = None,
        builtInUnit: Incomplete | None = None,
        dispUnitsLbl: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class NumericAxis(_BaseAxis):
    tagname: str
    axId: Incomplete
    scaling: Incomplete
    delete: Incomplete
    axPos: Incomplete
    majorGridlines: Incomplete
    minorGridlines: Incomplete
    title: Incomplete
    numFmt: Incomplete
    majorTickMark: Incomplete
    minorTickMark: Incomplete
    tickLblPos: Incomplete
    spPr: Incomplete
    txPr: Incomplete
    crossAx: Incomplete
    crosses: Incomplete
    crossesAt: Incomplete
    crossBetween: Incomplete
    majorUnit: Incomplete
    minorUnit: Incomplete
    dispUnits: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        crossBetween: Incomplete | None = None,
        majorUnit: Incomplete | None = None,
        minorUnit: Incomplete | None = None,
        dispUnits: Incomplete | None = None,
        extLst: Incomplete | None = None,
        **kw,
    ) -> None: ...
    @classmethod
    def from_tree(cls, node): ...

class TextAxis(_BaseAxis):
    tagname: str
    axId: Incomplete
    scaling: Incomplete
    delete: Incomplete
    axPos: Incomplete
    majorGridlines: Incomplete
    minorGridlines: Incomplete
    title: Incomplete
    numFmt: Incomplete
    majorTickMark: Incomplete
    minorTickMark: Incomplete
    tickLblPos: Incomplete
    spPr: Incomplete
    txPr: Incomplete
    crossAx: Incomplete
    crosses: Incomplete
    crossesAt: Incomplete
    auto: Incomplete
    lblAlgn: Incomplete
    lblOffset: Incomplete
    tickLblSkip: Incomplete
    tickMarkSkip: Incomplete
    noMultiLvlLbl: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        auto: Incomplete | None = None,
        lblAlgn: Incomplete | None = None,
        lblOffset: int = 100,
        tickLblSkip: Incomplete | None = None,
        tickMarkSkip: Incomplete | None = None,
        noMultiLvlLbl: Incomplete | None = None,
        extLst: Incomplete | None = None,
        **kw,
    ) -> None: ...

class DateAxis(TextAxis):
    tagname: str
    axId: Incomplete
    scaling: Incomplete
    delete: Incomplete
    axPos: Incomplete
    majorGridlines: Incomplete
    minorGridlines: Incomplete
    title: Incomplete
    numFmt: Incomplete
    majorTickMark: Incomplete
    minorTickMark: Incomplete
    tickLblPos: Incomplete
    spPr: Incomplete
    txPr: Incomplete
    crossAx: Incomplete
    crosses: Incomplete
    crossesAt: Incomplete
    auto: Incomplete
    lblOffset: Incomplete
    baseTimeUnit: Incomplete
    majorUnit: Incomplete
    majorTimeUnit: Incomplete
    minorUnit: Incomplete
    minorTimeUnit: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        auto: Incomplete | None = None,
        lblOffset: Incomplete | None = None,
        baseTimeUnit: Incomplete | None = None,
        majorUnit: Incomplete | None = None,
        majorTimeUnit: Incomplete | None = None,
        minorUnit: Incomplete | None = None,
        minorTimeUnit: Incomplete | None = None,
        extLst: Incomplete | None = None,
        **kw,
    ) -> None: ...

class SeriesAxis(_BaseAxis):
    tagname: str
    axId: Incomplete
    scaling: Incomplete
    delete: Incomplete
    axPos: Incomplete
    majorGridlines: Incomplete
    minorGridlines: Incomplete
    title: Incomplete
    numFmt: Incomplete
    majorTickMark: Incomplete
    minorTickMark: Incomplete
    tickLblPos: Incomplete
    spPr: Incomplete
    txPr: Incomplete
    crossAx: Incomplete
    crosses: Incomplete
    crossesAt: Incomplete
    tickLblSkip: Incomplete
    tickMarkSkip: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        tickLblSkip: Incomplete | None = None,
        tickMarkSkip: Incomplete | None = None,
        extLst: Incomplete | None = None,
        **kw,
    ) -> None: ...
