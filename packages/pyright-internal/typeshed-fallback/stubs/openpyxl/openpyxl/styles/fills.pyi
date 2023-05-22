from _typeshed import Incomplete
from typing import ClassVar
from typing_extensions import Final, Literal, TypeAlias

from openpyxl.descriptors import Sequence
from openpyxl.descriptors.base import Alias, Float, MinMax, NoneSet, Set, _ConvertibleToFloat
from openpyxl.descriptors.serialisable import Serialisable

FILL_NONE: Final = "none"
FILL_SOLID: Final = "solid"
FILL_PATTERN_DARKDOWN: Final = "darkDown"
FILL_PATTERN_DARKGRAY: Final = "darkGray"
FILL_PATTERN_DARKGRID: Final = "darkGrid"
FILL_PATTERN_DARKHORIZONTAL: Final = "darkHorizontal"
FILL_PATTERN_DARKTRELLIS: Final = "darkTrellis"
FILL_PATTERN_DARKUP: Final = "darkUp"
FILL_PATTERN_DARKVERTICAL: Final = "darkVertical"
FILL_PATTERN_GRAY0625: Final = "gray0625"
FILL_PATTERN_GRAY125: Final = "gray125"
FILL_PATTERN_LIGHTDOWN: Final = "lightDown"
FILL_PATTERN_LIGHTGRAY: Final = "lightGray"
FILL_PATTERN_LIGHTGRID: Final = "lightGrid"
FILL_PATTERN_LIGHTHORIZONTAL: Final = "lightHorizontal"
FILL_PATTERN_LIGHTTRELLIS: Final = "lightTrellis"
FILL_PATTERN_LIGHTUP: Final = "lightUp"
FILL_PATTERN_LIGHTVERTICAL: Final = "lightVertical"
FILL_PATTERN_MEDIUMGRAY: Final = "mediumGray"

_GradientFillType: TypeAlias = Literal["linear", "path"]
_FillsType: TypeAlias = Literal[
    "none",
    "solid",
    "darkDown",
    "darkGray",
    "darkGrid",
    "darkHorizontal",
    "darkTrellis",
    "darkUp",
    "darkVertical",
    "gray0625",
    "gray125",
    "lightDown",
    "lightGray",
    "lightGrid",
    "lightHorizontal",
    "lightTrellis",
    "lightUp",
    "lightVertical",
    "mediumGray",
]
fills: tuple[_FillsType, ...]

class Fill(Serialisable):
    tagname: str
    @classmethod
    def from_tree(cls, el): ...

class PatternFill(Fill):
    tagname: str
    __elements__: ClassVar[tuple[str, ...]]
    patternType: NoneSet[_FillsType]
    fill_type: Alias
    fgColor: Incomplete
    start_color: Alias
    bgColor: Incomplete
    end_color: Alias
    def __init__(
        self,
        patternType: Incomplete | None = None,
        fgColor=...,
        bgColor=...,
        fill_type: Incomplete | None = None,
        start_color: Incomplete | None = None,
        end_color: Incomplete | None = None,
    ) -> None: ...
    def to_tree(self, tagname: Incomplete | None = None, idx: Incomplete | None = None): ...  # type: ignore[override]

DEFAULT_EMPTY_FILL: Incomplete
DEFAULT_GRAY_FILL: Incomplete

class Stop(Serialisable):
    tagname: str
    position: MinMax[float, Literal[False]]
    color: Incomplete
    def __init__(self, color, position: _ConvertibleToFloat) -> None: ...

class StopList(Sequence):
    expected_type: type[Incomplete]
    def __set__(self, obj, values) -> None: ...

class GradientFill(Fill):
    tagname: str
    type: Set[_GradientFillType]
    fill_type: Alias
    degree: Float[Literal[False]]
    left: Float[Literal[False]]
    right: Float[Literal[False]]
    top: Float[Literal[False]]
    bottom: Float[Literal[False]]
    stop: Incomplete
    def __init__(
        self,
        type: _GradientFillType = "linear",
        degree: _ConvertibleToFloat = 0,
        left: _ConvertibleToFloat = 0,
        right: _ConvertibleToFloat = 0,
        top: _ConvertibleToFloat = 0,
        bottom: _ConvertibleToFloat = 0,
        stop=(),
    ) -> None: ...
    def __iter__(self): ...
    def to_tree(self, tagname: Incomplete | None = None, namespace: Incomplete | None = None, idx: Incomplete | None = None): ...  # type: ignore[override]
