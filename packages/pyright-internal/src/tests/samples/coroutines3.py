# This sample tests old-style (pre-await) awaitable generators.

import asyncio
from typing import Any, AwaitableGenerator, Literal


@asyncio.coroutine
def old_style_coroutine1():
    yield from asyncio.sleep(1)


async def func1() -> None:
    x = await old_style_coroutine1()
    t_x: Literal["None"] = reveal_type(x)
    return x


t1: Literal["() -> AwaitableGenerator[Any, None, None, None]"] = reveal_type(
    old_style_coroutine1
)


@asyncio.coroutine
def old_style_coroutine2() -> AwaitableGenerator[Any, None, None, None]:
    yield from asyncio.sleep(1)


async def func2() -> None:
    x = await old_style_coroutine2()
    return x


t2: Literal["() -> AwaitableGenerator[Any, None, None, None]"] = reveal_type(
    old_style_coroutine2
)
