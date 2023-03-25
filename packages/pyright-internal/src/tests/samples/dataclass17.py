# This sample tests the "slots" parameter for dataclasses introduced
# in Python 3.10.

from dataclasses import dataclass


# This should generate an error because __slots__ is already defined.
@dataclass(slots=True)
class A:
    x: int

    __slots__ = ()


@dataclass(slots=True)
class B:
    x: int

    def __init__(self):
        self.x = 3

        # This should generate an error because "y" is not in slots.
        self.y = 3


@dataclass(slots=False)
class C:
    x: int

    __slots__ = ("x",)

    def __init__(self):
        self.x = 3

        # This should generate an error because "y" is not in slots.
        self.y = 3


@dataclass
class D:
    __slots__ = ("y", "x")
    x: int
    y: str


D(1, "bar")


@dataclass(slots=True)
class E:
    a: int


E.__slots__
E(1).__slots__

reveal_type(E.__slots__, expected_text="Iterable[str]")


@dataclass
class F:
    a: int


# This should generate an error.
F.__slots__

# This should generate an error.
F(1).__slots__
