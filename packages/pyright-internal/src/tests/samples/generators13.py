# This sample tests async generator and non-generator functions.

import asyncio
from typing import AsyncGenerator, AsyncIterator, List


async def get_data() -> List[int]:
    await asyncio.sleep(1)
    return [1, 2, 3]


async def generate(nums: List[int]) -> AsyncGenerator[str, None]:
    for n in nums:
        await asyncio.sleep(1)
        yield f"The number is {n}"


async def get_generator1() -> AsyncGenerator[str, None]:
    data = await get_data()
    v1 = generate(data)
    reveal_type(v1, expected_text="AsyncGenerator[str, None]")
    return v1


async def get_generator2() -> AsyncIterator[str]:
    data = await get_data()
    v1 = generate(data)
    reveal_type(v1, expected_text="AsyncGenerator[str, None]")
    return v1


async def get_value(v: int) -> int:
    await asyncio.sleep(1)
    return v + 1


async def get_generator3() -> AsyncGenerator[int, None]:
    return (await get_value(v) for v in [1, 2, 3])


def get_generator4() -> AsyncGenerator[int, None]:
    return (await get_value(v) for v in [1, 2, 3])


async def demo_bug1() -> None:
    v1 = get_generator1()
    reveal_type(v1, expected_text="Coroutine[Any, Any, AsyncGenerator[str, None]]")
    gen = await v1
    reveal_type(gen, expected_text="AsyncGenerator[str, None]")
    async for s in gen:
        print(s)


async def demo_bug2() -> None:
    v1 = get_generator2()
    reveal_type(v1, expected_text="Coroutine[Any, Any, AsyncIterator[str]]")
    gen = await v1
    reveal_type(gen, expected_text="AsyncIterator[str]")
    async for s in gen:
        print(s)


loop = asyncio.get_event_loop()
loop.run_until_complete(demo_bug1())
loop.run_until_complete(demo_bug2())
