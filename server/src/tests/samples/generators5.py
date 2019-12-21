# This sample tests various type checking operations relating to
# async generator functions where the return type is declared.

from typing import AsyncIterator

async def g1_explicit() -> AsyncIterator[int]:
    yield 1
    yield 2

async def g2_explicit():
    async for v in g1_explicit():
        yield v
