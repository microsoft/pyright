# This sample tests the Python 3.8 "positional-only parameter" feature.

from typing import Any, Dict, Protocol, Tuple


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

# This should generate an error because b
# is a position-only parameter.
f1(2, b=3)

# This should generate an error because a and b
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
# keyword-only parameter.
f4(1, 2, 3)

# This should generate an error because a is a
# positional-only parameter.
f4(a=1, b=2, c=3)

# This will an error because of the bad
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


class P1(Protocol):
    def f(self, x: Any, /):
        ...


class C1:
    def f(
        self,
        y: Any,
    ):
        ...


c1: P1 = C1()


class P2(Protocol):
    def f(self, x: Any):
        ...


class C2:
    def f(self, y: Any, /):
        ...


# This should generate an error
c2: P2 = C2()


def f8(a: int, b: int = 3, /):
    ...


kwargs: Dict[str, Any] = {}

# This should generate an error
f8()

# This should generate an error
f8(**kwargs)


f8(0, **kwargs)

def f9(*, c: int):
    pass

# This should generate an error because it is missing a keyword
# argument for keyword parameter "c".
f9(*[1, 2, 3])


# This should generate an error because "/" cannot be used after "*args"
def f10(x, *args, /, y):
    pass

# This should generate an error because "*" cannot be used after "*args"
def f11(x, *args, *, y):
    pass

def f15(x, /, *args):
    pass

# This should generate an error because x
# is a position-only parameter.
f15(x=1)

def f16(x, /, *args, **kw):
    pass

# This should generate an error because x
# is a position-only parameter.
f16(x=1)

def f12(a: int, b: str, /):
    ...


def f13(v: Tuple[int, str]):
    f12(*v)

def f14(v: Tuple[int]):
    # This should generate an error because parameter "b" has
    # no corresponding argument.
    f12(*v)
