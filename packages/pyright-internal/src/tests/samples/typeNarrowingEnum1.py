# This sample tests exhaustive type narrowing for enums
# and the use of "Never" and "NoReturn".

from enum import Enum, Flag
from typing import Literal, NoReturn, Union


class SomeEnum(Enum):
    value1 = 1
    value2 = 2
    value3 = 3


def assert_never(x: NoReturn) -> NoReturn:
    """Used to cause Mypy to catch impossible cases."""
    # https://github.com/python/mypy/issues/6366#issuecomment-560369716
    assert False, "Unhandled type: {}".format(type(x).__name__)


def func1(a: SomeEnum):
    if a == SomeEnum.value1:
        pass
    elif a == SomeEnum.value2:
        pass
    elif a == SomeEnum.value3:
        pass
    else:
        assert_never(a)


def func2(val: Literal["a", "b"]):
    if val == "a":
        pass
    elif val == "b":
        pass
    else:
        assert_never(val)


def func3(val: Union[str, int]):
    if isinstance(val, str):
        pass
    elif isinstance(val, int):
        pass
    else:
        assert_never(val)


def func4(val: Union[str, int]) -> Union[str, int]:
    if isinstance(val, str):
        return val
    elif isinstance(val, int):
        return val
    else:
        # Even though "val" is a Never type at this
        # point, it should be assignable to Union[str, int]
        # because Never is assignable to any type.
        return val


class MyFlags(Flag):
    V1 = 1
    V2 = 2


def func5(val: MyFlags):
    if val == MyFlags.V1 or val == MyFlags.V2:
        return

    reveal_type(val, expected_text="MyFlags")
