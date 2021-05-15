# This sample tests the type engine's narrowing logic for
# callable expressions.

from typing import Callable, Optional, Type, TypeVar, Union


class CallableObj:
    def __call__(self, val: int):
        return 3


def f(a: int) -> Union[Callable[[int], int], Type[int], CallableObj, int]:
    if a == 0:

        def h(b: int):
            return 3

        return h
    elif a < 40:
        return 2
    else:
        return int


q = f(45)
if callable(q):
    w = q(3)

if not callable(q):
    a = q + 3


def g(a: Optional[Callable[[int], int]]):
    if callable(a):
        a(3)


T = TypeVar("T")


def test(arg: Union[T, Callable[[], T]]) -> T:
    if callable(arg):
        return arg()
    return arg
