# This sample tests that a generic type alias retains a literal type argument
# when it is specialized.

from typing import Literal, TypeAlias, TypeVar

Mode = Literal["read", "write"]
T = TypeVar("T")
Entry: "TypeAlias" = dict[T, int]
Entry2: TypeAlias = dict[Mode, int]


def f() -> Entry[Mode]:
    return {"read": 0}


def g() -> Entry2:
    return {"read": 0}


def main() -> None:
    d1 = f()
    reveal_type(d1, expected_text="dict[Literal['read', 'write'], int]")
    d2 = g()
    reveal_type(d2, expected_text="dict[Literal['read', 'write'], int]")
