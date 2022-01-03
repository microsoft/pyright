# This sample tests type inference for tuples that contain unpack
# operators.

from typing import Literal


def func1(a: int, *args: int):
    v1 = (a, *args)
    t1: Literal["tuple[int, *tuple[int, ...]]"] = reveal_type(v1)


def func2(a: int, *args: str):
    v1 = (a, *args)
    t1: Literal["tuple[int, *tuple[str, ...]]"] = reveal_type(v1)


def func3(a: int, b: str, *args: str):
    v1 = (a, b, *(a, b, a), *args, a, *args, b, *(a, b, a))
    t1: Literal["tuple[int, str, int, str, int, *tuple[str | int, ...]]"] = reveal_type(
        v1
    )


def func4(a: int, b: str, *args: str):
    v1 = (b, *args, *(b, a))
    t1: Literal["tuple[str, *tuple[str, ...], str, int]"] = reveal_type(v1)


def func5():
    a = 3.4
    b = [1, 2, 3]
    v1 = (a, *b)
    t1: Literal["tuple[float, *tuple[int, ...]]"] = reveal_type(v1)
