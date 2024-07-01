# This sample tests the case where a specialized generic class references
# itself in a magic method like __iter__.

from typing import Iterator, Generic, TypeVar

A = TypeVar("A")


class Iter(Generic[A]):
    def __iter__(self) -> Iterator[A]: ...

    def enumerate(self) -> "Iter[tuple[int, A]]": ...

    def method1(self) -> None:
        for x in self.enumerate():
            reveal_type(x, expected_text="tuple[int, A@Iter]")
