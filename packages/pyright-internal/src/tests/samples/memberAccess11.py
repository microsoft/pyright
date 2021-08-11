# This sample tests that methods are bound properly regardless of
# whether they are decorated.

from typing import Callable

UnboundMethodThatTakesIntAndReturnsStr = Callable[["MyClass", int], str]


def method_decorator(
    method: UnboundMethodThatTakesIntAndReturnsStr,
) -> UnboundMethodThatTakesIntAndReturnsStr:
    def wrapper(self: "MyClass", a: int) -> str:
        return "wrapped " + method(self, a)

    return wrapper


class MyClass:
    def __init__(self):
        self.method4 = lambda x: x

    @method_decorator
    def method1(self, a: int) -> str:
        return "foo"

    def method2(self, a: int) -> str:
        return "foo"

    method3 = method_decorator(method2)


mc = MyClass()

mc.method1(1)
mc.method2(1)
mc.method3(1)
mc.method4(1)
