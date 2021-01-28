# This sample tests various type checking operations relating to
# async generator functions where the return type is inferred.


async def g1():
    yield 1
    yield 2


async def g2():
    async for v in g1():
        yield v


from typing import AsyncGenerator, Generator


async def g1_explicit1() -> Generator[int, None, None]:
    yield 1
    yield 2


async def g1_explicit2() -> AsyncGenerator[int, None]:
    yield 1
    yield 2


async def g2_explicit():
    async for v in g1_explicit1():
        yield v

    async for v in g1_explicit2():
        yield v
