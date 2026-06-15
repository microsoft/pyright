# This sample tests that overriding a class-level callable variable
# (which is not a method) with a method in a subclass is allowed. When
# the base member is a plain callable attribute rather than a method,
# the override method's "self" parameter is bound when accessed on an
# instance, so the signatures are compatible.

from collections.abc import Callable
from typing import override


class A:
    hello: Callable[[], None] = lambda: print("hello")

    cb: Callable[[int], None] = lambda x: print(x)


class B(A):
    @override
    def hello(self) -> None:
        print("hi")

    @override
    def cb(self, value: int) -> None:
        print(value)


class C(A):
    # This should generate an error because the bound override signature
    # is incompatible with the base callable variable.
    @override
    def hello(self, extra: int) -> None:
        print("hi")
