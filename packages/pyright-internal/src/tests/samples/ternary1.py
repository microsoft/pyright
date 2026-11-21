# This sample tests the type of a ternary expression whose condition
# is always truthy or always falsy.

from typing import Callable, assert_type


def func1(f: Callable[[], None], a: int, b: str) -> None:
    assert_type(a if f else b, int)


def func2(n: None, a: int, b: str) -> None:
    assert_type(a if n else b, str)


def func3(flag: bool, a: int, b: str) -> None:
    assert_type(a if flag else b, int | str)
