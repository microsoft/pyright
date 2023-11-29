# This sample tests that methods are bound properly regardless of
# whether they are decorated.

from typing import Callable, TypeVar

S = TypeVar("S", bound="MyClass")

Callback = Callable[[S, int], str]


def decorator1(method: Callback[S]) -> Callback[S]:
    def wrapper(self: S, a: int) -> str:
        return "wrapped " + method(self, a)

    return wrapper


class MyClass:
    def __init__(self):
        self.method4 = lambda x: x

    @decorator1
    def method1(self, a: int) -> str:
        return "foo"

    def method2(self, a: int) -> str:
        return "foo"

    method3 = decorator1(method2)


mc = MyClass()

mc.method1(1)
mc.method2(1)
mc.method3(1)
mc.method4(1)
