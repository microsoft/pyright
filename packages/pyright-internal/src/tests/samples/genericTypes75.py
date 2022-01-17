# This sample tests the handling of a generic class whose implementation
# allocates an instance of itself by invoking a constructor and passing
# an argument that is a generic type.

from typing import Generic, TypeVar

T = TypeVar("T")


class A(Generic[T]):
    def __init__(self, x: T):
        self.x = x

    def a(self) -> "A[T]":
        x = self.x
        reveal_type(x, expected_text="T@A")
        t = (x,)
        reveal_type(t, expected_text="tuple[T@A]")
        a = A(t[0])
        reveal_type(a, expected_text="A[T@A]")
        return a


class B(Generic[T]):
    def __init__(self, thing: T):
        pass

    @staticmethod
    def method1(val: T) -> B[T]:
        # This should generate an error.
        return B(0)
