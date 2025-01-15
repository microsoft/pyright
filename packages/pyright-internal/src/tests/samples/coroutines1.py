# This same tests the type checker's ability to validate
# types related to coroutines (and async/await) statements.

from typing import Generator, Any, Optional
from asyncio import coroutine


async def coroutine1():
    return 1


a = coroutine1()

# This should generate an error because 'await'
# can't be used outside of an async function.
await a


async def func1() -> int: ...


async def func2() -> None:
    # This should generate an error because await cannot be
    # used in a lambda.
    x = lambda: await func2()


def needs_int(val: int):
    pass


async def consumer1():
    # This should generate an error because
    # a is not an int
    needs_int(a)

    needs_int(await a)

    needs_int(await coroutine1())


class ScopedClass1:
    def __aenter__(self):
        return self

    @coroutine
    def __await__(self) -> Generator[Any, None, int]:
        yield 3
        return 3

    async def __aexit__(
        self,
        t: Optional[type] = None,
        exc: Optional[BaseException] = None,
        tb: Optional[Any] = None,
    ) -> bool:
        return True


async def consumer2():
    a = ScopedClass1()

    # This should generate two errors because
    # there is no __enter__ or __exit__ method on ScopedClass1.
    with a as b:
        needs_int(b)

    async with a as b:
        needs_int(b)
