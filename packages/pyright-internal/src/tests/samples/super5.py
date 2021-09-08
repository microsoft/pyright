# This sample tests the case where super() is called from a class or
# instance method where the cls or self parameter is explicitly
# annotated.

from typing import TypeVar, Type

A_T = TypeVar("A_T", bound="A")


class A:
    @classmethod
    def construct(cls: Type[A_T]) -> A_T:
        return cls()

    def construct2(self: A_T) -> A_T:
        return type(self)()


B_T = TypeVar("B_T", bound="B")


class B(A):
    @classmethod
    def construct(cls: Type[B_T]) -> B_T:
        return super().construct()

    def construct2(self: B_T) -> B_T:
        return super().construct2()
