# This sample tests that functions containing unreachable
# yield statements are still treated as generators.

from typing import Iterable, AsyncIterable


def func1() -> Iterable[str]:
    return
    yield ""


async def func2() -> AsyncIterable[str]:
    return
    yield ""
