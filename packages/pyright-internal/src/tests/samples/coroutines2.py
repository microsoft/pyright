# This sample verifies that the inferred return type
# of an async function is wrapped in a Coroutine.

import asyncio
from typing import Any, Coroutine

async def inspector(coro: Coroutine[Any, Any, Any]):
    print(coro.cr_frame.f_locals)
    return await coro

async def inner(sleep: int, message: str) -> str:
    await asyncio.sleep(sleep)
    print(message)
    return message

async def outer():
    await inspector(inner(1, "test"))


