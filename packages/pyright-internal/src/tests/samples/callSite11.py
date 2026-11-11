# This sample tests borrowed caller-bound type variables in expected lambda types.

from collections.abc import Callable
from functools import reduce
from typing import Generic, TypeVar

T = TypeVar("T", covariant=True)
K = TypeVar("K")
V = TypeVar("V")


class Box(Generic[T]):
    def merge(self, other: "Box[T]") -> "Box[T]":
        return self

    def through_helper(self: "Box[K]") -> "Box[K]":
        result = forward((self, self))
        reveal_type(result, expected_text="Box[K@through_helper]")
        return result


def forward(boxes):
    return reduce(lambda acc, other: acc.merge(other), boxes)


def direct(value: Box[K]) -> Box[K]:
    return reduce(lambda acc, other: acc.merge(other), (value, value))


def through_untyped(value: Box[K]) -> Box[K]:
    return forward((value, value))


def annotated_forward(boxes: tuple[Box[K], ...]) -> Box[K]:
    return reduce(lambda acc, other: acc.merge(other), boxes)


def through_annotated(value: Box[K]) -> Box[K]:
    return annotated_forward((value, value))


def concrete(value: Box[int]) -> Box[int]:
    return forward((value, value))


def negative(value: Box[int]) -> Box[str]:
    # This should generate an error because forwarding retains int.
    return forward((value, value))


def apply(value: K, callback: Callable[[K], V]) -> V:
    return callback(value)


def higher_order(boxes):
    return apply(boxes, lambda values: forward(values))


def nested(value: Box[K]) -> Box[K]:
    return higher_order((value, value))


def nested_negative(value: Box[K]) -> Box[int]:
    # This should generate an error because caller K is not necessarily int.
    return higher_order((value, value))


def independent(left: Box[K], right: Box[V]) -> tuple[Box[K], Box[V]]:
    first = forward((left, left))
    second = higher_order((right, right))
    reveal_type(first, expected_text="Box[K@independent]")
    reveal_type(second, expected_text="Box[V@independent]")
    return first, second


def independent_negative(left: Box[K], right: Box[V]) -> Box[K]:
    # This should generate an error because independent caller variables differ.
    return higher_order((right, right))


def factory(values: tuple[Box[K], ...]) -> Callable[[], Box[K]]:
    return lambda: forward(values)


def deferred(value: Box[K]) -> Callable[[], Box[K]]:
    return factory((value, value))


def check_order(integer: Box[int], text: Box[str]) -> None:
    reveal_type(forward((integer, integer)), expected_text="Box[int]")
    reveal_type(higher_order((text, text)), expected_text="Box[str]")
    reveal_type(factory((integer, integer))(), expected_text="Box[int]")
    reveal_type(forward((text, text)), expected_text="Box[str]")


def identity(value: K) -> K:
    return value


def compose(first: Callable[[K], V], second: Callable[[V], T]) -> Callable[[K], T]:
    return lambda value: second(first(value))


composed = compose(identity, identity)
reveal_type(composed(1), expected_text="int")
reveal_type(composed("value"), expected_text="str")
