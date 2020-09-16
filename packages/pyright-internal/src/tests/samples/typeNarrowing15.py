# This sample tests the type narrowing logic for
# enum values that are compared using the "is" and
# "is not" operators.

from enum import Enum
from typing import NoReturn


class SomeEnum(Enum):
    VALUE1 = 1
    VALUE2 = 2


def assert_never(val: NoReturn):
    ...


def func1(a: SomeEnum):
    if a is SomeEnum.VALUE1:
        pass
    elif a is SomeEnum.VALUE2:
        pass
    else:
        assert_never(a)


def func2(a: SomeEnum):
    if a is SomeEnum.VALUE1:
        pass
    else:
        # This should generate an error because
        # a hasn't been narrowed to Never.
        assert_never(a)


def func3(a: SomeEnum):
    if not a is not SomeEnum.VALUE1:
        pass
    elif not a is not SomeEnum.VALUE2:
        pass
    else:
        assert_never(a)


def func4(a: SomeEnum):
    if not a is not SomeEnum.VALUE1:
        pass
    else:
        # This should generate an error because
        # a hasn't been narrowed to Never.
        assert_never(a)

