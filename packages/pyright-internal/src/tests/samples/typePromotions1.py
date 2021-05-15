# This sample tests handling of special-cased "type promotions".


def func1(float_val: float, int_val: int):
    v1: float = int_val
    v2: complex = float_val
    v3: complex = int_val


def func2(mem_view_val: memoryview, byte_array_val: bytearray):
    v1: bytes = mem_view_val
    v2: bytes = byte_array_val
