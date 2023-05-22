from _typeshed import Incomplete
from typing import ClassVar
from typing_extensions import Literal, TypeAlias

from openpyxl.descriptors.base import Alias, Bool, NoneSet, Typed, _ConvertibleToBool
from openpyxl.descriptors.serialisable import Serialisable

_SideStyle: TypeAlias = Literal[
    "dashDot",
    "dashDotDot",
    "dashed",
    "dotted",
    "double",
    "hair",
    "medium",
    "mediumDashDot",
    "mediumDashDotDot",
    "mediumDashed",
    "slantDashDot",
    "thick",
    "thin",
]

BORDER_NONE: Incomplete
BORDER_DASHDOT: str
BORDER_DASHDOTDOT: str
BORDER_DASHED: str
BORDER_DOTTED: str
BORDER_DOUBLE: str
BORDER_HAIR: str
BORDER_MEDIUM: str
BORDER_MEDIUMDASHDOT: str
BORDER_MEDIUMDASHDOTDOT: str
BORDER_MEDIUMDASHED: str
BORDER_SLANTDASHDOT: str
BORDER_THICK: str
BORDER_THIN: str

class Side(Serialisable):
    __fields__: Incomplete
    color: Incomplete
    style: NoneSet[_SideStyle]
    border_style: Alias
    def __init__(
        self,
        style: _SideStyle | Literal["none"] | None = None,
        color: Incomplete | None = None,
        border_style: Incomplete | None = None,
    ) -> None: ...

class Border(Serialisable):
    tagname: str
    __fields__: Incomplete
    __elements__: ClassVar[tuple[str, ...]]
    start: Typed[Side, Literal[True]]
    end: Typed[Side, Literal[True]]
    left: Typed[Side, Literal[True]]
    right: Typed[Side, Literal[True]]
    top: Typed[Side, Literal[True]]
    bottom: Typed[Side, Literal[True]]
    diagonal: Typed[Side, Literal[True]]
    vertical: Typed[Side, Literal[True]]
    horizontal: Typed[Side, Literal[True]]
    outline: Bool[Literal[False]]
    diagonalUp: Bool[Literal[False]]
    diagonalDown: Bool[Literal[False]]
    diagonal_direction: Incomplete
    def __init__(
        self,
        left: Side | None = None,
        right: Side | None = None,
        top: Side | None = None,
        bottom: Side | None = None,
        diagonal: Side | None = None,
        diagonal_direction: Incomplete | None = None,
        vertical: Side | None = None,
        horizontal: Side | None = None,
        diagonalUp: _ConvertibleToBool = False,
        diagonalDown: _ConvertibleToBool = False,
        outline: _ConvertibleToBool = True,
        start: Side | None = None,
        end: Side | None = None,
    ) -> None: ...
    def __iter__(self): ...

DEFAULT_BORDER: Incomplete
