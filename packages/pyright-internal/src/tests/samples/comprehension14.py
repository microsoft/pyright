from __future__ import annotations

from collections.abc import AsyncIterable
from typing import Annotated


def factory(values: AsyncIterable[int]):
    async def func(value: Annotated[int, [item async for item in values]]) -> int:
        return value

    return func
