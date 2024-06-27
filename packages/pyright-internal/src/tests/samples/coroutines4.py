# This sample tests the case where an inner coroutine with an inferred
# return type is referenced in a manner that results in recursion.

import asyncio


def func1(replace_inner: bool) -> None:
    inner = lambda: None

    async def wrapper():
        inner()

    wrapped_fn = wrapper()
    asyncio.create_task(wrapped_fn)

    if replace_inner:
        inner = lambda: None
