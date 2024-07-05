# This sample tests the handling of circular dependencies between
# class declarations.

# pyright: strict

from typing import Generic, TypeVar

x: "F"


class A:
    a_attr: object


_T = TypeVar("_T", bound=A)


class B(Generic[_T]): ...


class C(A):
    template = B["E"]()


class D(A):
    pass


class E(D):
    pass


class F(D):
    pass


E.a_attr
