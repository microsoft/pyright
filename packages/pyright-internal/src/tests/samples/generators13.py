# This sample tests async generator and non-generator functions.

import asyncio
from typing import AsyncGenerator, AsyncIterator, List, Literal


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
    t_v1: Literal["AsyncGenerator[str, None]"] = reveal_type(v1)
    return v1


async def get_generator2() -> AsyncIterator[str]:
    data = await get_data()
    v1 = generate(data)
    t_v1: Literal["AsyncGenerator[str, None]"] = reveal_type(v1)
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
    t_v1: Literal["Coroutine[Any, Any, AsyncGenerator[str, None]]"] = reveal_type(v1)
    gen = await v1
    t_gen: Literal["AsyncGenerator[str, None]"] = reveal_type(gen)
    async for s in gen:
        print(s)


async def demo_bug2() -> None:
    v1 = get_generator2()
    t_v1: Literal["Coroutine[Any, Any, AsyncIterator[str]]"] = reveal_type(v1)
    gen = await v1
    t_gen: Literal["AsyncIterator[str]"] = reveal_type(gen)
    async for s in gen:
        print(s)


loop = asyncio.get_event_loop()
loop.run_until_complete(demo_bug1())
loop.run_until_complete(demo_bug2())
