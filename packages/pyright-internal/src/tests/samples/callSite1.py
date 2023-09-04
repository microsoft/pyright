# This sample tests pyright's ability to perform return type
# analysis of functions based on call-site arguments.


# This function has no type annotations
from typing import TypeVar


def add(a, b):
    return a + b


async def async_call(x):
    return x


T = TypeVar("T")


def deco1(f: T) -> T:
    return f


@deco1
def add2(a, b):
    return a + b
