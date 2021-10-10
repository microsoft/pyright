# This sample tests the case where an accessed member is a
# method that has a "self" or "cls" parameter with no explicit
# type annotation and an inferred type that is based on this value.

from typing import Literal


class A:
    async def get(self):
        return self


class B(A):
    pass


async def run():
    val1 = await A().get()
    t1: Literal["A"] = reveal_type(val1)

    val2 = await B().get()
    t2: Literal["B"] = reveal_type(val2)
