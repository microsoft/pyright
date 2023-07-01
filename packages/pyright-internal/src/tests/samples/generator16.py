# This sample tests the case where a return statement within an async
# generator has an explicit return value. This generates a syntax
# error at runtime.

from typing import Any, AsyncIterable


async def func1(n: int, fa: AsyncIterable[Any]):
    if n <= 0:
        # This should generate an error because return statements
        # are not allowed in async generators.
        return None

    g = aiter(fa)

    while True:
        try:
            yield await g.__anext__()
        except StopAsyncIteration:
            return
