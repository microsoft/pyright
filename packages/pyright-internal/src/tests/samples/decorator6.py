# This sample tests that function decorators can be combined with
# staticmethod or classmethod.

from typing import Callable, TypeVar
import functools

_T = TypeVar("_T")


def decorator1(func: Callable[[_T, str], None]) -> Callable[[_T, str], None]:
    @functools.wraps(func)
    def func_wrapper(param1: _T, param2: str) -> None:
        return func(param1, param2)

    return func_wrapper


class ClassA:
    def __init__(self):
        self.test1(1, "a")
        self.test2("hi")

    @staticmethod
    @decorator1
    def test1(param1: int, param2: str) -> None:
        print(param2)

    @classmethod
    @decorator1
    def test2(cls, param2: str) -> None:
        print(param2)


ClassA()
