# This sample tests zero-argument super() when a comprehension's implicit
# iterator argument is an instance of the enclosing class.

from collections.abc import Iterator
from typing import Any, Self


class Base:
    def answer(self) -> int:
        return 7


class SelfIterator(Base, Iterator[int]):
    def __init__(self):
        self.done = False

    def __iter__(self) -> Self:
        return self

    def __next__(self) -> int:
        if self.done:
            raise StopIteration
        self.done = True
        return 1

    def values(self) -> list[int]:
        result = list(super().answer() for _ in self)
        reveal_type(result, expected_text="list[int]")
        return result

    def comprehensions(self):
        reveal_type([super().answer() for _ in self], expected_text="list[int]")
        reveal_type({super().answer() for _ in self}, expected_text="set[int]")
        reveal_type({0: super().answer() for _ in self}, expected_text="dict[int, int]")

    def uncertain_iterator(self, values: Iterator[int], dynamic: Any):
        reveal_type(
            (super().answer() for _ in values),
            expected_text="Generator[int, None, None]",
        )
        reveal_type(
            (super().answer() for _ in dynamic),
            expected_text="Generator[int, None, None]",
        )

    def nested_frame(self):
        # Before Python 3.12 the comprehension receives self as its iterator.
        # With inlining, the argument-less lambda's frame cannot supply self.
        return lambda: [super().answer() for _ in self]


class DerivedIterator(SelfIterator):
    def values(self) -> list[int]:
        result = list(super().answer() for _ in self)
        reveal_type(result, expected_text="list[int]")
        return result
