# This sample tests the TypeVar matching logic related to
# variadic type variables.

# pyright: reportMissingModuleSource=false

from typing import Generic, List, Literal, Sequence, Tuple, TypeVar, Union
from typing_extensions import TypeVarTuple, Unpack


_T = TypeVar("_T")
_Xs = TypeVarTuple("_Xs")


class Array(Generic[Unpack[_Xs]]):
    def __init__(self, *args: Unpack[_Xs]) -> None:
        self.x: Tuple[Unpack[_Xs]] = args
        t1: Literal["tuple[*_Xs@Array]"] = reveal_type(args)

    # This should generate an error because _Xs is not unpacked.
    def foo(self, *args: _Xs) -> None:
        ...


def linearize(value: Array[Unpack[_Xs]]) -> Sequence[Union[Unpack[_Xs]]]:
    t1: Literal["Array[*_Xs@linearize]"] = reveal_type(value)
    return []


def array_to_tuple(value: Array[Unpack[_Xs]]) -> Tuple[complex, Unpack[_Xs]]:
    ...


def func1(x: Array[int, str, str, float], y: Array[()]):
    t1: Literal["Array[int, str, str, float]"] = reveal_type(x)

    t2: Literal["Array[()]"] = reveal_type(y)

    a1 = Array(3, 3.5, "b")
    t3: Literal["Array[int, float, str]"] = reveal_type(a1)

    a2 = linearize(a1)
    t4: Literal["Sequence[int | float | str]"] = reveal_type(a2)

    b1 = Array()
    t5: Literal["Array[()]"] = reveal_type(b1)

    b2 = linearize(b1)
    t6: Literal["Sequence[Unknown]"] = reveal_type(b2)

    e = array_to_tuple(x)
    t7: Literal["Tuple[complex, int, str, str, float]"] = reveal_type(e)

    f = array_to_tuple(y)
    t8: Literal["Tuple[complex]"] = reveal_type(f)


class ArrayIntStr(Array[int, str, _T]):
    def __init__(self, val: _T) -> None:
        pass


v1 = ArrayIntStr(3)

v2: Array[int, str, int] = v1

# This should generate an error.
v3: Array[int, str, str] = v1

# This should generate an error.
v4: Array[int, str, int, int] = v1

# This should generate an error.
v5: Array[int, str] = v1


def test1(p1: Tuple[str, int], p2: List[str]):
    # This should generate an error because unpacked
    # arguments are not supported for variadic parameters.
    v6 = Array(*p1)

    # Same thing.
    v7 = Array(int, *p1, str)

    # This should generate an error because open-ended
    # tuple types should not be allowed.
    v8 = Array(*p2)
