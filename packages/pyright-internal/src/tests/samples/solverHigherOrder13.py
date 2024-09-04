# This sample tests a particular situation that regressed.

from typing import Any, Generic, TypeVar, TypeVarTuple, Callable

D = TypeVar("D")
S = TypeVarTuple("S")


class N(Generic[*S, D]): ...


def func1[*S1, D1, *S2, D2, Dim1](
    c: Callable[[N[*S1, D1], N[*S2, D2]], Any],
) -> Callable[[N[Dim1, *S1, D1], N[Dim1, *S2, D2]], Any]: ...


def func2[X, Y, Z](x: N[X, Y, Z], y: N[X, Y, Z]):
    func1(func3)(x, y)


def func3[Dim1, T](x: N[Dim1, T], y: N[Dim1, T]) -> N[T]: ...
