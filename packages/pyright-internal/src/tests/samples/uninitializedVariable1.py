# This sample tests the reportUninitializedInstanceVariable functionality.

from dataclasses import dataclass
from typing import Protocol, TypedDict


class A:
    # This should generate an error if reportUninitializedInstanceVariable
    # is enabled.
    v1: int
    v2: int
    v3 = 2
    v4: int = 3

    def __init__(self) -> None:
        self.v2 = 3
        super().__init__()


@dataclass
class B:
    x: int


class C(TypedDict):
    member1: str
    member2: str


# Protocol classes are exempt
class D(Protocol):
    x: str
    y: str
