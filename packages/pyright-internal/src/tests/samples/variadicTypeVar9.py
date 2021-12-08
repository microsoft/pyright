# This sample tests the handling of variadic type variables used
# in generic type aliases and with suffixes.

from typing import Callable, Generic, Literal, TypeVar, Union
from typing_extensions import TypeVarTuple, Unpack


P = TypeVarTuple("P")
T = TypeVar("T", covariant=True)


class Call(Generic[Unpack[P]]):
    def __init__(self, *args: Unpack[P]) -> None:
        self.args = args


class Return(Generic[T]):
    def __init__(self, /, result: T) -> None:
        self.result = result


TailRec = Call[Unpack[P]] | Return[T]


def tail_rec(
    fn: Callable[[Unpack[P]], TailRec[Unpack[P], T]]
) -> Callable[[Unpack[P]], T]:
    ...


@tail_rec
def factorial(n: int, acc: int) -> TailRec[int, int, int]:
    if n <= 0:
        return Return(acc)
    return Call(n - 1, acc * n)


t1: Literal["(int, int) -> int"] = reveal_type(factorial)
