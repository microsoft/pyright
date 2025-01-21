# This sample verifies that the inferred return type
# of an async function is wrapped in a Coroutine.

import asyncio
from typing import Any, Coroutine


async def inspector(cr: Coroutine[Any, Any, Any]):
    return await cr


async def inner(sleep: int, message: str) -> str:
    await asyncio.sleep(sleep)
    print(message)
    return message


async def outer():
    await inspector(inner(1, "test"))


async def recursive1():
    await recursive1()
