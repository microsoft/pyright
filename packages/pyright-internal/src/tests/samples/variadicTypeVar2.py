# This sample tests various conditions under which Unpack
# can and cannot be used.

# pyright: reportMissingModuleSource=false

from typing import Generic, List, Tuple, TypeVar, Union
from typing_extensions import TypeVarTuple, Unpack


_T = TypeVar("_T")
_Xs = TypeVarTuple("_Xs")


class ClassA(Generic[_T, Unpack[_Xs]]):
    def __init__(self, *shape: Unpack[_Xs]):
        self.x: Tuple[Unpack[_Xs]] = shape

        # This should generate an error
        self.y: _Xs = shape

    def func1(self) -> Union[Unpack[_Xs]]:
        ...

    # This should generate an error
    def func2(self) -> Tuple[Unpack[_T]]:
        ...

    # This should generate an error
    def func3(self) -> Tuple[Unpack[int]]:
        ...

    # This should generate an error
    def func4(self) -> Tuple[Unpack[_Xs, _Xs]]:
        ...

    # This should generate an error.
    a: List[Unpack[_Xs]] = []

    # This should generate an error.
    b: Unpack[_Xs] = ()


# This should generate an error.
x: List[Unpack[_Xs]] = []

# This should generate an error.
y: Unpack[_Xs] = ()

# This should generate an error.
z: Unpack = ()


class Array(Generic[Unpack[_Xs]]):
    ...


# This should generate two errors because _Xs must be unpacked.
def func0(value: Array[_Xs]) -> Tuple[complex, _Xs, str]:
    ...

