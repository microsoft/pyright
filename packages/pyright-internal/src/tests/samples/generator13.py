# This sample tests async generator and non-generator functions.

import asyncio
from typing import AsyncGenerator, AsyncIterator, Protocol


async def get_data() -> list[int]:
    await asyncio.sleep(1)
    return [1, 2, 3]


async def generate(nums: list[int]) -> AsyncGenerator[str, None]:
    for n in nums:
        await asyncio.sleep(1)
        yield f"The number is {n}"


async def func1() -> AsyncGenerator[str, None]:
    data = await get_data()
    v1 = generate(data)
    reveal_type(v1, expected_text="AsyncGenerator[str, None]")
    return v1


async def func2() -> AsyncIterator[str]:
    data = await get_data()
    v1 = generate(data)
    reveal_type(v1, expected_text="AsyncGenerator[str, None]")
    return v1


async def get_value(v: int) -> int:
    await asyncio.sleep(1)
    return v + 1


async def func3() -> AsyncGenerator[int, None]:
    return (await get_value(v) for v in [1, 2, 3])


def func4() -> AsyncGenerator[int, None]:
    return (await get_value(v) for v in [1, 2, 3])


async def func5() -> None:
    v1 = func1()
    reveal_type(v1, expected_text="CoroutineType[Any, Any, AsyncGenerator[str, None]]")
    gen = await v1
    reveal_type(gen, expected_text="AsyncGenerator[str, None]")
    async for s in gen:
        print(s)


async def func6() -> None:
    v1 = func2()
    reveal_type(v1, expected_text="CoroutineType[Any, Any, AsyncIterator[str]]")
    gen = await v1
    reveal_type(gen, expected_text="AsyncIterator[str]")
    async for s in gen:
        print(s)


loop = asyncio.get_event_loop()
loop.run_until_complete(func5())
loop.run_until_complete(func6())


class Proto(Protocol):
    async def iter(self) -> AsyncGenerator[bytes, None]: ...


async def func7(p: Proto):
    async for x in await p.iter():
        pass
