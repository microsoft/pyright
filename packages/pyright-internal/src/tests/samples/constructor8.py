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
t_a1: Literal["A[float]"] = reveal_type(a1)

# This should generate an error.
a2 = func1(A[int], 3.4)

a3 = func1(A[int], 3)
t_a3: Literal["A[int]"] = reveal_type(a3)


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
t_b1: Literal["B[int]"] = reveal_type(b1)

# This should generate an error.
b2 = func1(B[None], 3.5)

b3 = func1(B[float], 3.5)
t_b3: Literal["B[float]"] = reveal_type(b3)

b4 = func1(B[Union[int, str]], 3)
t_b4: Literal["B[int | str]"] = reveal_type(b4)

b5 = func1(B[Union[int, str]], "3")
t_b5: Literal["B[int | str]"] = reveal_type(b5)


class C(Generic[_T1]):
    def __init__(self: "C[_T1]", x: _T1) -> None:
        ...


c1 = func1(C[float], 3.4)
t_c1: Literal["C[float]"] = reveal_type(c1)

# This should generate an error.
c2 = func1(C[int], 3.4)

c3 = func1(C[int], 3)
t_c3: Literal["C[int]"] = reveal_type(c3)


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
t_d1: Literal["D[int]"] = reveal_type(d1)

# This should generate an error.
d2 = func1(D[None], 3.5)

d3 = func1(D[float], 3.5)
t_d3: Literal["D[float]"] = reveal_type(d3)

d4 = func1(D[Union[int, str]], 3)
t_d4: Literal["D[int | str]"] = reveal_type(d4)

d5 = func1(D[Union[int, str]], "3")
t_d5: Literal["D[int | str]"] = reveal_type(d5)
