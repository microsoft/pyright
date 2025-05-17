from _typeshed import Incomplete
from collections.abc import Generator
from enum import Enum
from typing import Generic, NamedTuple, TypeVar

from networkx.utils.backends import _dispatchable

_T = TypeVar("_T")

__all__ = ["read_gml", "parse_gml", "generate_gml", "write_gml"]

@_dispatchable
def read_gml(path, label: str = "label", destringizer=None): ...
@_dispatchable
def parse_gml(lines, label: str = "label", destringizer=None): ...

class Pattern(Enum):
    KEYS = 0
    REALS = 1
    INTS = 2
    STRINGS = 3
    DICT_START = 4
    DICT_END = 5
    COMMENT_WHITESPACE = 6

class Token(NamedTuple, Generic[_T]):
    category: Pattern
    value: _T
    line: int
    position: int

def generate_gml(G, stringizer=None) -> Generator[Incomplete, Incomplete, None]: ...
def write_gml(G, path, stringizer=None) -> None: ...
