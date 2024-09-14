# This sample tests for isinstance calls that always evaluate to true.

from typing import ClassVar, Protocol, TypedDict, runtime_checkable
from unknown_import import CustomClass1


class CustomClass2(CustomClass1):
    pass


def func1(p1: int, p2: int | str):
    a = isinstance(p2, str)

    b = isinstance(p2, (int, float))

    # This should generate an error because this is always true.
    c = isinstance(p2, (float, dict, int, str))

    d = isinstance(p1, float)

    e = isinstance(p2, (float, dict, int))

    # This should generate an error because this is always true.
    f = isinstance(p1, int)

    # This should not generate an error because it's within an assert.
    assert isinstance(p1, int)

    g = CustomClass2()
    # This should not generate an error because CustomClass2
    # derives from an unknown type.
    g = isinstance(g, CustomClass1)


class SomeTypedDict(TypedDict):
    name: str


def func2(p1: SomeTypedDict, p2: int | SomeTypedDict):
    a = isinstance(p2, dict)

    # This should generate an error because it's always true.
    b = isinstance(p1, dict)


@runtime_checkable
class BaseClass(Protocol):
    text: ClassVar[str] = "FOO"


class ClassA:
    text: ClassVar[str] = "BAR"


class ClassB:
    text: ClassVar[str] = "BAZ"


class ClassC:
    pass


def func3(obj: BaseClass):
    if isinstance(obj, (ClassA, ClassB)):
        reveal_type(obj, expected_text="ClassA | ClassB")

    if isinstance(obj, (ClassA, ClassB, ClassC)):
        reveal_type(obj, expected_text="ClassA | ClassB")


class A:
    pass


class B(A):
    pass


def func4(a: A, cls: type[A]) -> None:
    isinstance(a, cls)

    # This should generate an error because it's always true.
    isinstance(a, A)
