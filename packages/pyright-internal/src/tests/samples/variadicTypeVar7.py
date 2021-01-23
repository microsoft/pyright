# This sample tests error handling for variadic type var usage.

# pyright: reportMissingModuleSource=false


from typing import Any, Callable, Dict, Generic, Tuple, TypeVar, Union
from typing_extensions import TypeVarTuple, Unpack

_Xs = TypeVarTuple("_Xs")
_Ys = TypeVarTuple("_Ys")
_T1 = TypeVar("_T1")


# This should generate an error because only one TypeVarTuple is allowed.
class Class1(Generic[Unpack[_Ys], Unpack[_Xs]]):
    ...


# This should generate an error because only one TypeVarTuple is allowed.
class Class2(Dict[Tuple[Unpack[_Ys]], Tuple[Unpack[_Xs]]]):
    ...


# This should generate an error because a TypeVarTuple must come at the end.
class Class3(Dict[Tuple[Unpack[_Ys]], _T1]):
    ...


# This should generate an error because a TypeVarTuple must come at the end.
class Class4(Dict[_T1, Tuple[Unpack[_Ys]]], Generic[Unpack[_Ys], _T1]):
    ...


class Class5(Dict[Tuple[Unpack[_Ys]], _T1], Generic[_T1, Unpack[_Ys]]):
    # This should generate an error because *_Ys must be the last
    # type argument in Tuple.
    def func1(self, a: Tuple[Unpack[_Ys], int]):
        pass

    # This should generate an error because Tuple cannot contain multiple
    # TypeVarTuples.
    def func2(self, *args: Unpack[_Xs]) -> Tuple[Unpack[_Ys], Unpack[_Xs]]:
        ...

    def func3(self) -> Union[Unpack[_Ys], int]:
        return 3

    def func4(self, *args: Unpack[_Xs]) -> Union[int, Unpack[_Ys], Unpack[_Xs]]:
        return 3

    # This should generate an error because *_Ys must be the last
    # argument in a callable list.
    def func5(self, a: Callable[[Unpack[_Ys], int], Any]):
        pass

    # This should generate an error because *_Ys cannot appear
    # by itself in a return type for a Callable.
    def func6(self, a: Callable[[int], Unpack[_Ys]]):
        pass


# This should generate an error because the TypeVarTuple is not at the end.
Alias1 = Union[Tuple[int, Unpack[_Xs]], _T1]

# This should generate an error because at most one TypeVarTuple is allowed.
Alias2 = Union[Tuple[int, Unpack[_Xs]], Tuple[Unpack[_Ys]]]
