# This sample tests packing and unpacking operations with
# variadic type variables.

# pyright: reportMissingModuleSource=false

from typing import Generic, NewType, Tuple, Union
from typing_extensions import TypeVarTuple, Unpack


Shape = TypeVarTuple("Shape")


class Array(Generic[Unpack[Shape]]):
    def __init__(self, *shape: Unpack[Shape]):
        self.shape = shape

    def __abs__(self) -> "Array[Unpack[Shape]]":
        ...

    def __add__(self, other: "Array[Unpack[Shape]]") -> "Array[Unpack[Shape]]":
        ...


Height = NewType("Height", int)
Width = NewType("Width", int)
x: Array[Height, Width] = Array(Height(480), Width(640))
reveal_type(x.shape, expected_text="tuple[Height, Width]")
reveal_type(abs(x), expected_text="Array[Height, Width]")
reveal_type(x + abs(x), expected_text="Array[Height, Width]")


_Xs = TypeVarTuple("_Xs")


def func1(a: Tuple[Unpack[_Xs]], b: Tuple[Unpack[_Xs]]) -> Union[Unpack[_Xs]]:
    ...


def func2(a: Tuple[int, Unpack[_Xs]], b: Tuple[int, Unpack[_Xs]]) -> Union[Unpack[_Xs]]:
    ...


def func3(p1: Tuple[int], p2: Tuple[int, str]):
    # This should generate an error
    v1 = func1(p1, p2)

    # This should generate an error
    v2 = func2(p1, p2)

    v3 = func2(p2, p2)
    reveal_type(v3, expected_text="str")

    v4 = func2((3, "hi"), p2)
    reveal_type(v4, expected_text="str")

    # This should generate an error
    v5 = func2((3, 3), p2)


def func4(a: int, *args: Unpack[_Xs], **kwargs: str) -> Tuple[int, Unpack[_Xs]]:
    ...


c1 = func4(4, 5.4, 6j, b="3", c="5")
reveal_type(c1, expected_text="Tuple[int, float, complex]")

c2 = func4(4, b="3", c="5")
reveal_type(c2, expected_text="Tuple[int]")

# This should generate an error.
c3 = func4(b="3", c="5")
