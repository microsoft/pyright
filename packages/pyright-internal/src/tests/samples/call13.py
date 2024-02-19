# This sample tests the case where a call invokes a generic function that
# uses a default argument assigned to a parameter whose type is generic.

from typing import TypeVar, Iterable, Callable

T1 = TypeVar("T1")
T2 = TypeVar("T2")


def func1(values: Iterable[T1], func: Callable[[T1], T2] = lambda x: x) -> list[T2]:
    return [func(value) for value in values]


v1 = func1([1, 2, 3])
reveal_type(v1, expected_text="list[int]")
