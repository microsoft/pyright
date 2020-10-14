# This sample tests that an unbound variable that is generated in
# a function does not propagate beyond that function to callers.


from typing import Literal


def func1():
    # This should generate an error
    return a


# This should not.
b = func1()
tb1: Literal["Unknown"] = reveal_type(b)


def func2(val: int):
    if val < 3:
        return val

    # This should generate an error
    return a


# This should not.
c = func2(36)
tc1: Literal["int | Unknown"] = reveal_type(c)
