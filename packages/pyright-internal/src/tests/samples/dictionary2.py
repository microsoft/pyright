# This sample tests dictionary inference logic.

from typing import Mapping, TypeAlias, TypeVar

T = TypeVar("T")


def func1(mapping: Mapping[str | bytes, int]):
    return mapping


func1({"x": 1})
func1({b"x": 1})

# This should generate an error.
func1({3: 1})


RecursiveMapping: TypeAlias = (
    int | Mapping[int, "RecursiveMapping"] | Mapping[str, "RecursiveMapping"]
)


class HasName:
    name: str | None


def func2(x: T | None) -> T:
    assert x is not None
    return x


def func3(v: list[HasName]) -> RecursiveMapping:
    return {func2(x.name): 1 for x in v}
