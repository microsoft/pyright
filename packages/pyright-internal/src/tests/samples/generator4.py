# This sample tests various type checking operations relating to
# async generator functions where the return type is inferred.

from typing import AsyncGenerator, Awaitable, Generator, Iterator


async def g1():
    yield 1
    yield 2


async def g2():
    async for v in g1():
        yield v


def g1_explicit1() -> Generator[int, None, None]:
    yield 1
    yield 2


async def g1_explicit2() -> AsyncGenerator[int, None]:
    yield 1
    yield 2


async def g2_explicit():
    for v in g1_explicit1():
        yield v

    async for v in g1_explicit2():
        yield v


async def g3(xs: Awaitable[list[int]]) -> list[int]:
    return [x for x in await xs]


async def g4(xs: list[Awaitable[int]]) -> list[int]:
    return [await x for x in xs]


class SomeIterable:
    def __init__(self):
        self.x = 1

    def __iter__(self) -> Iterator[int]:
        yield self.x


async def func1() -> SomeIterable:
    return SomeIterable()


def func2() -> Iterator[int]:
    yield 2


def g5() -> None:
    val = (y for y in func2())
    reveal_type(val, expected_text="Generator[int, None, None]")


async def g6() -> None:
    val = (x + y for y in func2() for x in await func1())
    reveal_type(val, expected_text="AsyncGenerator[int, None]")


async def g7() -> None:
    val = (x + y for y in await func1() for x in func2())
    reveal_type(val, expected_text="Generator[int, None, None]")
