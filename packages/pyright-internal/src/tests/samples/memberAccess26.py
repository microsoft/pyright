# This sample tests that type declarations for class members do not
# include method-local type variables.

from typing import TypeVar

T1 = TypeVar("T1")
T2 = TypeVar("T2")


def func(x: list[T1]):
    class ClassB:
        def __init__(self, val: list[T2]):
            # This should generate an error because T is scoped to
            # the method.
            self.a1: list[T2] = val

            self.a2: list[T1] = []

        @classmethod
        def method_b(cls, val: list[T2]):
            # This should generate an error because T is scoped to
            # the method.
            cls.b1: list[T2] = val

            cls.b2: list[T1] = []

        def method_c(self, val: list[T2]):
            # This should generate an error because T is scoped to
            # the method.
            self.c1: list[T2] = val

            self.c2: list[T1] = []

    b = ClassB([])
    reveal_type(b.a1, expected_text="list[Unknown]")
    reveal_type(b.b1, expected_text="list[Unknown]")
    reveal_type(b.c1, expected_text="list[Unknown]")

    return b
