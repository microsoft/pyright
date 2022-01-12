# This sample tests that function decorators can be combined with
# staticmethod or classmethod.

from typing import Callable, TypeVar
import functools

_T = TypeVar("_T")


def decorator(func: Callable[[_T, str], None]) -> Callable[[_T, str], None]:
    @functools.wraps(func)
    def func_wrapper(firstarg: _T, secondarg: str) -> None:
        return func(firstarg, secondarg)

    return func_wrapper


class Test:
    def __init__(self):
        self.test1(1, "a")
        self.test2("hi")

    @staticmethod
    @decorator
    def test1(firstarg: int, secondarg: str) -> None:
        print(secondarg)

    @classmethod
    @decorator
    def test2(cls, secondarg: str) -> None:
        print(secondarg)


Test()
