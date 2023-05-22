from _typeshed import Incomplete, Unused
from abc import abstractmethod
from typing import ClassVar
from typing_extensions import Literal

from openpyxl.chart.layout import Layout
from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.chart.text import RichText, Text
from openpyxl.descriptors.base import Alias, Typed
from openpyxl.descriptors.excel import ExtensionList
from openpyxl.descriptors.serialisable import Serialisable

class ChartLines(Serialisable):
    tagname: str
    spPr: Typed[GraphicalProperties, Literal[True]]
    graphicalProperties: Alias
    def __init__(self, spPr: GraphicalProperties | None = None) -> None: ...

class Scaling(Serialisable):
    tagname: str
    logBase: Incomplete
    orientation: Incomplete
    max: Incomplete
    min: Incomplete
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        logBase: Incomplete | None = None,
        orientation: str = "minMax",
        max: Incomplete | None = None,
        min: Incomplete | None = None,
        extLst: Unused = None,
    ) -> None: ...

class _BaseAxis(Serialisable):
    axId: Incomplete
    scaling: Typed[Scaling, Literal[False]]
    delete: Incomplete
    axPos: Incomplete
    majorGridlines: Typed[ChartLines, Literal[True]]
    minorGridlines: Typed[ChartLines, Literal[True]]
    title: Incomplete
    numFmt: Incomplete
    number_format: Alias
    majorTickMark: Incomplete
    minorTickMark: Incomplete
    tickLblPos: Incomplete
    spPr: Typed[GraphicalProperties, Literal[True]]
    graphicalProperties: Alias
    txPr: Typed[RichText, Literal[True]]
    textProperties: Alias
    crossAx: Incomplete
    crosses: Incomplete
    crossesAt: Incomplete
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        axId: Incomplete | None = None,
        scaling: Scaling | None = None,
        delete: Incomplete | None = None,
        axPos: str = "l",
        majorGridlines: ChartLines | None = None,
        minorGridlines: ChartLines | None = None,
        title: Incomplete | None = None,
        numFmt: Incomplete | None = None,
        majorTickMark: Incomplete | None = None,
        minorTickMark: Incomplete | None = None,
        tickLblPos: Incomplete | None = None,
        spPr: GraphicalProperties | None = None,
        txPr: RichText | None = None,
        crossAx: Incomplete | None = None,
        crosses: Incomplete | None = None,
        crossesAt: Incomplete | None = None,
    ) -> None: ...
    @property
    @abstractmethod
    def tagname(self) -> str: ...

class DisplayUnitsLabel(Serialisable):
    tagname: str
    layout: Typed[Layout, Literal[True]]
    tx: Typed[Text, Literal[True]]
    text: Alias
    spPr: Typed[GraphicalProperties, Literal[True]]
    graphicalProperties: Alias
    txPr: Typed[RichText, Literal[True]]
    textPropertes: Alias
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        layout: Layout | None = None,
        tx: Text | None = None,
        spPr: GraphicalProperties | None = None,
        txPr: RichText | None = None,
    ) -> None: ...

class DisplayUnitsLabelList(Serialisable):
    tagname: str
    custUnit: Incomplete
    builtInUnit: Incomplete
    dispUnitsLbl: Typed[DisplayUnitsLabel, Literal[True]]
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        custUnit: Incomplete | None = None,
        builtInUnit: Incomplete | None = None,
        dispUnitsLbl: DisplayUnitsLabel | None = None,
        extLst: Unused = None,
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
    dispUnits: Typed[DisplayUnitsLabelList, Literal[True]]
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        crossBetween: Incomplete | None = None,
        majorUnit: Incomplete | None = None,
        minorUnit: Incomplete | None = None,
        dispUnits: DisplayUnitsLabelList | None = None,
        extLst: Unused = None,
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
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        auto: Incomplete | None = None,
        lblAlgn: Incomplete | None = None,
        lblOffset: int = 100,
        tickLblSkip: Incomplete | None = None,
        tickMarkSkip: Incomplete | None = None,
        noMultiLvlLbl: Incomplete | None = None,
        extLst: Unused = None,
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
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        auto: Incomplete | None = None,
        lblOffset: Incomplete | None = None,
        baseTimeUnit: Incomplete | None = None,
        majorUnit: Incomplete | None = None,
        majorTimeUnit: Incomplete | None = None,
        minorUnit: Incomplete | None = None,
        minorTimeUnit: Incomplete | None = None,
        extLst: Unused = None,
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
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self, tickLblSkip: Incomplete | None = None, tickMarkSkip: Incomplete | None = None, extLst: Unused = None, **kw
    ) -> None: ...
