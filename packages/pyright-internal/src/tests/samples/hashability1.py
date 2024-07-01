# This sample tests the check for hashability that applies to entries
# within a set expression and keys within a dictionary expression.

# pyright: reportIncompatibleVariableOverride=false

from dataclasses import dataclass
from typing import Any


# This should generate two errors because {} and [] are not hashable.
s1 = {{}, 2, dict, frozenset(), []}

# This should generate two errors because {} and [] are not hashable.
s2: set[Any] = {{}, 2, dict, frozenset(), []}


class StrList(list[str]):
    def __hash__(self) -> int: ...


s3 = {StrList()}


# This should generate two errors because {} and [] are not hashable.
d1 = {{}: None, None: 2, dict: 3, frozenset(): 4, []: ""}

# This should generate two errors because {} and [] are not hashable.
d2: dict[Any, Any] = {{}: None, None: 2, dict: 3, frozenset(): 4, []: ""}


def func1(x: str | dict[Any, Any], y: Any, z: None):
    # This should generate an error because dict isn't hashable
    d3 = {x: "hi"}

    d4 = {y: "hi", z: "hi"}


@dataclass
class DC1:
    a: int


@dataclass(frozen=True)
class DC2:
    a: int


dc1 = DC1(0)

# This should generate an error because a non-frozen
# dataclass is not hashable.
d5 = {dc1: 100}


dc2 = DC2(0)
d6 = {dc2: 100}
