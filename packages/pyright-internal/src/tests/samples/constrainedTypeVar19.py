# This tests the handling of a constrained TypeVar with literal types
# in the constraints.

from typing import TypeVar, Literal, Generic

T = TypeVar("T", Literal[True], Literal[False])


class A(Generic[T]):
    def __init__(self, null: T = False) -> None:
        pass


A(null=bool())  # Type error

reveal_type(A(null=False), expected_text="A[Literal[False]]")
reveal_type(A(), expected_text="A[Literal[False]]")
reveal_type(A(null=True), expected_text="A[Literal[True]]")
