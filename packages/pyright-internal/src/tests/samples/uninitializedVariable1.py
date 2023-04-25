# This sample tests the reportUninitializedInstanceVariable functionality.

from abc import ABC
from dataclasses import dataclass
from typing import Protocol, TypedDict, final


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


# Protocol classes are exempt.
class D(Protocol):
    x: str
    y: str


# ABCs are exempt.
class E(ABC):
    x: str
    y: str


# Unless they are final.
@final
class ESub(E):
    z: str
