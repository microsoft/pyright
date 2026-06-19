# This sample tests that overriding a class-level callable variable
# (which is not a method) with a method in a subclass is allowed. When
# the base member is a plain callable attribute rather than a method,
# the override method's "self" parameter is bound when accessed on an
# instance, so the signatures are compared as plain (bound) callables.

from collections.abc import Callable
from typing import override


class A:
    hello: Callable[[], None] = lambda: print("hello")

    cb: Callable[[int], None] = lambda x: print(x)

    ret: Callable[[], int] = lambda: 0


class B(A):
    @override
    def hello(self) -> None:
        print("hi")

    @override
    def cb(self, value: int) -> None:
        print(value)

    @override
    def ret(self) -> int:
        return 0


class C(A):
    # This should generate an error because the bound override adds a
    # required positional parameter (arity mismatch).
    @override
    def hello(self, extra: int) -> None:
        print("hi")


class D(A):
    # This should generate an error because the bound override's first
    # real parameter type (str) is incompatible with the base callable's
    # parameter type (int).
    @override
    def cb(self, value: str) -> None:
        print(value)


class E(A):
    # This should generate an error because the bound override's return
    # type (str) is incompatible with the base callable's return type (int).
    @override
    def ret(self) -> str:
        return ""


# The following classes verify that inheriting a callable variable and a
# real method with the same name from two different base classes (a "diamond"
# of sorts) does not produce a spurious reportIncompatibleMethodOverride. Both
# inheritance orders are exercised.


class Mixin:
    def hello(self) -> None: ...


class DiamondAB(A, Mixin):
    pass


class DiamondBA(Mixin, A):
    pass
