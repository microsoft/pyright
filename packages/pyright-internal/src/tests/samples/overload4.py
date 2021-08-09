# This sample verifies that a lone overload is reported
# as an error.

from typing import Protocol, overload


# This should generate an error because there is only one overload.
@overload
def foo1() -> None:
    ...


def foo1() -> None:
    ...


# This should generate an error because there is only one overload.
@overload
def foo2(a: int) -> None:
    ...


def foo2(a: int) -> None:
    pass


class ClassA:
    # This should generate an error because there is no implementation.
    @overload
    def foo3(self) -> None:
        ...

    @overload
    def foo3(self, a: int) -> None:
        ...


class ClassB(Protocol):
    # An implementation should not be required in a protocol class.
    @overload
    def foo(self) -> None:
        ...

    @overload
    def foo(self, name: str) -> str:
        ...
