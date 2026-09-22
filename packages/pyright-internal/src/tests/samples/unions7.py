# This sample tests that union annotations retain known members when
# an imported type is unknown, without changing runtime "|" operations.

from typing import Any, Callable, TypeVar, Union

# This should generate an error because the module is deliberately missing.
from _missing_union_dependency import Failure, Missing


def func1(x: Missing | None, y: None | Missing, z: Union[Missing, None]):
    reveal_type(x, expected_text="Unknown | None")
    reveal_type(y, expected_text="Unknown | None")
    reveal_type(z, expected_text="Unknown | None")

    # These should generate errors because the values may be None.
    x.attribute
    y.attribute
    z.attribute


def func2(x: Missing | str, y: str | Missing, z: Missing | str | None):
    reveal_type(x, expected_text="Unknown | str")
    reveal_type(y, expected_text="str | Unknown")
    reveal_type(z, expected_text="Unknown | str | None")

    # These should generate errors because str has no such attribute.
    x.nonexistent
    y.nonexistent

    # This should generate two errors, one for str and one for None.
    z.nonexistent


T = TypeVar("T")


def func3(f: Callable[[], Missing[T] | T]) -> Missing[T]:
    reveal_type(f, expected_text="() -> (Unknown | T@func3)")
    result: T | Missing[T] | Failure
    result = f()
    return result


def func4(a: Any, b: Any, c, d):
    reveal_type(a | b, expected_text="Any")
    reveal_type(c | d, expected_text="Unknown")


def func5(a: set[int], b: set[int], c: int, d: int):
    reveal_type(a | b, expected_text="set[int]")
    reveal_type(c | d, expected_text="int")
