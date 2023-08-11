# This sample tests handling of special-cased "type promotions".


from typing import NewType


def func1(float_val: float, int_val: int):
    v1: float = int_val
    v2: complex = float_val
    v3: complex = int_val


class IntSubclass(int):
    ...


def func3(x: IntSubclass) -> float:
    return x


IntNewType = NewType("IntNewType", int)


def func4(x: IntNewType) -> float:
    return x
