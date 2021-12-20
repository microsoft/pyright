# This sample tests the handling of a generic class whose implementation
# allocates an instance of itself by invoking a constructor and passing
# an argument that is a generic type.

from typing import Generic, Literal, TypeVar

T = TypeVar("T")


class A(Generic[T]):
    def __init__(self, x: T):
        self.x = x

    def a(self) -> "A[T]":
        x = self.x
        t1: Literal["T@A"] = reveal_type(x)
        t = (x,)
        t2: Literal["tuple[T@A]"] = reveal_type(t)
        a = A(t[0])
        t3: Literal["A[T@A]"] = reveal_type(a)
        return a


class B(Generic[T]):
    def __init__(self, thing: T):
        pass

    @staticmethod
    def method1(val: T) -> B[T]:
        # This should generate an error.
        return B(0)
