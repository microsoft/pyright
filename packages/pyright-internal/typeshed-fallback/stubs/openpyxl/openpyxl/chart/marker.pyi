from _typeshed import Incomplete, Unused
from typing import ClassVar
from typing_extensions import Literal

from openpyxl.chart.picture import PictureOptions
from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.descriptors.base import Alias, Typed
from openpyxl.descriptors.excel import ExtensionList
from openpyxl.descriptors.serialisable import Serialisable

class Marker(Serialisable):
    tagname: str
    symbol: Incomplete
    size: Incomplete
    spPr: Typed[GraphicalProperties, Literal[True]]
    graphicalProperties: Alias
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        symbol: Incomplete | None = None,
        size: Incomplete | None = None,
        spPr: GraphicalProperties | None = None,
        extLst: Unused = None,
    ) -> None: ...

class DataPoint(Serialisable):
    tagname: str
    idx: Incomplete
    invertIfNegative: Incomplete
    marker: Typed[Marker, Literal[True]]
    bubble3D: Incomplete
    explosion: Incomplete
    spPr: Typed[GraphicalProperties, Literal[True]]
    graphicalProperties: Alias
    pictureOptions: Typed[PictureOptions, Literal[True]]
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        idx: Incomplete | None = None,
        invertIfNegative: Incomplete | None = None,
        marker: Marker | None = None,
        bubble3D: Incomplete | None = None,
        explosion: Incomplete | None = None,
        spPr: GraphicalProperties | None = None,
        pictureOptions: PictureOptions | None = None,
        extLst: Unused = None,
    ) -> None: ...
