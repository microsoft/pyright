# This sample tests the type variable solving process when a
# callable type is involved.

from typing import Callable, Dict, Literal, TypeVar


def filter_fn(value: object):
    ...


v1 = filter(filter_fn, [1, 2, 3])
t1: Literal["filter[int]"] = reveal_type(v1)

v2 = filter(filter_fn, {1, 2})
t2: Literal["filter[int]"] = reveal_type(v2)

v3 = filter(filter_fn, {1: 2})
t3: Literal["filter[int]"] = reveal_type(v3)


_T = TypeVar("_T")
Animal = Literal["cat"]


def func(v: Callable[[], _T]) -> _T:
    ...


x: Dict[Animal, int] = func(lambda: {"cat": 0})
