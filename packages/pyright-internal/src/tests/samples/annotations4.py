# This sample tests the type checker's reporting of
# incompatible declared types.

from collections.abc import Callable


def a():
    pass


# This should generate an error for an incompatible assignment.
a = 1


# This should generate an error for an obscured type.
def b():
    pass


b: int = 1

# This should generate an error for an obscured type.
c: int = 1
c: float = 1.1

# This should generate two errors - one for an
# obscured type, the second for an incompatible assignment.
d: int = 2


def d():
    pass


class Foo:
    # This should generate an error because aa is redeclared.
    aa: int

    def aa(self):
        return 3


# This should generate two errors, one for each param.
def my_func(param1: int, param2):
    param1: int = 3
    param2: int = 4


# This should be fine because both declarations of 'e'
# use the same type.
e: list[int]
e = [3]
e: list[int]


def register(fn: Callable[[], None]) -> None: ...


# These should be be fine because they use the "_" name.
@register
def _():
    print("Callback 1 called")


@register
def _():
    print("Callback 2 called")
