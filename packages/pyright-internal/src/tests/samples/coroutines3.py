# This sample tests old-style (pre-await) awaitable generators.

import asyncio
from typing import Any
from _typeshed._type_checker_internals import AwaitableGenerator


@asyncio.coroutine
def old_style_coroutine1():
    yield from asyncio.sleep(1)


async def func1() -> None:
    x = await old_style_coroutine1()
    reveal_type(x, expected_text="None")
    return x


reveal_type(
    old_style_coroutine1,
    expected_text="() -> AwaitableGenerator[Any, Unknown, None, Any]",
)


@asyncio.coroutine
def old_style_coroutine2() -> AwaitableGenerator[None, None, None, Any]:
    yield from asyncio.sleep(1)


async def func2() -> None:
    x = await old_style_coroutine2()
    reveal_type(x, expected_text="None")
    return x


reveal_type(
    old_style_coroutine2,
    expected_text="() -> AwaitableGenerator[None, None, None, Any]",
)
