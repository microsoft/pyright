from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

class Marker(Serialisable):
    tagname: str
    symbol: Incomplete
    size: Incomplete
    spPr: Incomplete
    graphicalProperties: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        symbol: Incomplete | None = None,
        size: Incomplete | None = None,
        spPr: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...

class DataPoint(Serialisable):
    tagname: str
    idx: Incomplete
    invertIfNegative: Incomplete
    marker: Incomplete
    bubble3D: Incomplete
    explosion: Incomplete
    spPr: Incomplete
    graphicalProperties: Incomplete
    pictureOptions: Incomplete
    extLst: Incomplete
    __elements__: Incomplete
    def __init__(
        self,
        idx: Incomplete | None = None,
        invertIfNegative: Incomplete | None = None,
        marker: Incomplete | None = None,
        bubble3D: Incomplete | None = None,
        explosion: Incomplete | None = None,
        spPr: Incomplete | None = None,
        pictureOptions: Incomplete | None = None,
        extLst: Incomplete | None = None,
    ) -> None: ...
