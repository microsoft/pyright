from _typeshed import Incomplete, Unused
from typing import ClassVar
from typing_extensions import Literal

from openpyxl.chart.layout import Layout
from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.chart.text import RichText, Text
from openpyxl.descriptors import Strict, Typed
from openpyxl.descriptors.base import Alias
from openpyxl.descriptors.excel import ExtensionList
from openpyxl.descriptors.serialisable import Serialisable

class Title(Serialisable):
    tagname: str
    tx: Typed[Text, Literal[True]]
    text: Alias
    layout: Typed[Layout, Literal[True]]
    overlay: Incomplete
    spPr: Typed[GraphicalProperties, Literal[True]]
    graphicalProperties: Alias
    txPr: Typed[RichText, Literal[True]]
    body: Alias
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        tx: Text | None = None,
        layout: Layout | None = None,
        overlay: Incomplete | None = None,
        spPr: GraphicalProperties | None = None,
        txPr: RichText | None = None,
        extLst: Unused = None,
    ) -> None: ...

def title_maker(text): ...

class TitleDescriptor(Typed[Title, Incomplete]):
    expected_type: type[Title]
    allow_none: Literal[True]
    def __set__(self, instance: Serialisable | Strict, value) -> None: ...
