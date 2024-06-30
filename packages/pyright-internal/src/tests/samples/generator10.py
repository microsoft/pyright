# This sample tests type inference for a generator returned
# by an __await__ function.

from collections.abc import Awaitable
from asyncio import get_event_loop, sleep


class MyAwaitable(Awaitable):
    def __await__(self):
        yield from (sleep(0.1).__await__())


async def func1():
    x: None = await MyAwaitable()


loop = get_event_loop()
loop.run_until_complete(func1())
