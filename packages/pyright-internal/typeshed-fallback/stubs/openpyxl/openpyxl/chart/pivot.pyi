from _typeshed import Incomplete, Unused
from typing import ClassVar
from typing_extensions import Literal

from openpyxl.chart.label import DataLabel as _DataLabel
from openpyxl.chart.marker import Marker
from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.chart.text import RichText
from openpyxl.descriptors.base import Alias, Typed
from openpyxl.descriptors.excel import ExtensionList
from openpyxl.descriptors.serialisable import Serialisable

class PivotSource(Serialisable):
    tagname: str
    name: Incomplete
    fmtId: Incomplete
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(self, name: str | None = None, fmtId: Incomplete | None = None, extLst: Unused = None) -> None: ...

class PivotFormat(Serialisable):
    tagname: str
    idx: Incomplete
    spPr: Typed[GraphicalProperties, Literal[True]]
    graphicalProperties: Alias
    txPr: Typed[RichText, Literal[True]]
    TextBody: Alias
    marker: Typed[Marker, Literal[True]]
    dLbl: Typed[_DataLabel, Literal[True]]
    DataLabel: Alias
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        idx: int = 0,
        spPr: GraphicalProperties | None = None,
        txPr: RichText | None = None,
        marker: Marker | None = None,
        dLbl: _DataLabel | None = None,
        extLst: Unused = None,
    ) -> None: ...
