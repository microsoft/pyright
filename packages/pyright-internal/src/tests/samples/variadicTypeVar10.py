# This sample tests the handling of variadic type variables when used
# in conjunction with unpacked tuples.

from __future__ import annotations
from typing import Any, Generic, NewType, TypeVar
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    TypeVarTuple,
    Unpack,
)

DType = TypeVar("DType")
Shape = TypeVarTuple("Shape")

Batch = NewType("Batch", int)
Height = NewType("Height", int)
Width = NewType("Width", int)
Channels = NewType("Channels", int)


class Array(Generic[DType, Unpack[Shape]]):
    def __abs__(self) -> Array[DType, Unpack[Shape]]: ...

    def __add__(
        self, other: Array[DType, Unpack[Shape]]
    ) -> Array[DType, Unpack[Shape]]: ...


def process_batch_channels(
    x: Array[Batch, Unpack[tuple[Any, ...]], Channels],
) -> None: ...


def expect_variadic_array1(x: Array[Batch, Unpack[Shape]]) -> tuple[Unpack[Shape]]: ...


def expect_variadic_array2(x: Array[Batch, Unpack[tuple[Any, ...]]]) -> None: ...


def expect_precise_array(x: Array[Batch, Height, Width, Channels]) -> None: ...


def func1(x: Array[Batch, Height, Width, Channels]):
    process_batch_channels(x)

    expect_precise_array(x)


def func2(y: Array[Batch, Channels]):
    process_batch_channels(y)

    # This should generate an error because the type args don't match.
    expect_precise_array(y)


def func3(z: Array[Batch]):
    # This should generate an error because Channels is missing
    process_batch_channels(z)


def func4(y: Array[Any, Unpack[tuple[Any, ...]]]):
    reveal_type(y, expected_text="Array[Any, *tuple[Any, ...]]")
    expect_variadic_array1(y)
    expect_variadic_array2(y)
    expect_precise_array(y)
