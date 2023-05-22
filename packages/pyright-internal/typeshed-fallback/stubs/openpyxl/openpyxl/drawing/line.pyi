from _typeshed import Incomplete, Unused
from typing import ClassVar
from typing_extensions import Literal, TypeAlias

from openpyxl.descriptors.base import Alias, Integer, MinMax, NoneSet, Typed, _ConvertibleToFloat, _ConvertibleToInt
from openpyxl.descriptors.excel import ExtensionList
from openpyxl.descriptors.serialisable import Serialisable
from openpyxl.drawing.fill import GradientFillProperties, PatternFillProperties

_LineEndPropertiesType: TypeAlias = Literal["none", "triangle", "stealth", "diamond", "oval", "arrow"]
_LineEndPropertiesWLen: TypeAlias = Literal["sm", "med", "lg"]
_LinePropertiesCap: TypeAlias = Literal["rnd", "sq", "flat"]
_LinePropertiesCmpd: TypeAlias = Literal["sng", "dbl", "thickThin", "thinThick", "tri"]
_LinePropertiesAlgn: TypeAlias = Literal["ctr", "in"]

class LineEndProperties(Serialisable):
    tagname: str
    namespace: Incomplete
    type: NoneSet[_LineEndPropertiesType]
    w: NoneSet[_LineEndPropertiesWLen]
    len: NoneSet[_LineEndPropertiesWLen]
    def __init__(
        self,
        type: _LineEndPropertiesType | Literal["none"] | None = None,
        w: _LineEndPropertiesWLen | Literal["none"] | None = None,
        len: _LineEndPropertiesWLen | Literal["none"] | None = None,
    ) -> None: ...

class DashStop(Serialisable):
    tagname: str
    namespace: Incomplete
    d: Integer[Literal[False]]
    length: Alias
    sp: Integer[Literal[False]]
    space: Alias
    def __init__(self, d: _ConvertibleToInt = 0, sp: _ConvertibleToInt = 0) -> None: ...

class DashStopList(Serialisable):
    ds: Incomplete
    def __init__(self, ds: Incomplete | None = None) -> None: ...

class LineProperties(Serialisable):
    tagname: str
    namespace: Incomplete
    w: MinMax[float, Literal[True]]
    width: Alias
    cap: NoneSet[_LinePropertiesCap]
    cmpd: NoneSet[_LinePropertiesCmpd]
    algn: NoneSet[_LinePropertiesAlgn]
    noFill: Incomplete
    solidFill: Incomplete
    gradFill: Typed[GradientFillProperties, Literal[True]]
    pattFill: Typed[PatternFillProperties, Literal[True]]
    prstDash: Incomplete
    dashStyle: Alias
    custDash: Typed[DashStop, Literal[True]]
    round: Incomplete
    bevel: Incomplete
    miter: Incomplete
    headEnd: Typed[LineEndProperties, Literal[True]]
    tailEnd: Typed[LineEndProperties, Literal[True]]
    extLst: Typed[ExtensionList, Literal[True]]
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(
        self,
        w: _ConvertibleToFloat | None = None,
        cap: _LinePropertiesCap | Literal["none"] | None = None,
        cmpd: _LinePropertiesCmpd | Literal["none"] | None = None,
        algn: _LinePropertiesAlgn | Literal["none"] | None = None,
        noFill: Incomplete | None = None,
        solidFill: Incomplete | None = None,
        gradFill: GradientFillProperties | None = None,
        pattFill: PatternFillProperties | None = None,
        prstDash: Incomplete | None = None,
        custDash: DashStop | None = None,
        round: Incomplete | None = None,
        bevel: Incomplete | None = None,
        miter: Incomplete | None = None,
        headEnd: LineEndProperties | None = None,
        tailEnd: LineEndProperties | None = None,
        extLst: Unused = None,
    ) -> None: ...
