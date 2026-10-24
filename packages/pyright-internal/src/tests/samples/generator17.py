# This sample tests the return type of `yield from` when a Union of Generators is passed.

from collections.abc import Generator


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


def opt(i: ReturnInt | None):
    r = yield from i  # reportOptionalIterable
    reveal_type(r, expected_text="int")
