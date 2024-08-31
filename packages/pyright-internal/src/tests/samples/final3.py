# This sample tests the "Final" type annotation
# introduced in Python 3.8.

import typing
from typing import Annotated, Any, Final, Protocol, TypeVar

T = TypeVar("T")

v1: typing.Final = 3

must_be_int: int = v1

# This should generate an error because
# reassignment of a Final variable should
# not be allowed.
v1 = 4

# This should generate an error because there
# is a previous Final declaration.
v1: Final[int]

# This should generate an error because
# the type doesn't match.
v2: Final[str] = 3

# This should generate an error because
# we expect only one type argument for Final.
v3: Final[str, int] = "hello"


v4: Final = 5
reveal_type(v4, expected_text="Literal[5]")


class ClassA:
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

    member9: Final = 2

    # This should generate an error.
    member9 = 3

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


reveal_type(ClassA.member1, expected_text="Literal[4]")
reveal_type(ClassA(True).member1, expected_text="Literal[4]")


class ClassB(ClassA):
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
b: list[Final[int]] = []


class ClassC:
    member1: Final = 3
    member2: Final
    member4: Final
    member5: Final = 3

    def __init__(self):
        # This should generate an error.
        self.member1 = 5

        self.member2 = "hi"

        self.member3: Final = "hi"

        # This should generate an error.
        ClassC.member4 = "hi"

        # This should generate an error.
        ClassC.member5 = 3

    def other(self):
        # This should generate an error.
        self.member1 = 5

        # This should generate an error.
        self.member2 = "hi"

        # This should generate an error.
        self.member3 = "hi"


a = ClassC()

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


class ClassD:
    def __init__(self):
        self.x: Final = 1

    def method1(self):
        # This should generate an error because x is Final.
        self.x += 1


class ClassE(Protocol):
    x: Final[int]


def func3(x: type[T]) -> T:
    return x()


# This should generate an error because Final isn't compatible with type.
func3(Final[int])


v5: Final = lambda: None


# This should generate an error because foo5 is declared as Final.
def v5() -> None:
    pass


# This should generate an error because ClassVar is Final.
from typing import ClassVar

ClassVar: Final = 3


v6: Annotated[Final[int], "meta"] = 1

# This should generate an error
v6 = 2

v7: Annotated[Annotated[Final[int], "meta"], "meta"] = 1

# This should generate an error
v7 = 2

v8: Annotated[Final, "meta"] = 1

# This should generate an error
v8 = 2

v9: Final = 2 or "2"
reveal_type(v9, expected_text="Literal[2]")

v10: Final = 0 or "2"
reveal_type(v10, expected_text="Literal['2']")

v11: Final = b"" and True
reveal_type(v11, expected_text='Literal[b""]')

v12: Final = b"2" and True
reveal_type(v12, expected_text="Literal[True]")


def func4():
    while 1 < 1:
        # This should generate an error because it's in a loop.
        x1: Final = 1

    for i in range(10):
        if i < 3:
            # This should generate an error because it's in a loop.
            x2: Final[int] = 1


class ClassF:
    while 1 < 2:
        # This should generate an error because it's in a loop.
        x1: Final = 1

    for i in range(10):
        if i < 3:
            # This should generate an error because it's in a loop.
            x2: Final[int] = 1
