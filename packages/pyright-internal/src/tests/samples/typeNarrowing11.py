# This sample tests the type narrowing capabilities involving
# types that have enumerated literals (bool and enums).

from enum import Enum
from typing import Literal, Union


class SomeEnum(Enum):
    SOME_ENUM_VALUE1 = 1
    SOME_ENUM_VALUE2 = 2
    SOME_ENUM_VALUE3 = 3


def func1(a: SomeEnum) -> Literal[3]:
    if a == SomeEnum.SOME_ENUM_VALUE1 or a == SomeEnum.SOME_ENUM_VALUE2:
        return 3
    else:
        return a.value


def func2(a: SomeEnum) -> Literal[3]:
    if a == SomeEnum.SOME_ENUM_VALUE1:
        return 3
    elif a == SomeEnum.SOME_ENUM_VALUE2:
        return 3
    else:
        return a.value


def must_be_true(a: Literal[True]):
    ...


def must_be_false(a: Literal[False]):
    ...


def func3(a: bool):
    if a == True:
        must_be_true(a)
    else:
        must_be_false(a)


def func4(a: bool):
    if not a:
        must_be_false(a)
    else:
        must_be_true(a)


class MyEnum(Enum):
    ZERO = 0
    ONE = 1


def func5(x: Union[MyEnum, str]):
    if x is MyEnum.ZERO:
        t1: Literal["Literal[MyEnum.ZERO]"] = reveal_type(x)
    elif x is MyEnum.ONE:
        t2: Literal["Literal[MyEnum.ONE]"] = reveal_type(x)
    else:
        t3: Literal["str"] = reveal_type(x)
