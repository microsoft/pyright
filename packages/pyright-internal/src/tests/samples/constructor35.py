# This sample tests that an Any argument that matches multiple overloaded
# __init__ methods with different "self" specializations does not simply
# select the first overload.

from contextlib import nullcontext
from typing import Any, Generic, TypeVar, overload

T = TypeVar("T")


def func1(items: Any, value: int) -> None:
    with nullcontext(items) as v1:
        reveal_type(v1, expected_text="Any")

        for _ in v1:
            pass

    with nullcontext(value) as v2:
        reveal_type(v2, expected_text="int")

    with nullcontext() as v3:
        reveal_type(v3, expected_text="None")


class ClassA(Generic[T]):
    @overload
    def __init__(self: "ClassA[int]", x: int) -> None: ...

    @overload
    def __init__(self: "ClassA[str]", x: str) -> None: ...

    def __init__(self, x: Any) -> None:
        pass


def func2(a: Any, b: int, c: str) -> None:
    reveal_type(ClassA(a), expected_text="ClassA[Unknown]")
    reveal_type(ClassA(b), expected_text="ClassA[int]")
    reveal_type(ClassA(c), expected_text="ClassA[str]")


class ClassB(Generic[T]):
    @overload
    def __init__(self: "ClassB[int]", x: int, y: int) -> None: ...

    @overload
    def __init__(self: "ClassB[int]", x: str, y: int) -> None: ...

    def __init__(self, x: Any, y: int) -> None:
        pass


def func3(a: Any) -> None:
    # Both overloads produce the same specialization, so the result is
    # not ambiguous.
    reveal_type(ClassB(a, 1), expected_text="ClassB[int]")


def func4(a):
    # An unannotated parameter is Unknown rather than an explicit Any. It
    # takes the same code path, so it must not pick the first overload either.
    reveal_type(ClassA(a), expected_text="ClassA[Unknown]")
    reveal_type(ClassB(a, 1), expected_text="ClassB[int]")

from typing_extensions import TypeVar as TypeVarWithDefault

U = TypeVarWithDefault("U", default=bytes)
V = TypeVarWithDefault("V", default=bool)


class ClassC(Generic[U, V]):
    @overload
    def __init__(self: "ClassC[str, int]", x: int) -> None: ...

    @overload
    def __init__(self: "ClassC[str, str]", x: str) -> None: ...

    def __init__(self, x: Any) -> None:
        pass


def func5(a: Any) -> None:
    # Keep the shared str argument. Conflicting arguments are unknown, not
    # the unrelated default bool (nor the first overload's int).
    reveal_type(ClassC(a), expected_text="ClassC[str, Unknown]")
    reveal_type(ClassC(1), expected_text="ClassC[str, int]")
    reveal_type(ClassC("a"), expected_text="ClassC[str, str]")


def func6(a) -> None:
    reveal_type(ClassC(a), expected_text="ClassC[str, Unknown]")
