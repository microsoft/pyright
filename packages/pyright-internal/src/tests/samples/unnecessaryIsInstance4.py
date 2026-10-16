# This sample tests unnecessary issubclass diagnostics for ABCs and protocols.

from abc import ABC
from typing import Protocol, final, runtime_checkable


class Base(ABC):
    pass


@runtime_checkable
class SupportsRun(Protocol):
    def run(self) -> None: ...


@final
class RejectingABC(ABC):
    @classmethod
    def __subclasshook__(cls, subclass: type) -> bool:
        return False


def test_abc(cls: type[Base]):
    # This should generate an error if reportUnnecessaryIsInstance is true.
    issubclass(cls, Base)


def test_protocol(cls: type[SupportsRun]):
    # This should generate an error if reportUnnecessaryIsInstance is true.
    issubclass(cls, SupportsRun)


def test_final_abc(cls: type[RejectingABC], other: type[RejectingABC]) -> int:
    issubclass(cls, RejectingABC)
    if not issubclass(cls, other):
        reveal_type(cls, expected_text="type[RejectingABC]")
        # This should generate an error because __subclasshook__ can return False.
        return cls
    return 0
