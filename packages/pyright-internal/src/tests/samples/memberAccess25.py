# This sample tests for the check of a member access through a generic class
# when the type of the attribute is generic (and therefore its type is
# ambiguous).

from typing import Generic, TypeVar

T = TypeVar("T")


class ClassA(Generic[T]):
    x: T
    y: int

    def __init__(self, label: T | None = None) -> None: ...


ClassA[int].y = 1
ClassA[int].y
del ClassA[int].y

ClassA.y = 1
ClassA.y
del ClassA.y

# This should generate an error because x is generic.
ClassA[int].x = 1

# This should generate an error because x is generic.
ClassA[int].x

# This should generate an error because x is generic.
del ClassA[int].x

# This should generate an error because x is generic.
ClassA.x = 1

# This should generate an error because x is generic.
ClassA.x

# This should generate an error because x is generic.
del ClassA.x


class ClassB(ClassA[T]):
    pass


# This should generate an error because x is generic.
ClassB[int].x = 1

# This should generate an error because x is generic.
ClassB[int].x

# This should generate an error because x is generic.
del ClassB[int].x

# This should generate an error because x is generic.
ClassB.x = 1

# This should generate an error because x is generic.
ClassB.x

# This should generate an error because x is generic.
del ClassB.x


class ClassC(ClassA[int]):
    pass


ClassC.x = 1
ClassC.x
del ClassC.x
ClassC.x
del ClassC.x


def func1(a: type[ClassA]):
    print(a.x)
