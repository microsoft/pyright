# This sample tests the use of @functools.cache with a property.

from functools import cache


class Rectangle:
    def __init__(self, length: int, width: int) -> None:
        self._length = length
        self._width = width

    @property
    @cache
    def area(self) -> int:
        return self._length * self._width


def is_large_rectangle(rec: Rectangle) -> bool:
    print(rec.area)
    return rec.area >= 100


rec = Rectangle(10, 10)
print(is_large_rectangle(rec))
