# This sample tests the type analyzer's type narrowing
# logic for literals.

from typing import Literal, Union


def func_1(p1: Literal["a", "b", "c"]):
    if p1 != "b":
        if p1 == "c":
            t1: Literal["Literal['c']"] = reveal_type(p1)
            pass
        else:
            t2: Literal["Literal['a']"] = reveal_type(p1)

    if p1 != "a":
        t3: Literal["Literal['c', 'b']"] = reveal_type(p1)
    else:
        t4: Literal["Literal['a']"] = reveal_type(p1)

    if "a" != p1:
        t5: Literal["Literal['c', 'b']"] = reveal_type(p1)
    else:
        t6: Literal["Literal['a']"] = reveal_type(p1)


def func2(p1: Literal[1, 4, 7]):
    if 4 == p1 or 1 == p1:
        t1: Literal["Literal[4, 1]"] = reveal_type(p1)
    else:
        t2: Literal["Literal[7]"] = reveal_type(p1)


def func3(a: Union[int, None]):
    if a == 1 or a == 2:
        t1: Literal["Literal[1, 2]"] = reveal_type(a)
