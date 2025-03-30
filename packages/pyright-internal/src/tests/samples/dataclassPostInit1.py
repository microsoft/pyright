# This sample tests the __post_init__ validation logic.

# pyright: reportIncompatibleMethodOverride=false

from dataclasses import InitVar, dataclass, field
from typing import Iterable


@dataclass
class A:
    a: InitVar[int]
    b: InitVar[str]
    c: InitVar[bool]

    def __post_init__(self, x: float, y: str, z: int, xx: int = 3) -> None: ...


@dataclass
class B:
    items: list[int]

    # This should generate an error because the number of InitVars is zero.
    def __post_init__(self, x: list[int]) -> None: ...


@dataclass
class C:
    iterable: InitVar[Iterable[int]]

    items: list[int] = field(init=False)

    # This should generate an error because the number of InitVars is 1.
    def __post_init__(self) -> None: ...


@dataclass
class D:
    iterable: InitVar[Iterable[int]]

    # This should generate an error because the type is incompatible.
    def __post_init__(self, iterable: Iterable[str]) -> None: ...


@dataclass
class E:
    _name: InitVar[str] = field()
    name: str = field(init=False)

    def __post_init__(self, _name: str): ...


@dataclass
class F(E):
    _age: InitVar[int] = field()
    age: int = field(init=False)

    def __post_init__(self, _name: str, _age: int): ...
