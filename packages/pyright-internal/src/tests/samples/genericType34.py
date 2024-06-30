# This sample tests bidirectional type inference for the call of a generic
# method that returns a generic type with multiple type arguments where
# some of these type arguments can be satisfied directly by the expected
# type's type arguments and some cannot.

from typing import Generic, Literal, TypeVar

_T_co = TypeVar("_T_co", covariant=True)
_N = TypeVar("_N", bound=int)


class ClassA(Generic[_T_co, _N]): ...


def func1(n: _N) -> ClassA[Literal[0], _N]: ...


v1: ClassA[int, Literal[1]] = func1(1)
