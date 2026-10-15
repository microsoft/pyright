# This sample tests the inference of types relating to
# "yield from" statements.

from typing import Generator


class Yielder:
    def __iter__(self) -> Generator[int, None, bool]:
        yield 1
        return True


def collect1() -> Generator[str, None, bool]:
    y = Yielder()

    # This should generate an error because int doesn't match str.
    z = yield from y
    return z


def collect2():
    y = Yielder()
    z = yield from y
    reveal_type(z, expected_text="bool")
    return z


class ReturnInt:
    def __iter__(self) -> Generator[None, None, int]:
        return 1
        yield


class ReturnStr:
    def __iter__(self) -> Generator[None, None, str]:
        return ""
        yield


def union(i: ReturnInt | ReturnStr):
    r = yield from i
    reveal_type(r, expected_text="int | str")
