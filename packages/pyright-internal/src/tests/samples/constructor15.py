# This sample tests the case where a constructor for a generic
# class is called with an inference context (i.e. using bidirectional
# type inference) and literals are used as type arguments.

from typing import Any, Generic, Literal, Self, TypeVar

_N = TypeVar("_N")
_M = TypeVar("_M")


class A(Generic[_M, _N]):
    def __new__(cls, m: _M, n: _N) -> "A[_M, _N]": ...


a: A[Literal[3], Literal[4]] = A(3, 4)


class B(Generic[_M, _N]):
    def __new__(cls, m: _M, n: _N) -> "B[_M, _N]": ...

    def __init__(self, *args: Any, **kwargs: Any) -> None: ...


b: B[Literal[3], Literal[4]] = B(3, 4)


class C(Generic[_M, _N]):
    def __new__(cls, m: _M, n: _N) -> "C[_M, _N]": ...

    def __init__(self, m: _M, n: _N) -> None: ...


c: C[Literal[3], Literal[4]] = C(3, 4)


class D(Generic[_M, _N]):
    def __new__(cls, m: _M, n: _N) -> Self: ...


d: D[Literal[3], Literal[4]] = D(3, 4)
