# This sample tests that types defined by type variables can be
# awaited.

import asyncio
from typing import Generator, Any


class MyAwaitable:
    def __await__(self) -> Generator[Any, None, int]:
        async def foo() -> int:
            return 1

        return foo().__await__()

    async def foo(self) -> int:
        return await self


async def main() -> None:
    p = MyAwaitable()
    print(await p.foo())
    print(await p)


asyncio.run(main())
