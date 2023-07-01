# This sample verifies that callable variables are bound
# to instances when they appear within most classes, but
# not within TypedDict or data classes.

from typing import Callable, NamedTuple, TypedDict


# This class follows the normal rules where variable
# b, which is callable, acts like a class member and
# is bound to an instance by the member access operator.
class Foo1:
    def __init__(self):
        self.c = lambda s: s

    def a(self, s: str):
        return s

    b = lambda a_inst, s: a_inst.inner_str + s


sample = Foo1()
a = sample.a("")
b = sample.b("")
c = sample.c("")

d = Foo1.a(Foo1(), "")
e = Foo1.b(Foo1(), "")


# This class is a data class (because it derives from
# named tuple), so all variables that appear to be class
# variables are actually instance variables.
class Foo2(NamedTuple):
    a: Callable[[int], int]


foo2 = Foo2(a=lambda a: a)
f = foo2.a(3)


class Foo3(TypedDict):
    a: Callable[[int], int]


foo3 = Foo3(a=lambda a: a)
g = foo3["a"](3)
