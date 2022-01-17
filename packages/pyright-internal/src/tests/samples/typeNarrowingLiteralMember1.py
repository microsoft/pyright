# This sample tests type narrowing based on member accesses
# to members that have literal types.

from typing import ClassVar, Literal, Type, Union


class A:
    kind: Literal["A"]
    kind_class: ClassVar[Literal["A"]]
    d: Literal[1, 2, 3]
    is_a: Literal[True]


class B:
    kind: Literal["B"]
    kind_class: ClassVar[Literal["B"]]
    d: Literal[3, 4, 5]
    is_a: Literal[False]


class C:
    kind: str
    kind_class: str
    c: int
    is_a: bool


class D:
    kind: Literal[1, 2, 3]


def eq_obj1(c: Union[A, B]):
    if c.kind == "A":
        reveal_type(c, expected_text="A")
    else:
        reveal_type(c, expected_text="B")


def is_obj1_1(c: Union[A, B]):
    if c.kind is "A":
        reveal_type(c, expected_text="A | B")
    else:
        reveal_type(c, expected_text="A | B")


def is_obj1_2(c: Union[A, B]):
    if c.is_a is False:
        reveal_type(c, expected_text="B")
    else:
        reveal_type(c, expected_text="A")


def eq_obj2(c: Union[A, B]):
    if c.kind != "A":
        reveal_type(c, expected_text="B")
    else:
        reveal_type(c, expected_text="A")


def is_obj2(c: Union[A, B]):
    if c.kind is not "A":
        reveal_type(c, expected_text="A | B")
    else:
        reveal_type(c, expected_text="A | B")


def eq_obj3(c: Union[A, B, C]):
    if c.kind == "A":
        reveal_type(c, expected_text="A | C")
    else:
        reveal_type(c, expected_text="B | C")


def is_obj3(c: Union[A, B, C]):
    if c.kind is "A":
        reveal_type(c, expected_text="A | B | C")
    else:
        reveal_type(c, expected_text="A | B | C")


def eq_obj4(c: Union[A, B]):
    if c.d == 1:
        reveal_type(c, expected_text="A")
    elif c.d == 3:
        reveal_type(c, expected_text="A | B")


def is_obj4(c: Union[A, B]):
    if c.d is 1:
        reveal_type(c, expected_text="A | B")
    elif c.d is 3:
        reveal_type(c, expected_text="A | B")


def eq_obj5(d: D):
    if d.kind == 1:
        reveal_type(d, expected_text="D")
    elif d.kind == 2:
        reveal_type(d, expected_text="D")


def is_obj5(d: D):
    if d.kind is 1:
        reveal_type(d, expected_text="D")
    elif d.kind is 2:
        reveal_type(d, expected_text="D")


def eq_class2(c: Union[Type[A], Type[B]]):
    if c.kind_class == "A":
        reveal_type(c, expected_text="Type[A]")
    else:
        reveal_type(c, expected_text="Type[B]")


def is_class2(c: Union[Type[A], Type[B]]):
    if c.kind_class is "A":
        reveal_type(c, expected_text="Type[A] | Type[B]")
    else:
        reveal_type(c, expected_text="Type[A] | Type[B]")
