# This sample validates that a literal and a non-literal are not considered
# compatible types when in an invariant context.

from typing import Literal, TypeVar

T = TypeVar("T")


def func1(a: T, b: T) -> T:
    return a


def func2() -> None:
    foo_list: list[Literal["foo"]] = ["foo"]
    x = func1(foo_list, [""])
    reveal_type(x, expected_text="list[Literal['foo']] | list[str]")

    # This should generate an error.
    x.append("not foo")
    print(foo_list)
