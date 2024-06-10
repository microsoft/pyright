# This sample tests the type narrowing logic for
# enum values or False/True that are compared using the
# "is" and "is not" operators.

from enum import Enum
from typing import Literal, NoReturn, Union


class SomeEnum(Enum):
    VALUE1 = 1
    VALUE2 = 2


def assert_never(val: NoReturn): ...


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


def func5(a: Union[str, Literal[False]]) -> str:
    if a is False:
        return "no"
    return a


def func6(a: Union[str, Literal[False]]) -> str:
    if a is not False:
        return a
    return "no"


def func7(a: Union[str, bool]) -> str:
    if a is False:
        return "False"
    elif a is True:
        return "True"
    return a


def func8(a: object):
    if a is SomeEnum.VALUE1 or a is SomeEnum.VALUE2:
        reveal_type(a, expected_text="Literal[SomeEnum.VALUE1, SomeEnum.VALUE2]")
    else:
        reveal_type(a, expected_text="object")
