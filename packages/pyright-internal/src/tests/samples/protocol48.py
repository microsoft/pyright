# This sample tests the handling of the Self type during protocol matching.

from typing import Protocol, Self, TypeVar

T = TypeVar("T", covariant=True)


class SupportsMethod1(Protocol[T]):
    def method1(self) -> T: ...


def apply_method1(__x: SupportsMethod1[T]) -> T: ...


class A:
    def method1(self) -> tuple[Self, Self]: ...

    def method2(self):
        x = apply_method1(self)
        reveal_type(x, expected_text="tuple[Self@A, Self@A]")


def func1(a: A):
    x = apply_method1(a)
    reveal_type(x, expected_text="tuple[A, A]")
