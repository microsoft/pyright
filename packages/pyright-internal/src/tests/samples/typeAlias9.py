# This sample tests that generic type aliases are properly flagged as
# partially-unknown types if their type arguments are omitted.

# pyright: reportUnknownParameterType=true, reportMissingTypeArgument=false

from typing import TypeVar

T = TypeVar("T")
TA1 = list[T]


# This should generate an error because Foo is missing a type argument,
# so the type of `f` is partially unknown.
def func1(f: TA1) -> None:
    pass


TA2 = TA1


# This should generate an error because Bar doesn't specialize
# Foo appropriately.
def func2(f: TA2) -> None:
    pass


K = TypeVar("K")
V = TypeVar("V")

TA3 = dict[K, V]


# This should generate two errors because Baz is only partially specialized.
def func3(f: TA3[int]) -> None:
    pass
