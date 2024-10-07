# This sample tests various conditions under which Unpack
# can and cannot be used.

# pyright: reportMissingModuleSource=false

from typing import Generic, TypeVar, Union
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    TypeVarTuple,
    Unpack,
)


_T = TypeVar("_T")
_Xs = TypeVarTuple("_Xs")


class ClassA(Generic[_T, Unpack[_Xs]]):
    def __init__(self, *shape: Unpack[_Xs]):
        self.x: tuple[Unpack[_Xs]] = shape

        # This should generate an error
        self.y: _Xs = shape

    # This should generate two errors
    def func1(self) -> Union[Unpack[_Xs]]: ...

    # This should generate an error
    def func2(self) -> tuple[Unpack[_T]]: ...

    # This should generate an error
    def func3(self) -> tuple[Unpack[int]]: ...

    # This should generate an error
    def func4(self) -> tuple[Unpack[_Xs, _Xs]]: ...

    # This should generate an error.
    a: list[Unpack[_Xs]] = []

    # This should generate an error.
    b: Unpack[_Xs] = ()


# This should generate an error.
x: list[Unpack[_Xs]] = []

# This should generate an error.
y: Unpack[_Xs] = ()

# This should generate an error.
z: Unpack = ()


class Array(Generic[Unpack[_Xs]]): ...


# This should generate two errors because _Xs must be unpacked.
def func0(value: Array[_Xs]) -> tuple[complex, _Xs, str]: ...
