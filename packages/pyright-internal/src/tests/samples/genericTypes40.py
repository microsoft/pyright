# This sample tests the type variable solving process when a
# callable type is involved.

from typing import Callable, Dict, Literal, TypeVar


def filter_fn(value: object):
    ...


v1 = filter(filter_fn, [1, 2, 3])
reveal_type(v1, expected_text="filter[int]")

v2 = filter(filter_fn, {1, 2})
reveal_type(v2, expected_text="filter[int]")

v3 = filter(filter_fn, {1: 2})
reveal_type(v3, expected_text="filter[int]")


_T = TypeVar("_T")
Animal = Literal["cat"]


def func(v: Callable[[], _T]) -> _T:
    ...


x: Dict[Animal, int] = func(lambda: {"cat": 0})
