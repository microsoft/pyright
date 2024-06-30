# This sample verifies that overloads work in
# conjunction with async methods.

from typing import overload


@overload
async def func(x: int) -> int: ...


@overload
async def func(x: str) -> str: ...


async def func(x) -> int | str:
    if isinstance(x, int):
        return 32
    else:
        return "that"


async def test_function():
    v1 = await func("2")
    reveal_type(v1, expected_text="str")

    v2 = await func(2)
    reveal_type(v2, expected_text="int")
