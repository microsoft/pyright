# This sample tests the case where a base class method is overridden
# in a derived class with an overloaded method.

# pyright: reportIncompatibleMethodOverride=true

from typing import overload


class Base1:
    def foo(self, x: int) -> int:
        return x


class Derived1(Base1):
    @overload
    def foo(self, x: int) -> int: ...

    @overload
    def foo(self, x: str) -> str: ...

    def foo(self, x: int | str) -> int | str:
        return x


class Base2:
    def foo(self, x: int | str) -> int | str:
        return x


class Derived2(Base2):
    @overload
    def foo(self, x: int) -> int: ...

    @overload
    def foo(self, x: str) -> str: ...

    def foo(self, x: int | str) -> int | str:
        return x


class Base3:
    def foo(self, x: int) -> int:
        return x


class Derived3(Base3):
    @overload
    def foo(self, x: float) -> float: ...

    @overload
    def foo(self, x: str) -> str: ...

    # This should generate an error because no overloaded signature
    # is compatible with the base method, nor is the implementation.
    def foo(self, x: int | str | float) -> int | str | float:
        return x
