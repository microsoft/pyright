# This sample tests the functools.partial support for keyword parameters.

from functools import partial
from typing import Protocol


def func1(a: int, b: int, x: str) -> str:
    return x


class Proto1(Protocol):
    def __call__(self, x: str) -> str: ...


func2: Proto1 = partial(func1, 3, 4, x="a")
func2()
func2(x="b")


class Proto2(Protocol):
    def __call__(self, b: int) -> str: ...


func3: Proto2 = partial(func1, 3, b=3, x="a")
func3()
func3(x="b")
func3(b=3)
func3(x="b", b=3)
func3(b=3, x="b")
