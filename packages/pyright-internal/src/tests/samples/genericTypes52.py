# This sample tests the case where a TypeVar is used in the parameter
# of a callable (and is hence treated as contravariant).

from typing import Callable, Literal, Sequence, TypeVar

T = TypeVar("T")
U = TypeVar("U")


def foo(value: T) -> T:
    ...


def bar(values: Sequence[T]) -> T:
    ...


def baz(
    value: T,
    callback: Callable[[T], U],
) -> U:
    ...


def qux(
    values: Sequence[T],
    callback: Callable[[Sequence[T]], U],
) -> U:
    ...


t1: Literal["float"] = reveal_type(baz(1.0, foo))
t2: Literal["Sequence[float]"] = reveal_type(qux([1.0], foo))
t3: Literal["float"] = reveal_type(qux([1.0], bar))
