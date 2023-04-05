from _typeshed import Incomplete

from openpyxl.descriptors.serialisable import Serialisable

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

class Side(Serialisable):  # type: ignore[misc]
    __fields__: Incomplete
    color: Incomplete
    style: Incomplete
    border_style: Incomplete
    def __init__(
        self, style: Incomplete | None = None, color: Incomplete | None = None, border_style: Incomplete | None = None
    ) -> None: ...

class Border(Serialisable):
    tagname: str
    __fields__: Incomplete
    __elements__: Incomplete
    start: Incomplete
    end: Incomplete
    left: Incomplete
    right: Incomplete
    top: Incomplete
    bottom: Incomplete
    diagonal: Incomplete
    vertical: Incomplete
    horizontal: Incomplete
    outline: Incomplete
    diagonalUp: Incomplete
    diagonalDown: Incomplete
    diagonal_direction: Incomplete
    def __init__(
        self,
        left: Incomplete | None = None,
        right: Incomplete | None = None,
        top: Incomplete | None = None,
        bottom: Incomplete | None = None,
        diagonal: Incomplete | None = None,
        diagonal_direction: Incomplete | None = None,
        vertical: Incomplete | None = None,
        horizontal: Incomplete | None = None,
        diagonalUp: bool = False,
        diagonalDown: bool = False,
        outline: bool = True,
        start: Incomplete | None = None,
        end: Incomplete | None = None,
    ) -> None: ...
    def __iter__(self): ...

DEFAULT_BORDER: Incomplete
