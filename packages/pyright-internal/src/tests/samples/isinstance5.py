# This tests error reporting for the use of data protocols in an
# issubclass call.

from typing import Any, Protocol, runtime_checkable

# > isinstance() can be used with both data and non-data protocols, while
# > issubclass() can be used only with non-data protocols.


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
