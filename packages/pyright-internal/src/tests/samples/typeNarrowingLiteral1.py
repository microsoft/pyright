# This sample tests the type analyzer's type narrowing
# logic for literals.

from typing import Literal, Union


def requires_a(p1: Literal["a"]):
    pass


def requires_bc(p1: Literal["b", "c"]):
    pass


def func_1(p1: Literal["a", "b", "c"]):
    if p1 != "b":
        if p1 == "c":
            pass
        else:
            requires_a(p1)

    if p1 != "a":
        requires_bc(p1)
    else:
        requires_a(p1)

    if "a" != p1:
        requires_bc(p1)
    else:
        requires_a(p1)


def requires_7(p1: Literal[7]):
    pass


def func2(p1: Literal[1, 4, 7]):
    if 4 == p1 or 1 == p1:
        pass
    else:
        requires_7(p1)


def func3(a: Union[int, None]):
    if a == 1 or a == 2:
        t1: Literal["Literal[1, 2]"] = reveal_type(a)
