# This sample tests that generic type aliases are properly flagged as
# partially-unknown types if their type arguments are omitted.

# pyright: reportUnknownParameterType=true, reportMissingTypeArgument=false

from typing import Dict, List, TypeVar

T = TypeVar("T")
Foo = List[T]


# This should generate an error because Foo is missing a type argument,
# so the type of `f` is partially unknown.
def foo1(f: Foo) -> None:
    pass


Bar = Foo


# This should generate an error because Bar doesn't specialize
# Foo appropriately.
def foo2(f: Bar) -> None:
    pass


K = TypeVar("K")
V = TypeVar("V")

Baz = Dict[K, V]


# This should generate an error because Baz is only partially specialized.
def foo3(f: Baz[int]) -> None:
    pass
