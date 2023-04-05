from _typeshed import Incomplete
from typing import Any, NamedTuple
from typing_extensions import Literal, TypeAlias

class _TagInfo(NamedTuple):
    value: Any
    name: str
    type: _TagType
    length: int
    enum: dict[str, int]

class TagInfo(_TagInfo):
    def __new__(
        cls,
        value: Incomplete | None = None,
        name: str = "unknown",
        type: _TagType | None = None,
        length: int | None = None,
        enum: dict[str, int] | None = None,
    ): ...
    def cvt_enum(self, value): ...

def lookup(tag: int, group: int | None = None) -> _TagInfo: ...

BYTE: Literal[1]
ASCII: Literal[2]
SHORT: Literal[3]
LONG: Literal[4]
RATIONAL: Literal[5]
SIGNED_BYTE: Literal[6]
UNDEFINED: Literal[7]
SIGNED_SHORT: Literal[8]
SIGNED_LONG: Literal[9]
SIGNED_RATIONAL: Literal[10]
FLOAT: Literal[11]
DOUBLE: Literal[12]
IFD: Literal[13]

_TagType: TypeAlias = Literal[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
_TagTuple: TypeAlias = tuple[str, _TagType, int] | tuple[str, _TagInfo, int, dict[str, int]]

TAGS_V2: dict[int, _TagTuple]
TAGS_V2_GROUPS: dict[int, dict[int, _TagTuple]]
TAGS: dict[int, str]
TYPES: dict[int, str]
LIBTIFF_CORE: set[int]
