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


def func5(f: float):
    # This should generate an error because "hex" isn't
    # a valid method for an int.
    f.hex()

    if isinstance(f, float):
        reveal_type(f, expected_text="float")
        f.hex()
    else:
        reveal_type(f, expected_text="int")


def func6(f: complex):
    if isinstance(f, float):
        reveal_type(f, expected_text="float")
        f.hex()
    else:
        reveal_type(f, expected_text="complex | int")
