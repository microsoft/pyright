# This sample tests the handling of variadic type variables used
# in generic type aliases and with suffixes.

from typing import Callable, Generic, TypeVar
from typing_extensions import TypeVarTuple, Unpack


Ts = TypeVarTuple("Ts")
T_co = TypeVar("T_co", covariant=True)
T = TypeVar("T")


class Call(Generic[Unpack[Ts]]):
    def __init__(self, *args: Unpack[Ts]) -> None:
        self.args = args


class Return(Generic[T_co]):
    def __init__(self, /, result: T_co) -> None:
        self.result = result


TailRec = Call[Unpack[Ts]] | Return[T]


def tail_rec(
    fn: Callable[[Unpack[Ts]], TailRec[Unpack[Ts], T_co]]
) -> Callable[[Unpack[Ts]], T_co]:
    ...


@tail_rec
def factorial(n: int, acc: int) -> TailRec[int, int, int]:
    if n <= 0:
        return Return(acc)
    return Call(n - 1, acc * n)


reveal_type(factorial, expected_text="(int, int) -> int")


Alias10 = tuple[T, *Ts]
Alias11 = tuple[*Ts]
Alias12 = tuple[T, *Ts, T]


def func5(a10: Alias10, a11: Alias11, a12: Alias12):
    reveal_type(a10, expected_text="tuple[Unknown, *tuple[Unknown, ...]]")
    reveal_type(a11, expected_text="tuple[Unknown, ...]")
    reveal_type(a12, expected_text="tuple[Unknown, *tuple[Unknown, ...], Unknown]")
