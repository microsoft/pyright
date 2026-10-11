# This tests error reporting for the use of data protocols in an
# issubclass call.

from typing import Any, Callable, Protocol, TypeVar, runtime_checkable

# > isinstance() can be used with both data and non-data protocols, while
# > issubclass() can be used only with non-data protocols.

F = TypeVar("F", bound=Callable[..., object])


class decorators:
    @staticmethod
    def property(func: F) -> F:
        return func


@runtime_checkable
class DataProtocol(Protocol):
    name: str

    def method1(self) -> int: ...


@runtime_checkable
class DataProtocol2(DataProtocol, Protocol):
    def method2(self) -> int: ...


@runtime_checkable
class NonDataProtocol(Protocol):
    def method1(self) -> int: ...


@runtime_checkable
class SlotsProtocol(Protocol):
    __slots__ = ()

    def method1(self) -> int: ...


@runtime_checkable
class SlotsDataProtocol(Protocol):
    __slots__ = ()

    @property
    def value(self) -> int: ...


@runtime_checkable
class DecoratedMethodProtocol(Protocol):
    # A qualified user-defined decorator named "property" is still a method.
    @decorators.property
    def method1(self) -> int: ...


def func2(a: Any):
    if isinstance(a, DataProtocol):
        return

    if isinstance(a, NonDataProtocol):
        return

    # This should generate an error because data protocols
    # are not allowed with issubclass checks.
    if issubclass(a, (DataProtocol, NonDataProtocol)):
        return

    # This should generate an error because data protocols
    # are not allowed with issubclass checks.
    if issubclass(a, (DataProtocol2, NonDataProtocol)):
        return

    if issubclass(a, NonDataProtocol):
        return

    # A __slots__ declaration is not a protocol data member.
    if issubclass(a, SlotsProtocol):
        return

    if issubclass(a, DecoratedMethodProtocol):
        return

    # This should generate an error because properties are data members.
    if issubclass(a, SlotsDataProtocol):
        return
