# This sample tests the TypeVar matching logic related to
# variadic type variables.

from typing import Any, Generic, Literal, TypeAlias, TypeVar, overload
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    TypeVarTuple,
    Unpack,
)


_T = TypeVar("_T")
_Xs = TypeVarTuple("_Xs")


class Array(Generic[Unpack[_Xs]]):
    def __init__(self, *args: Unpack[_Xs]) -> None:
        self.x: tuple[Unpack[_Xs]] = args
        reveal_type(args, expected_text="tuple[*_Xs@Array]")

    # This should generate an error because _Xs is not unpacked.
    def foo(self, *args: _Xs) -> None: ...


def linearize(value: Array[Unpack[_Xs]]) -> tuple[Unpack[_Xs]]: ...


def array_to_tuple(value: Array[Unpack[_Xs]]) -> tuple[complex, Unpack[_Xs]]: ...


def func1(x: Array[int, str, str, float], y: Array[()]):
    reveal_type(x, expected_text="Array[int, str, str, float]")

    reveal_type(y, expected_text="Array[*tuple[()]]")

    a1 = Array(3, 3.5, "b")
    reveal_type(a1, expected_text="Array[int, float, str]")

    a2 = linearize(a1)
    reveal_type(a2, expected_text="tuple[int, float, str]")

    b1 = Array()
    reveal_type(b1, expected_text="Array[*tuple[()]]")

    b2 = linearize(b1)
    reveal_type(b2, expected_text="tuple[()]")

    e = array_to_tuple(x)
    reveal_type(e, expected_text="tuple[complex, int, str, str, float]")

    f = array_to_tuple(y)
    reveal_type(f, expected_text="tuple[complex]")


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


def func2(p1: tuple[str, int], p2: list[str]):
    v6 = Array(*p1)
    reveal_type(v6, expected_text="Array[str, int]")

    v7 = Array(1, *p1, "")
    reveal_type(v7, expected_text="Array[int, str, int, str]")

    v8 = Array(*p2)
    reveal_type(v8, expected_text="Array[*tuple[str, ...]]")


def func3(x: Array[Unpack[_Xs]]) -> Array[Unpack[_Xs]]:
    y: Array[Unpack[tuple[Any, ...]]] = x
    return x


@overload
def func4(signal: Array[*_Xs], *args: *_Xs) -> None: ...


@overload
def func4(signal: str, *args: Any) -> None: ...


def func4(signal: Array[*_Xs] | str, *args: *_Xs) -> None: ...


def func5(a1: Array[Literal["a", "b"]], a2: Array[Literal["a"], Literal["b"]]):
    func4(a1, "a")
    func4(a2, "a", "b")


def func6(a: Array):
    reveal_type(a, expected_text="Array[*tuple[Unknown, ...]]")


def func7():
    x1: Array[*tuple[int, str], *tuple[str]]
    x2: Array[*tuple[int, ...], *tuple[str]]
    x3: Array[*tuple[str], *tuple[int, ...], *tuple[str]]

    # This should generate an error because only one unpacked unbounded
    # tuple can be used.
    x4: Array[*tuple[str, ...], *tuple[int, ...], *tuple[str]]


ArrayAlias: TypeAlias = Array[Unpack[_Xs]]


def func8():
    x1: ArrayAlias[*tuple[int, str], *tuple[str]]
    x2: ArrayAlias[*tuple[int, ...], *tuple[str]]
    x3: ArrayAlias[*tuple[str], *tuple[int, ...], *tuple[str]]

    # This should generate an error because only one unpacked unbounded
    # tuple can be used.
    x4: ArrayAlias[*tuple[str, ...], *tuple[int, ...], *tuple[str]]
