# This sample tests type narrowing for Enums using the "in" operator.

import enum


class MyEnum(enum.Enum):
    A = enum.auto()
    B = enum.auto()
    C = enum.auto()


def func1(x: MyEnum):
    if x is MyEnum.C:
        return
    elif x in (MyEnum.A, MyEnum.B):
        reveal_type(x, expected_text="Literal[MyEnum.A, MyEnum.B]")
    else:
        reveal_type(x, expected_text="Never")


def func2(x: MyEnum):
    if x in (MyEnum.A, MyEnum.B):
        reveal_type(x, expected_text="Literal[MyEnum.A, MyEnum.B]")
    else:
        reveal_type(x, expected_text="Literal[MyEnum.C]")
