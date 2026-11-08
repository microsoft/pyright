# This sample tests inference from specialized __init__ self annotations
# through generic aliases with nested type arguments.

from typing import Generic, TypeAlias, TypeVar, assert_type

T = TypeVar("T")
U = TypeVar("U")


class Box(Generic[T]):
    def __init__(self: "Box[list[int]]", value: int) -> None: ...

    def get(self) -> T:
        raise NotImplementedError


Alias: TypeAlias = Box[list[U]]

assert_type(Alias(1).get(), list[int])
assert_type(Alias(1).get()[0], int)
assert_type(Box(1).get(), list[int])
assert_type(Alias[int](1).get(), list[int])

# This should generate an error because inference retains the element type.
Alias(1).get().append("wrong")


class PairBox(Generic[T]):
    def __init__(self: "PairBox[tuple[int, str]]", value: int) -> None: ...

    def get(self) -> T:
        raise NotImplementedError


IntPair: TypeAlias = PairBox[tuple[int, U]]
TextPair: TypeAlias = PairBox[tuple[U, str]]

assert_type(IntPair(1).get(), tuple[int, str])
assert_type(TextPair(1).get(), tuple[int, str])


class FactoryBox(Generic[T]):
    def __new__(cls, value: int) -> "ChildBox[int]":
        return object.__new__(ChildBox)


class ChildBox(FactoryBox[T]):
    def __init__(self, value: int) -> None:
        pass


FactoryAlias: TypeAlias = FactoryBox[U]

# The alias must not replace a different class returned by __new__.
assert_type(FactoryAlias(1), ChildBox[int])
