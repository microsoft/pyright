# This sample verifies that a class can be assigned to a Callable
# type if its constructor conforms to that type.

from typing import Any, Callable, Generic, Literal, TypeVar, Union, overload

_T1 = TypeVar("_T1")
_S = TypeVar("_S")


def func1(callback: Callable[[_T1], _S], val: _T1) -> _S:
    ...


class A(Generic[_T1]):
    def __new__(cls, x: _T1) -> "A[_T1]":
        ...


a1 = func1(A[float], 3.4)
reveal_type(a1, expected_text="A[float]")

# This should generate an error.
a2 = func1(A[int], 3.4)

a3 = func1(A[int], 3)
reveal_type(a3, expected_text="A[int]")


class B(Generic[_T1]):
    @overload
    def __new__(cls, x: int, y: Literal[True]) -> "B[None]":
        ...

    @overload
    def __new__(cls, x: _T1, y: bool = ...) -> "B[_T1]":
        ...

    def __new__(cls, x: Union[_T1, int], y: bool = False) -> "B[Any]":
        ...


b1 = func1(B[int], 3)
reveal_type(b1, expected_text="B[int]")

# This should generate an error.
b2 = func1(B[None], 3.5)

b3 = func1(B[float], 3.5)
reveal_type(b3, expected_text="B[float]")

b4 = func1(B[Union[int, str]], 3)
reveal_type(b4, expected_text="B[int | str]")

b5 = func1(B[Union[int, str]], "3")
reveal_type(b5, expected_text="B[int | str]")


class C(Generic[_T1]):
    def __init__(self: "C[_T1]", x: _T1) -> None:
        ...


c1 = func1(C[float], 3.4)
reveal_type(c1, expected_text="C[float]")

# This should generate an error.
c2 = func1(C[int], 3.4)

c3 = func1(C[int], 3)
reveal_type(c3, expected_text="C[int]")


class D(Generic[_T1]):
    @overload
    def __init__(self: "D[None]", x: int, y: Literal[True]) -> None:
        ...

    @overload
    def __init__(self: "D[_T1]", x: _T1, y: bool = ...) -> None:
        ...

    def __init__(self, x: Any, y: bool = False) -> None:
        ...


d1 = func1(D[int], 3)
reveal_type(d1, expected_text="D[int]")

# This should generate an error.
d2 = func1(D[None], 3.5)

d3 = func1(D[float], 3.5)
reveal_type(d3, expected_text="D[float]")

d4 = func1(D[Union[int, str]], 3)
reveal_type(d4, expected_text="D[int | str]")

d5 = func1(D[Union[int, str]], "3")
reveal_type(d5, expected_text="D[int | str]")
