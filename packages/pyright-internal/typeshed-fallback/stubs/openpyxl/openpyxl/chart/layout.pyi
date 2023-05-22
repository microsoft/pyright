from _typeshed import Incomplete, Unused
from typing import ClassVar
from typing_extensions import Literal

from openpyxl.descriptors.base import Alias, Typed
from openpyxl.descriptors.excel import ExtensionList
from openpyxl.descriptors.serialisable import Serialisable

class ManualLayout(Serialisable):
    tagname: str
    layoutTarget: Incomplete
    xMode: Incomplete
    yMode: Incomplete
    wMode: Incomplete
    hMode: Incomplete
    x: Incomplete
    y: Incomplete
    w: Incomplete
    width: Alias
    h: Incomplete
    height: Alias
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        layoutTarget: Incomplete | None = None,
        xMode: Incomplete | None = None,
        yMode: Incomplete | None = None,
        wMode: str = "factor",
        hMode: str = "factor",
        x: Incomplete | None = None,
        y: Incomplete | None = None,
        w: Incomplete | None = None,
        h: Incomplete | None = None,
        extLst: Unused = None,
    ) -> None: ...

class Layout(Serialisable):
    tagname: str
    manualLayout: Typed[ManualLayout, Literal[True]]
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(self, manualLayout: ManualLayout | None = None, extLst: Unused = None) -> None: ...
