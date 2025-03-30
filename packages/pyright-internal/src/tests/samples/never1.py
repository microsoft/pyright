# This sample tests the handling of the "Never" type,
# ensuring that it's treated as the same as NoReturn.

from typing import NoReturn, TypeVar, Generic
from typing_extensions import Never  # pyright: ignore[reportMissingModuleSource]

T = TypeVar("T")


class ClassA(Generic[T]): ...


def func1(val: ClassA[Never]):
    # This should generate an error because
    # the type parameter for ClassA is invariant.
    x: ClassA[object] = val


def assert_never1(val: Never) -> NoReturn:
    raise Exception("Should never get here")


def assert_never2(val: NoReturn) -> NoReturn:
    raise Exception("Should never get here")


# This should generate an error because Never doesn't accept type arguments.
def assert_never3(val: Never[int]): ...


# This should generate an error because NoReturn doesn't accept type arguments.
def assert_never4(val: NoReturn[int]): ...


def func2(val: str | int) -> str:
    if isinstance(val, (str, int)):
        return "str or int"
    else:
        assert_never1(val)


def func3(val: str | int) -> str:
    if isinstance(val, (str, int)):
        return "str or int"
    else:
        assert_never2(val)


def func4():
    # This should generate an error because of the missing argument.
    assert_never1()


reveal_type(assert_never1, expected_text="(val: Never) -> NoReturn")

# This should generate an error.
assert_never1(1)
