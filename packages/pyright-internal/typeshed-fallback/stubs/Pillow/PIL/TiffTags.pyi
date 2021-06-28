from typing import Any

class TagInfo:
    def __new__(
        cls, value: Any | None = ..., name: str = ..., type: Any | None = ..., length: Any | None = ..., enum: Any | None = ...
    ): ...
    def cvt_enum(self, value): ...

def lookup(tag): ...

BYTE: int
ASCII: int
SHORT: int
LONG: int
RATIONAL: int
SIGNED_BYTE: int
UNDEFINED: int
SIGNED_SHORT: int
SIGNED_LONG: int
SIGNED_RATIONAL: int
FLOAT: int
DOUBLE: int
IFD: int
TAGS_V2: Any
TAGS: Any
TYPES: Any
LIBTIFF_CORE: Any
