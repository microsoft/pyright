# This sample tests various conditions under which variadic
# type variables can and cannot be used.

# pyright: reportMissingModuleSource=false

from typing import Generic, TypeVar, Union
from typing_extensions import TypeVarTuple, Unpack


_T = TypeVar("_T")
_Xs = TypeVarTuple("_Xs")


class ClassA(Generic[_T, Unpack[_Xs]]):
    def __init__(self, *args: Unpack[_Xs]) -> None:
        reveal_type(args, expected_text="tuple[*_Xs@ClassA]")

    # This should generate two errors.
    def func2(self) -> Union[_Xs]: ...

    def func3(self) -> tuple[Unpack[_Xs]]: ...

    # This should generate an error.
    def func4(self) -> tuple[_Xs]: ...

    def func5(self) -> "ClassA[int, str, Unpack[_Xs]]": ...

    # This should be an error because list doesn't accept a variadic TypeVar.
    x: list[_Xs] = []

    # This should generate an error.
    y: _Xs = ()

    # This should generate an error.
    z: tuple[_Xs, ...]


# This should generate an error.
class ClassB(Generic[_Xs]): ...


# This should generate an error.
x: list[_Xs] = []

# This should generate an error.
y: _Xs = ()


# This should generate an error because of the name mismatch.
BadName = TypeVarTuple("Ts1")

# This should generate TypeVarTuple cannot have constraints.
Ts2 = TypeVarTuple("Ts2", int, str)

# This should generate TypeVarTuple cannot be covariant.
Ts3 = TypeVarTuple("Ts3", covariant=True)

# This should generate TypeVarTuple cannot be contravariant.
Ts4 = TypeVarTuple("Ts4", contravariant=True)

# This should generate TypeVarTuple does not accept other keyword arguments.
Ts5 = TypeVarTuple("Ts5", other=True)
