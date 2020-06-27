# This sample tests exhaustive type narrowing for enums
# and the use of "Never" and "NoReturn".

from enum import Enum
from typing import Literal, NoReturn, Union


class SomeEnum(Enum):
    VALUE1 = 1
    VALUE2 = 2
    VALUE3 = 3


def assert_never(x: NoReturn) -> NoReturn:
    """Used to cause Mypy to catch impossible cases."""
    # https://github.com/python/mypy/issues/6366#issuecomment-560369716
    assert False, "Unhandled type: {}".format(type(x).__name__)


def func1(a: SomeEnum):
    if a == SomeEnum.VALUE1:
        pass
    elif a == SomeEnum.VALUE2:
        pass
    elif a == SomeEnum.VALUE3:
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

