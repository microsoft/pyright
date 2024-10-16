# This sample tests that types defined by type variables can be
# awaited.

from typing import Generator, Any, NoReturn


class MyAwaitable:
    def __await__(self) -> Generator[Any, None, int]:
        async def foo() -> int:
            return 1

        return foo().__await__()

    async def foo(self) -> int:
        return await self


async def func1() -> None:
    p = MyAwaitable()
    print(await p.foo())
    print(await p)


async def func2() -> NoReturn:
    raise Exception()


async def func3(x: int | None):
    if x is None:
        await func2()
    print(x.bit_count())
