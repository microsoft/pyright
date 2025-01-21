# This sample tests the case where the solver generates an unsolved
# unification variable that has been specialized into a conditional type.

from typing import Callable, Iterable, Self


class map[S]:
    def __new__[T](cls, func: Callable[[T], S], iter1: Iterable[T]) -> Self: ...


def func(a: list[int | None]):
    b = map(lambda x: x or 0, a)
    reveal_type(b, expected_text="map[int]")
