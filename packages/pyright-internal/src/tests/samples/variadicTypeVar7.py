# This sample tests error handling for variadic type var usage.

# Enable experimental features to support Union[*Ts].
# pyright: enableExperimentalFeatures=true

from typing import Any, Callable, Generic, TypeVar, Union
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    TypeVarTuple,
    Unpack,
)

_Xs = TypeVarTuple("_Xs")
_Ys = TypeVarTuple("_Ys")
_T1 = TypeVar("_T1")


# This should generate an error because only one TypeVarTuple is allowed.
class Class1(Generic[Unpack[_Ys], Unpack[_Xs]]): ...


# This should generate an error because only one TypeVarTuple is allowed.
class Class2(dict[tuple[Unpack[_Ys]], tuple[Unpack[_Xs]]]): ...


class Class3(dict[tuple[Unpack[_Ys]], _T1]): ...


class Class4(dict[_T1, tuple[Unpack[_Ys]]], Generic[Unpack[_Ys], _T1]): ...


class Class5(dict[tuple[Unpack[_Ys]], _T1], Generic[_T1, Unpack[_Ys]]):
    def func1(self, a: tuple[Unpack[_Ys], int]):
        pass

    # This should generate an error because tuple cannot contain multiple
    # TypeVarTuples.
    def func2(self, *args: Unpack[_Xs]) -> tuple[Unpack[_Ys], Unpack[_Xs]]: ...

    def func3(self) -> Union[Unpack[_Ys], int]:
        return 3

    def func4(self, *args: Unpack[_Xs]) -> Union[int, Unpack[_Ys], Unpack[_Xs]]:
        return 3

    def func5(self, a: Callable[[Unpack[_Ys], int], Any]):
        pass

    # This should generate an error because *_Ys cannot appear
    # by itself in a return type for a Callable.
    def func6(self, a: Callable[[int], Unpack[_Ys]]):
        pass


Alias1 = Union[tuple[int, Unpack[_Xs]], _T1]

# This should generate an error because at most one TypeVarTuple is allowed.
Alias2 = Union[tuple[int, Unpack[_Xs]], tuple[Unpack[_Ys]]]
