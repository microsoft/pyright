# This sample tests the case where a type alias is accessed within
# a loop as both an annotation and a value expression.

from typing import Literal


TA1 = Literal["a", "b"]


def func1(values: list):
    for value in values:
        x: TA1 = value["x"]

        if x not in TA1.__args__:
            raise ValueError()
