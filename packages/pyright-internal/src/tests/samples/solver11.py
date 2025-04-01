# This sample tests the constraint solver when a callable type is involved.

# pyright: strict

from typing import Callable, Literal, TypeVar


def filter_fn(value: object): ...


v1 = filter(filter_fn, [1, 2, 3])
reveal_type(v1, expected_text="filter[int]")

v2 = filter(filter_fn, {1, 2})
reveal_type(v2, expected_text="filter[int]")

v3 = filter(filter_fn, {1: 2})
reveal_type(v3, expected_text="filter[int]")


_T = TypeVar("_T")
Animal = Literal["cat"]


def func(v: Callable[[], _T]) -> _T: ...


x1: dict[Animal, int] = func(lambda: {"cat": 0})


def func1(factory: Callable[[], _T]) -> _T: ...


x2: set[int] = func1(lambda: set())
