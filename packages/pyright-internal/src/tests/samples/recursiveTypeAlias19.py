# This sample tests specialization of recursive type aliases whose type
# arguments grow with each expansion. Variance inference for the alias
# must terminate on these cases.

from typing import Callable

type GrowingList[T] = list[GrowingList[T | GrowingList[T]]]

type GrowingCallable[T] = Callable[
    [GrowingCallable[T]], GrowingCallable[T | GrowingCallable[T]]
]


def func1(x: GrowingList[int]): ...


def func2(x: GrowingCallable[int]): ...
