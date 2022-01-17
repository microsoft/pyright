# This sample tests old-style (pre-await) awaitable generators.

import asyncio
from typing import Any, AwaitableGenerator


@asyncio.coroutine
def old_style_coroutine1():
    yield from asyncio.sleep(1)


async def func1() -> None:
    x = await old_style_coroutine1()
    reveal_type(x, expected_text="None")
    return x


reveal_type(
    old_style_coroutine1,
    expected_text="() -> AwaitableGenerator[Any, None, None, None]",
)


@asyncio.coroutine
def old_style_coroutine2() -> AwaitableGenerator[Any, None, None, None]:
    yield from asyncio.sleep(1)


async def func2() -> None:
    x = await old_style_coroutine2()
    return x


reveal_type(
    old_style_coroutine2,
    expected_text="() -> AwaitableGenerator[Any, None, None, None]",
)
