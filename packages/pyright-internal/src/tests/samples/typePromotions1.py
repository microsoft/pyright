# This sample tests handling of special-cased "type promotions".


from typing import NewType


def func1(float_val: float, int_val: int):
    v1: float = int_val
    v2: complex = float_val
    v3: complex = int_val


def func2(mem_view_val: memoryview, byte_array_val: bytearray):
    v1: bytes = mem_view_val
    v2: bytes = byte_array_val


class IntSubclass(int): ...


def func3(x: IntSubclass) -> float:
    return x


IntNewType = NewType("IntNewType", int)


def func4(x: IntNewType) -> float:
    return x


def func5(f: float):
    if isinstance(f, float):
        reveal_type(f, expected_text="float")
    else:
        reveal_type(f, expected_text="int")


def func6(f: complex):
    if isinstance(f, float):
        reveal_type(f, expected_text="float")
    else:
        reveal_type(f, expected_text="complex | int")
