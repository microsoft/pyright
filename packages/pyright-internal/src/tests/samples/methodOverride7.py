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


from typing import overload


class F(A):
    # This should generate an error because the bound override is an
    # overloaded method whose first real parameter type (str) is incompatible
    # with the base callable's parameter type (int). The static normalization
    # of each bound overload ensures the first parameter is not skipped as
    # "self".
    @overload
    def cb(self, value: str) -> None: ...
    @overload
    def cb(self, value: str, extra: int) -> None: ...
    @override
    def cb(self, value: str, extra: int = 0) -> None:
        print(value)


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


# Parametered diamond: one base supplies a callable variable with a parameter
# and a sibling base supplies a method with a matching parameter. This is the
# load-bearing case for the multiple-inheritance bind-before-compare handling:
# without binding the method's "self", the comparison would see an extra
# positional parameter and emit a spurious error. Both inheritance orders are
# exercised and should produce no error.


class CallableVarBase:
    cb: Callable[[int], None] = lambda x: print(x)


class MethodBase:
    def cb(self, value: int) -> None:
        print(value)


class DiamondParamVM(CallableVarBase, MethodBase):
    pass


class DiamondParamMV(MethodBase, CallableVarBase):
    pass
