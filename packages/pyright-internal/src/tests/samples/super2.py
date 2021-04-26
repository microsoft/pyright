# This sample tests the handling of the "super" call when
# used with a two-argument form that specifies the "bind to" type.

from typing import Literal, Type, TypeVar


T = TypeVar("T", bound="A")


class A:
    @classmethod
    def factory(cls: Type[T]) -> T:
        return cls()


class B(A):
    @classmethod
    def factoryB(cls):
        return super(B, cls).factory()


a1 = A.factory()
type_a1: Literal["A"] = reveal_type(a1)

b1 = B.factory()
type_b1: Literal["B"] = reveal_type(b1)

b2 = B.factoryB()
type_b2: Literal["B"] = reveal_type(b2)
