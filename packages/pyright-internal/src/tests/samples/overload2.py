# This sample verifies that overloads work in
# conjunction with async methods.

from typing import Union, overload


@overload
async def func(x: int) -> int:
    ...


@overload
async def func(x: str) -> str:
    ...


async def func(x) -> Union[int, str]:
    if isinstance(x, int):
        return 32
    else:
        return "that"


def requires_str(a: str):
    pass


def requires_int(a: int):
    pass


async def test_function():
    should_be_str = await func("2")
    requires_str(should_be_str)

    should_be_int = await func(2)
    requires_int(should_be_int)
