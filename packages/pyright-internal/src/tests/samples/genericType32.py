# This sample tests the case where a invariant type parameter is used
# within a contravariant type argument.

from typing import TypeVar, Generic

T = TypeVar("T")
T_contra = TypeVar("T_contra", contravariant=True)


class Contra(Generic[T_contra]): ...


class Foo(Generic[T]): ...


class Bar(Foo[T]): ...


def func(x: Contra[Foo[int]]):
    v: Contra[Bar[int]] = x
