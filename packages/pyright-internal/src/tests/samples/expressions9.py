# This sample tests binary expressions that use list expressions as
# a RHS operand.

from typing import List, Union


def func1(a: List[Union[int, str]]):
    a += [5]

    return a + [5]


def func2(a: List[int], b: int):
    return a + [b]
