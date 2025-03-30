# This sample tests that overload matching for partially-overlapping overload
# signatures considers the "expected type" when using bidirectional type
# inference.

from typing import Any, Generic, LiteralString, TypeVar, overload


T = TypeVar("T")


class A(Generic[T]):
    @overload
    def func1(self: "A[bool]", x: "A[bool]") -> list[LiteralString]: ...

    @overload
    def func1(self, x: "A[str]") -> list[str]: ...

    def func1(self, x: "A[Any]") -> list[str] | list[LiteralString]:
        return []


def func2(a: A[bool], b: A[str]):
    v1: list[LiteralString] = a.func1(a)

    # This should generate an error.
    v2: list[str] = a.func1(a)

    # This should generate an error.
    v3: list[LiteralString] = b.func1(b)
    v4: list[str] = b.func1(b)
