# This sample tests the capture of an unbounded (unknown-length) tuple
# by a TypeVarTuple.

from typing import Any, Generic
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    TypeVarTuple,
    Unpack,
)

Shape = TypeVarTuple("Shape")


class Array(Generic[Unpack[Shape]]): ...


def func0(x: Array[Unpack[Shape]]) -> Array[Unpack[Shape]]: ...


def func1(y: Array[int, Unpack[tuple[Any, ...]]]):
    reveal_type(func0(y), expected_text="Array[int, *tuple[Any, ...]]")


def func2(y: Array[Unpack[tuple[int, ...]], int]):
    reveal_type(func0(y), expected_text="Array[*tuple[int, ...], int]")
