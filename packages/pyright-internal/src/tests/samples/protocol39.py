# This sample tests that functions (or any callable) conforms to
# a protocol that includes attributes defined in builtins.function.

from typing import Any, Protocol


class SupportsGet(Protocol):
    @property
    def __get__(self) -> Any:
        ...


def foo(cls: Any) -> None:
    pass


v1: SupportsGet = foo
