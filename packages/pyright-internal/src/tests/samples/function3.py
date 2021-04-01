# This sample tests the Python 3.8 "positional-only parameter" feature.

from typing import Any


def f0(a: int, b: int):
    return 3


def f1(a: int, b: int, /):
    return 3

# This should generate an error because only one
# '/' parameter is allowed.
def f2(a: int, /, b: int, /):
    return 3

def f3(a: int, /, b: int):
    return 3

def f4(a: int, /, b: int, *, c: int):
    return 3

# This should generate an error because a '/'
# parameter shouldn't appear after '*'.
def f5(a: int, *, b: int, /, c: int):
    return 3

# This should generate an error because a '/'
# parameter cannot be the first in a param list.
def f6(/, a: int, *, b: int):
    return 3


f0(2, 3)

f1(2, 3)

# This should generate 1 error because b
# is a position-only parameter.
f1(2, b=3)

# This should generate 2 errors because a and b
# are position-only parameters.
f1(a=2, b=3)

f2(2, 3)

# This should generate an error.
f2(a=2, b=3)

f3(2, 3)
f3(2, b=3)

# This should generate 1 error because a is a
# position-only parameter.
f3(a=2, b=3)

f4(1, 2, c=3)
f4(1, b=2, c=3)

# This should generate an error because c is a
# name-only parameter.
f4(1, 2, 3)

# This should generate an error because a is a
# positional-only parameter.
f4(a=1, b=2, c=3)

# This will generate 2 errors because of the bad
# declaration. Test to make sure we don't crash.
f5(1, b=2, c=3)

f6(1, b=2)
f6(a=1, b=2)

class A:
    def f(self, g: bool = False, /, **kwargs) -> None:
        ...

a = A()

a.f(hello="world")


def f7(name: str, /, **kwargs: Any):
    return 3

f7("hi", name=3)

# This should generate an error
f7("hi", name=3, name=4)
