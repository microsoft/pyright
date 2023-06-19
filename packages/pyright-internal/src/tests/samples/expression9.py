# This sample tests binary expressions that use list expressions as
# a RHS operand.


def func1(a: list[int | str]):
    a += [5]

    return a + [5]


def func2(a: list[int], b: int):
    return a + [b]
