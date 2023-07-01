# This sample tests the case where a TypeVar is used in the parameter
# of a callable (and is hence treated as contravariant).

from typing import Callable, Sequence, TypeVar

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


reveal_type(baz(1.0, foo), expected_text="float")
reveal_type(qux([1.0], foo), expected_text="Sequence[float]")
reveal_type(qux([1.0], bar), expected_text="float")
