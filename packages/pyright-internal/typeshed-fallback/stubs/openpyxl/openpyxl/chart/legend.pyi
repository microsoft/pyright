from _typeshed import Incomplete, Unused
from typing import ClassVar
from typing_extensions import Literal

from openpyxl.chart.layout import Layout
from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.chart.text import RichText
from openpyxl.descriptors.base import Alias, Typed
from openpyxl.descriptors.excel import ExtensionList
from openpyxl.descriptors.serialisable import Serialisable

class LegendEntry(Serialisable):
    tagname: str
    idx: Incomplete
    delete: Incomplete
    txPr: Typed[RichText, Literal[True]]
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(self, idx: int = 0, delete: bool = False, txPr: RichText | None = None, extLst: Unused = None) -> None: ...

class Legend(Serialisable):
    tagname: str
    legendPos: Incomplete
    position: Alias
    legendEntry: Incomplete
    layout: Typed[Layout, Literal[True]]
    overlay: Incomplete
    spPr: Typed[GraphicalProperties, Literal[True]]
    graphicalProperties: Alias
    txPr: Typed[RichText, Literal[True]]
    textProperties: Alias
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        legendPos: str = "r",
        legendEntry=(),
        layout: Layout | None = None,
        overlay: Incomplete | None = None,
        spPr: GraphicalProperties | None = None,
        txPr: RichText | None = None,
        extLst: Unused = None,
    ) -> None: ...
