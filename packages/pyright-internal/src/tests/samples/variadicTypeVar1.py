# This sample tests various conditions under which variadic
# type variables can and cannot be used.

# pyright: reportMissingModuleSource=false

from typing import Generic, List, Literal, Tuple, TypeVar, Union
from typing_extensions import TypeVarTuple, Unpack


_T = TypeVar("_T")
_Xs = TypeVarTuple("_Xs")


class ClassA(Generic[_T, Unpack[_Xs]]):
    def __init__(self, *args: Unpack[_Xs]) -> None:
        t1: Literal["tuple[*_Xs@ClassA]"] = reveal_type(args)

    # This should generate an error
    def func2(self) -> Union[_Xs]:
        ...

    def func3(self) -> Tuple[Unpack[_Xs]]:
        ...

    # This should generate an error
    def func4(self) -> Tuple[_Xs]:
        ...

    # This should be an error because List doesn't accept a variadic TypeVar.
    x: List[_Xs] = []

    # This should generate an error.
    y: _Xs = ()

    # This should generate an error.
    z: Tuple[_Xs, ...]


# This should generate an error.
class ClassB(Generic[_Xs]):
    ...


# This should generate an error.
x: List[_Xs] = []

# This should generate an error.
y: _Xs = ()
