from _typeshed import Incomplete, Unused
from re import Pattern
from typing import ClassVar
from typing_extensions import Final, Literal

from openpyxl.descriptors import Strict, Typed
from openpyxl.descriptors.base import Bool, Integer, MinMax, String, _ConvertibleToBool, _ConvertibleToFloat, _ConvertibleToInt
from openpyxl.descriptors.serialisable import Serialisable

COLOR_INDEX: Final[tuple[str, ...]]
BLACK: Final = "00000000"
WHITE: Final = "00FFFFFF"
BLUE: Final = "00FFFFFF"
aRGB_REGEX: Final[Pattern[str]]

class RGB(Typed[str, Incomplete]):
    expected_type: type[str]
    def __set__(self, instance: Serialisable | Strict, value) -> None: ...

class Color(Serialisable):
    tagname: ClassVar[str]
    rgb: Incomplete
    indexed: Integer[Literal[False]]
    auto: Bool[Literal[False]]
    theme: Integer[Literal[False]]
    tint: MinMax[float, Literal[False]]
    type: String[Literal[False]]
    def __init__(
        self,
        rgb="00000000",
        indexed: _ConvertibleToInt | None = None,
        auto: _ConvertibleToBool | None = None,
        theme: _ConvertibleToInt | None = None,
        tint: _ConvertibleToFloat = 0.0,
        index: _ConvertibleToInt | None = None,
        type: Unused = "rgb",
    ) -> None: ...
    @property
    def value(self): ...
    @value.setter
    def value(self, value) -> None: ...
    def __iter__(self): ...
    @property
    def index(self): ...
    def __add__(self, other): ...

class ColorDescriptor(Typed[Color, Incomplete]):
    expected_type: type[Color]
    def __set__(self, instance: Serialisable | Strict, value) -> None: ...

class RgbColor(Serialisable):
    tagname: ClassVar[str]
    rgb: Incomplete
    def __init__(self, rgb: Incomplete | None = None) -> None: ...

class ColorList(Serialisable):
    tagname: ClassVar[str]
    indexedColors: Incomplete
    mruColors: Incomplete
    __elements__: ClassVar[tuple[str, ...]]
    def __init__(self, indexedColors=(), mruColors=()) -> None: ...
    def __bool__(self) -> bool: ...
    @property
    def index(self): ...
