# This sample tests the case where a generic class constructor doesn't
# allow for the solving of a class-scoped type variable. In this case,
# the type argument should be Unknown.

from typing import Generic, TypeVar

T = TypeVar("T")


class A(Generic[T]):
    def __new__(cls, *args, **kwargs):
        return super().__new__(cls, *args, **kwargs)


class B(Generic[T]):
    def __init__(self): ...


class C(Generic[T]):
    def __new__(cls, *args, **kwargs):
        return super().__new__(cls, *args, **kwargs)

    def __init__(self): ...


class D(Generic[T]):
    def __new__(cls, *args, **kwargs):
        return super().__new__(cls, *args, **kwargs)

    def __init__(self, a: T): ...


class E(Generic[T]):
    pass


a = A(1)
reveal_type(a, expected_text="A[Unknown]")

b = B()
reveal_type(b, expected_text="B[Unknown]")

c = C()
reveal_type(c, expected_text="C[Unknown]")

d = D(1)
reveal_type(d, expected_text="D[int]")

e = E()
reveal_type(e, expected_text="E[Unknown]")
