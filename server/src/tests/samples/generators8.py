# This sample verifies that the "yield from" argument
# is wrapped in an Iterable.

from typing import Generator

ints1 = [1, 2]
ints2 = [3, 4]


def foo() -> Generator[int, None, None]:
    yield from ints1
    yield from ints2


