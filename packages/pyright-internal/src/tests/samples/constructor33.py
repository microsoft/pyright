# This sample tests the case where an argument to a constructor
# uses an assignment expression (walrus operator) and the constructor
# has both a __new__ and __init__ method whose parameters have
# different bidirectional type inference contexts.

from dataclasses import dataclass
from typing import Any, Self, TypedDict


class A:
    def __new__(cls, *args: Any, **kwargs: Any) -> Self: ...
    def __init__(self, base: list[str], joined: str) -> None: ...


A(temp := ["x"], " ".join(temp))


class TD1(TypedDict):
    a: str


class TD2(TD1):
    b: str


@dataclass
class DC1[T: TD1]:
    x: T


@dataclass
class DC2[T: TD1]:
    y: list[DC1[T]]


@dataclass
class DC3[T: TD1]:
    embedded: DC2[T]


v1 = DC3[TD2](DC2(y=[DC1(x={"a": "", "b": ""})]))
