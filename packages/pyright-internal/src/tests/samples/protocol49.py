# This sample tests the case where a protocol is matched against a
# dataclass. Dataclass fields need to act as if they are instance
# members rather than class members, which means a callable stored
# in a dataclass member should not be bound to the dataclass itself.

from dataclasses import dataclass
from typing import Callable, Protocol


class HasA(Protocol):
    @property
    def a(self) -> Callable[[int], int]: ...


@dataclass
class A:
    a: Callable[[int], int]


def func1(a: A):
    has_a: HasA = a
