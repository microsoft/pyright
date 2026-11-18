# This sample tests that a PEP 695 generic type alias whose value is a
# bare type parameter (an "identity" alias) can be used in the declared
# type of an instance variable that is assigned within a method, and in
# the declared type of a local variable within a method or function. The
# alias's own type parameter is scoped to the alias, so a reference to the
# alias must not be treated as a use of a method-scoped or class-scoped
# type variable, even if a type parameter has the same name.
#
# "Annotated[T, ...]" hits the same case: unlike "T | None" or "list[T]",
# Annotated is transparent to the type checker, so the alias's value is
# still, at its outermost level, the bare type parameter itself.

from typing import Annotated

type Identity[T] = T
type Tagged[T] = Annotated[T, "meta"]
type Wrapper[T] = list[T]


class ClassA:
    def __init__(self) -> None:
        self.a: Identity[int] = 0
        self.b: Identity[list[int]] = []
        self.c: Wrapper[int] = []
        self.d: Tagged[int] = 0


reveal_type(ClassA().a, expected_text="int")
reveal_type(ClassA().b, expected_text="list[int]")
reveal_type(ClassA().c, expected_text="list[int]")
reveal_type(ClassA().d, expected_text="int")


class ClassB[T]:
    # The type parameter of the class has the same name as the type
    # parameter of the alias. They are distinct type variables.
    def __init__(self, x: T) -> None:
        self.a: Identity[T] = x
        self.b: Identity[list[T]] = [x]
        self.c: Tagged[T] = x

        loc: Identity[T] = x
        reveal_type(loc, expected_text="T@ClassB")

        loc2: Tagged[T] = x
        reveal_type(loc2, expected_text="T@ClassB")


reveal_type(ClassB(1).a, expected_text="int")
reveal_type(ClassB(1).b, expected_text="list[int]")
reveal_type(ClassB(1).c, expected_text="int")


def func1[T](v: T) -> T:
    # The type parameter of the function has the same name as the type
    # parameter of the alias. They are distinct type variables.
    loc: Identity[T] = v
    reveal_type(loc, expected_text="T@func1")
    return loc


class ClassC:
    def method[U](self, x: U) -> U:
        # This should generate an error because U is scoped to the method.
        self.a: Identity[U] = x

        # This should generate an error because U is scoped to the method.
        self.b: Wrapper[U] = [x]

        # This should generate an error because U is scoped to the method.
        self.c: Tagged[U] = x

        return x
