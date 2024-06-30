# This sample tests the case where a LiteralString is used as the bound
# of a TypeVar.

from typing import Generic, TypeVar, LiteralString

T = TypeVar("T")
T_LS = TypeVar("T_LS", bound=LiteralString)


class ClassA(Generic[T]):
    def __init__(self, val: T) -> None: ...


def func1(x: T) -> ClassA[T]:
    return ClassA(x)


def func2(x: T_LS | None, default: T_LS) -> ClassA[T_LS]:
    if x is None:
        x = default

    reveal_type(x, expected_text="T_LS@func2 | LiteralString*")
    out = func1(x)
    reveal_type(out, expected_text="ClassA[T_LS@func2 | str*]")
    return out
