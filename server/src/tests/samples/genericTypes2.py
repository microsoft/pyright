# This sample checks for handling of generic functions.

from typing import TypeVar, Any, Callable, List

T = TypeVar("T")

def for_each(xs: List[T], f: Callable[[T], Any]) -> None:
    for x in xs:
        f(x)

class Foo:
    ...

def call_len(x: Foo) -> None:
    pass

# This should generate an error because call_len takes a str,
# which isn't compatible with a List[int].
for_each([1, 2, 3], call_len)


def validate_param_types(i: int, s: str):
    pass

async def test():
    import asyncio

    async def get_int() -> int:
        return 42

    async def get_str() -> str:
        return "Hi!"

    i, s = await asyncio.gather(get_int(), get_str())
    validate_param_types(i, s)
