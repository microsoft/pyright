# This sample tests the case where a variable type declaration is found
# within a loop and the variable is used within a conditional expression
# within the same loop.

from enum import Enum


class MyEnum(Enum):
    A = 0


def func1(vals: list[MyEnum]):
    for val1 in vals:
        val2: MyEnum = val1
        if val2 == MyEnum.A:
            pass
