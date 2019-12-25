# This sample tests that functions containing unreachable
# yield statements are still treated as generators.

from typing import Iterable, AsyncIterable

def foo() -> Iterable[str]:
    return
    yield ''

async def afoo() -> AsyncIterable[str]:
    return
    yield ''
