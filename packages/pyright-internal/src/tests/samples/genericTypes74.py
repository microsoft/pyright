# This sample tests the handling of a generic type whose implementation
# includes the instantiation of another instance of itself using its
# own type parameters as type arguments.

from typing import Generic, TypeVar

A = TypeVar("A")
B = TypeVar("B")


class X(Generic[A, B]):
    _dict: dict[A, B]
    _pair: "X[B, A]"

    def method(self, a: A, b: B) -> None:
        self._pair._dict[b]


x = X[int, str]()
x._pair._dict["foo"]

reveal_type(x._pair, expected_text="X[str, int]")
reveal_type(x._pair._pair, expected_text="X[int, str]")
