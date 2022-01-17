# This sample tests the TypeVar matching logic related to
# variadic type variables.

# pyright: reportMissingModuleSource=false

from typing import Generic, List, Sequence, Tuple, TypeVar, Union
from typing_extensions import TypeVarTuple, Unpack


_T = TypeVar("_T")
_Xs = TypeVarTuple("_Xs")


class Array(Generic[Unpack[_Xs]]):
    def __init__(self, *args: Unpack[_Xs]) -> None:
        self.x: Tuple[Unpack[_Xs]] = args
        reveal_type(args, expected_text="tuple[*_Xs@Array]")

    # This should generate an error because _Xs is not unpacked.
    def foo(self, *args: _Xs) -> None:
        ...


def linearize(value: Array[Unpack[_Xs]]) -> Sequence[Union[Unpack[_Xs]]]:
    reveal_type(value, expected_text="Array[*_Xs@linearize]")
    return []


def array_to_tuple(value: Array[Unpack[_Xs]]) -> Tuple[complex, Unpack[_Xs]]:
    ...


def func1(x: Array[int, str, str, float], y: Array[()]):
    reveal_type(x, expected_text="Array[int, str, str, float]")

    reveal_type(y, expected_text="Array[()]")

    a1 = Array(3, 3.5, "b")
    reveal_type(a1, expected_text="Array[int, float, str]")

    a2 = linearize(a1)
    reveal_type(a2, expected_text="Sequence[int | float | str]")

    b1 = Array()
    reveal_type(b1, expected_text="Array[()]")

    b2 = linearize(b1)
    reveal_type(b2, expected_text="Sequence[Unknown]")

    e = array_to_tuple(x)
    reveal_type(e, expected_text="Tuple[complex, int, str, str, float]")

    f = array_to_tuple(y)
    reveal_type(f, expected_text="Tuple[complex]")


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
