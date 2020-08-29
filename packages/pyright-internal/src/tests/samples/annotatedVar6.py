# This sample tests that class-scoped variables with a declared type
# but without a ClassVar designation are treated as instance variables.
# Notably, Callable variables should be assumed to be pre-bound to
# the object.

from typing import Callable


def add1(n: int):
    return n + 1


class Foo:
    f: Callable[[int], int]

    def m(self):
        print(self.f(1))


foo = Foo()
foo.f = add1
foo.m()
