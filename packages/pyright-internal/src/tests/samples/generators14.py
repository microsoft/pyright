# This sample tests the inferred type of async and sync generators.

from typing import Literal


async def foo() -> int:
    ...


async def main() -> None:
    v1 = (x for x in [2, 3] if x > 3)
    t1: Literal["Generator[int, None, None]"] = reveal_type(v1)

    v2 = (x for x in [2, 3] if await foo())
    t2: Literal["AsyncGenerator[int, None]"] = reveal_type(v2)

    v3 = (x for x in [2, 3])
    t3: Literal["Generator[int, None, None]"] = reveal_type(v3)

    v4 = (await foo() for _ in [2, 3])
    t4: Literal["AsyncGenerator[int, None]"] = reveal_type(v4)
