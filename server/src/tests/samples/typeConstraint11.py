# This sample tests the type narrowing capabilities involving
# types that have enumerated literals (bool and enums).

from enum import Enum
from typing import Literal

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

def must_be_true(a: Literal[True]): ...
def must_be_false(a: Literal[False]): ...

def func3(a: bool):
    if a == True:
        must_be_true(a)
    else:
        must_be_false(a)

def func3(a: bool):
    if not a:
        must_be_false(a)
    else:
        must_be_true(a)



