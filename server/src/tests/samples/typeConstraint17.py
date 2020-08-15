# This sample tests type narrowing based on member accesses
# to members that have literal types.

from typing import ClassVar, Literal, Type, Union


class A:
    kind: Literal["A"]
    kind_class: ClassVar[Literal["A"]]
    a: str


class B:
    kind: Literal["B"]
    kind_class: ClassVar[Literal["B"]]
    b: int


class C:
    kind: str
    kind_class: str
    c: int


def foo_obj1(c: Union[A, B]):
    if c.kind == "A":
        c.a

        # This should generate an error
        c.b
    else:
        c.b

        # This should generate an error
        c.a


def foo_obj2(c: Union[A, B]):
    if c.kind != "A":
        # This should generate an error
        c.a
        c.b
    else:
        # This should generate an error
        c.b
        c.a


def foo_obj3(c: Union[A, B, C]):
    if c.kind == "A":
        # This should generate an error
        c.a
    else:
        # This should generate an error
        c.a


def foo_class2(c: Union[Type[A], Type[B]]):
    if c.kind_class == "A":
        c.a

        # This should generate an error
        c.b
    else:
        c.b

        # This should generate an error
        c.a
