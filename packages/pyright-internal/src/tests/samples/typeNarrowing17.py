# This sample tests type narrowing based on member accesses
# to members that have literal types.

from typing import ClassVar, Literal, Type, Union


class A:
    kind: Literal["A"]
    kind_class: ClassVar[Literal["A"]]
    d: Literal[1, 2, 3]


class B:
    kind: Literal["B"]
    kind_class: ClassVar[Literal["B"]]
    d: Literal[3, 4, 5]


class C:
    kind: str
    kind_class: str
    c: int


class D:
    kind: Literal[1, 2, 3]


def foo_obj1(c: Union[A, B]):
    if c.kind == "A":
        tc1: Literal["A"] = reveal_type(c)
    else:
        tc2: Literal["B"] = reveal_type(c)


def foo_obj2(c: Union[A, B]):
    if c.kind != "A":
        tc1: Literal["B"] = reveal_type(c)
    else:
        tc2: Literal["A"] = reveal_type(c)


def foo_obj3(c: Union[A, B, C]):
    if c.kind == "A":
        tc1: Literal["A | B | C"] = reveal_type(c)
    else:
        tc2: Literal["A | B | C"] = reveal_type(c)


def foo_obj4(c: Union[A, B]):
    if c.d == 1:
        tc1: Literal["A"] = reveal_type(c)
    elif c.d == 3:
        tc2: Literal["A | B"] = reveal_type(c)


def foo_obj5(d: D):
    if d.kind == 1:
        td1: Literal["D"] = reveal_type(d)
    elif d.kind == 2:
        td2: Literal["D"] = reveal_type(d)


def foo_class2(c: Union[Type[A], Type[B]]):
    if c.kind_class == "A":
        tc1: Literal["Type[A]"] = reveal_type(c)
    else:
        tc2: Literal["Type[B]"] = reveal_type(c)
