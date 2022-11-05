# This sample tests various function type checking
# behavior including arg/param matching.

from typing import Callable

# ------------------------------------------------------
# Test function type matching


class FooBase:
    pass


class Foo(FooBase):
    pass


class Bar(Foo):
    pass


def needs_function1(callback: Callable[[Foo], Foo]):
    pass


def callback1():
    pass


def callback2(a: Foo) -> Foo:
    return Foo()


def callback3(a: Foo) -> str:
    return "1"


def callback4(a: Foo, b: Foo) -> Foo:
    return Foo()


def callback5(a: Foo, b: int = 3) -> Foo:
    return Foo()


def callback6(*a) -> Foo:
    return Foo()


def callback7(a: str) -> Foo:
    return Foo()


def callback8(a: Bar) -> Foo:
    return Foo()


def callback9(a: FooBase) -> Foo:
    return Foo()


# This should generate an error because callback1
# takes no parameters.
needs_function1(callback1)

needs_function1(callback2)

# This should generate an error because the return
# type of callback3 doesn't match.
needs_function1(callback3)

# This should generate an error because callback4
# takes too many parameters.
needs_function1(callback4)

needs_function1(callback5)
needs_function1(callback6)

# This should fail because the parameter is the
# wrong type.
needs_function1(callback7)

# This should fail because the parameter is the
# wrong type.
needs_function1(callback8)

needs_function1(callback9)


import typing

# This should generate an error because modules are not callable.
typing()
