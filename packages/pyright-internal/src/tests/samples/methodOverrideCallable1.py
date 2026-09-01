# This sample tests overriding a Callable class attribute with an instance method.

from collections.abc import Callable
from typing import override


class A:
    hello: Callable[[], None] = lambda: print("hello")


class B(A):
    @override
    def hello(self) -> None:
        print("hi")


b = B()
b.hello()
