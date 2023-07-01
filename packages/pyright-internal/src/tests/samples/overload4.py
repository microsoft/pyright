# This sample verifies that a lone overload is reported
# as an error.

from typing import Protocol, overload


# This should generate an error because there is only one overload.
@overload
def func1() -> None:
    ...


def func1() -> None:
    ...


# This should generate an error because there is only one overload.
@overload
def func2(a: int) -> None:
    ...


def func2(a: int) -> None:
    pass


class ClassA:
    # This should generate an error because there is no implementation.
    @overload
    def func3(self) -> None:
        ...

    @overload
    def func3(self, a: int) -> None:
        ...


class ClassB(Protocol):
    # An implementation should not be required in a protocol class.
    @overload
    def func4(self) -> None:
        ...

    @overload
    def func4(self, name: str) -> str:
        ...
