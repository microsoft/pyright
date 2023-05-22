from _typeshed import Incomplete, Unused
from abc import abstractmethod
from typing import ClassVar
from typing_extensions import Literal

from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.chart.text import RichText
from openpyxl.descriptors.base import Alias, Typed
from openpyxl.descriptors.excel import ExtensionList
from openpyxl.descriptors.serialisable import Serialisable as Serialisable

class _DataLabelBase(Serialisable):
    numFmt: Incomplete
    spPr: Typed[GraphicalProperties, Literal[True]]
    graphicalProperties: Alias
    txPr: Typed[RichText, Literal[True]]
    textProperties: Alias
    dLblPos: Incomplete
    position: Alias
    showLegendKey: Incomplete
    showVal: Incomplete
    showCatName: Incomplete
    showSerName: Incomplete
    showPercent: Incomplete
    showBubbleSize: Incomplete
    showLeaderLines: Incomplete
    separator: Incomplete
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        numFmt: Incomplete | None = None,
        spPr: GraphicalProperties | None = None,
        txPr: RichText | None = None,
        dLblPos: Incomplete | None = None,
        showLegendKey: Incomplete | None = None,
        showVal: Incomplete | None = None,
        showCatName: Incomplete | None = None,
        showSerName: Incomplete | None = None,
        showPercent: Incomplete | None = None,
        showBubbleSize: Incomplete | None = None,
        showLeaderLines: Incomplete | None = None,
        separator: Incomplete | None = None,
        extLst: Unused = None,
    ) -> None: ...
    @property
    @abstractmethod
    def tagname(self) -> str: ...

class DataLabel(_DataLabelBase):
    tagname: str
    idx: Incomplete
    numFmt: Incomplete
    spPr: Incomplete
    txPr: Incomplete
    dLblPos: Incomplete
    showLegendKey: Incomplete
    showVal: Incomplete
    showCatName: Incomplete
    showSerName: Incomplete
    showPercent: Incomplete
    showBubbleSize: Incomplete
    showLeaderLines: Incomplete
    separator: Incomplete
    extLst: Incomplete
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(self, idx: int = 0, **kw) -> None: ...

class DataLabelList(_DataLabelBase):
    tagname: str
    dLbl: Incomplete
    delete: Incomplete
    numFmt: Incomplete
    spPr: Incomplete
    txPr: Incomplete
    dLblPos: Incomplete
    showLegendKey: Incomplete
    showVal: Incomplete
    showCatName: Incomplete
    showSerName: Incomplete
    showPercent: Incomplete
    showBubbleSize: Incomplete
    showLeaderLines: Incomplete
    separator: Incomplete
    extLst: Incomplete
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(self, dLbl=(), delete: Incomplete | None = None, **kw) -> None: ...
