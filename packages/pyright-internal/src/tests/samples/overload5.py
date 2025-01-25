# This sample tests for proper usage of @final and @override within
# an overload definition.

from typing import Any, Protocol, final, overload, override


class ABase:
    def method2(self, x: int | str) -> int | str: ...


class A(ABase):
    @final
    @overload
    # This should generate an error.
    def method1(self, x: int) -> int: ...

    @final
    @overload
    # This should generate an error.
    def method1(self, x: str) -> str: ...

    @final
    def method1(self, x: int | str) -> int | str: ...

    @override
    @overload
    # This should generate an error.
    def method2(self, x: int) -> int: ...

    @override
    @overload
    # This should generate an error.
    def method2(self, x: str) -> str: ...

    @override
    def method2(self, x: int | str) -> int | str: ...


class BBase(Protocol):
    def method2(self, x: Any) -> Any: ...


class B(BBase, Protocol):
    @final
    @overload
    def method1(self, x: int) -> int: ...

    @final
    @overload
    # This should generate an error.
    def method1(self, x: str) -> str: ...

    @override
    @overload
    def method2(self, x: int) -> int: ...

    @override
    @overload
    # This should generate an error.
    def method2(self, x: str) -> str: ...
