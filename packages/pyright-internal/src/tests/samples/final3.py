# This sample tests the "Final" type annotation
# introduced in Python 3.8.

import typing
from typing import Any, Final, List

foo1: typing.Final = 3

must_be_int: int = foo1

# This should generate an error because
# reassignment of a Final variable should
# not be allowed.
foo1 = 4

# This should generate an error because there
# is a previous Final declaration.
foo1: Final[int]

# This should generate an error because
# the type doesn't match.
foo2: Final[str] = 3

# This should generate an error because
# we expect only one type argument for Final.
foo3: Final[str, int] = "hello"


foo4: Final = 5
reveal_type(foo4, expected_text="Literal[5]")


class Foo:
    member1: Final = 4

    # This should generate an error because only
    # one declaration can have a Final attribute.
    member1: Final

    member2: typing.Final[int] = 3

    member4: Final[int]

    # This should generate an error because there is
    # no assignment.
    member5: Final[str]

    member6: Final[int]

    _member7: Final = 6
    __member8: Final = 6

    def __init__(self, a: bool):
        # This should generate an error because a Final
        # member outside of a stub file or a class body
        # must have an initializer.
        self.member3: Final

        # This should generate an error because this symbol
        # already has a final declaration.
        self.member2: Final[int]

        if a:
            self.member4 = 5
        else:
            self.member4 = 6

        self.member4 = 6

    def another_method(self):
        # This should generate an error because assignments
        # can occur only within class bodies or __init__ methods.
        self.member6 = 4

        # This should generate an error because 'Final' cannot
        # be used to annotate instance variables outside of
        # an __init__ method.
        self.member7: Final = 6


reveal_type(Foo.member1, expected_text="Literal[4]")
reveal_type(Foo(True).member1, expected_text="Literal[4]")


class Bar(Foo):
    # This should generate an error because we are overriding
    # a member that is marked Final in the parent class.
    member1 = 5

    # This should generate an error because we are overriding
    # a member that is marked Final in the parent class.
    _member7: Final = 6

    # This should not generate an error because it's private.
    __member8: Final = 6

    def __init__(self):
        # This should generate an error because we are overriding
        # a member that is marked Final in the parent class.
        self.member6 = 5


# This should generate an error because Final isn't allowed for
# function parameters.
def func1(a: Final[int]):
    pass


# This should generate an error because Final must the outermost
# type in assignments.
b: List[Final[int]] = []


class ClassA:
    member1: Final = 3
    member2: Final

    def __init__(self):
        # This should generate an error.
        self.member1 = 5

        self.member2 = "hi"

        self.member3: Final = "hi"

    def other(self):
        # This should generate an error.
        self.member1 = 5

        # This should generate an error.
        self.member2 = "hi"

        # This should generate an error.
        self.member3 = "hi"


a = ClassA()

# This should generate an error.
a.member1 = 4

# This should generate an error.
a.member3 = "x"


def func2():
    x: Final[Any] = 3

    # This should generate an error because x is Final.
    x += 1

    # This should generate an error because x is Final.
    a = (x := 4)

    # This should generate an error because x is Final.
    for x in [1, 2, 3]:
        pass

    # This should generate an error because x is Final.
    with open("Hi") as x:
        pass

    try:
        pass
    # This should generate an error because x is Final.
    except ModuleNotFoundError as x:
        pass

    # This should generate an error because x is Final.
    (a, x) = (1, 2)


class ClassB:
    def __init__(self):
        self.x: Final = 1

    def method1(self):
        # This should generate an error because x is Final.
        self.x += 1
