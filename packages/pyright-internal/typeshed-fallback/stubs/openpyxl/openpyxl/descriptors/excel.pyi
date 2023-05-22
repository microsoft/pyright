from _typeshed import Incomplete
from typing import TypeVar
from typing_extensions import Literal

from . import Integer, MatchPattern, MinMax, Strict, String
from .serialisable import Serialisable

_N = TypeVar("_N", bound=bool)
_M = TypeVar("_M", int, float)

class HexBinary(MatchPattern[str, Incomplete]):
    pattern: str

class UniversalMeasure(MatchPattern[str, Incomplete]):
    pattern: str

class TextPoint(MinMax[_M, _N]):
    expected_type: type[_M]
    min: float
    max: float

Coordinate = Integer

class Percentage(MinMax[float, Incomplete]):
    pattern: str
    min: float
    max: float
    def __set__(self, instance: Serialisable | Strict, value: Incomplete) -> None: ...

class Extension(Serialisable):
    uri: String[Literal[False]]
    def __init__(self, uri: str) -> None: ...

class ExtensionList(Serialisable):
    ext: Incomplete
    def __init__(self, ext=()) -> None: ...

class Relation(String[Incomplete]):
    namespace: Incomplete
    allow_none: bool

class Base64Binary(MatchPattern[str, Incomplete]):
    pattern: str

class Guid(MatchPattern[str, Incomplete]):
    pattern: str

class CellRange(MatchPattern[str, Incomplete]):
    pattern: str
    allow_none: bool
    def __set__(self, instance: Serialisable | Strict, value) -> None: ...
