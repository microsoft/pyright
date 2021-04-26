# This sample tests the type inference of list comprehensions
# that result in AsyncGenerator types.

import asyncio


async def do_iter():
    for i in range(10):
        yield i
        await asyncio.sleep(0.1)


async def doit():
    as_list = (i + 1 async for i in do_iter())

    async for i in as_list:
        print(i)


asyncio.run(doit())
