# This sample tests the handling of the "super" call when
# used with a two-argument form that specifies the "bind to" type.

from typing import Type, TypeVar


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
reveal_type(a1, expected_text="A")

b1 = B.factory()
reveal_type(b1, expected_text="B")

b2 = B.factoryB()
reveal_type(b2, expected_text="B")
