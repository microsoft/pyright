from collections.abc import AsyncIterable
from typing import Annotated


async def factory(values: AsyncIterable[int]):
    def func(value: Annotated[int, [item async for item in values]]) -> int:
        return value

    return func
