from _typeshed import Incomplete

from openpyxl.descriptors import Typed
from openpyxl.descriptors.serialisable import Serialisable

COLOR_INDEX: Incomplete
BLACK: Incomplete
WHITE: Incomplete
BLUE: Incomplete
aRGB_REGEX: Incomplete

class RGB(Typed):
    expected_type: Incomplete
    def __set__(self, instance, value) -> None: ...

class Color(Serialisable):
    tagname: str
    rgb: Incomplete
    indexed: Incomplete
    auto: Incomplete
    theme: Incomplete
    tint: Incomplete
    type: Incomplete
    def __init__(
        self,
        rgb="00000000",
        indexed: Incomplete | None = None,
        auto: Incomplete | None = None,
        theme: Incomplete | None = None,
        tint: float = 0.0,
        index: Incomplete | None = None,
        type: str = "rgb",
    ) -> None: ...
    @property
    def value(self): ...
    @value.setter
    def value(self, value) -> None: ...
    def __iter__(self): ...
    @property
    def index(self): ...
    def __add__(self, other): ...

class ColorDescriptor(Typed):
    expected_type: Incomplete
    def __set__(self, instance, value) -> None: ...

class RgbColor(Serialisable):
    tagname: str
    rgb: Incomplete
    def __init__(self, rgb: Incomplete | None = None) -> None: ...

class ColorList(Serialisable):
    tagname: str
    indexedColors: Incomplete
    mruColors: Incomplete
    __elements__: Incomplete
    def __init__(self, indexedColors=(), mruColors=()) -> None: ...
    def __bool__(self) -> bool: ...
    @property
    def index(self): ...
