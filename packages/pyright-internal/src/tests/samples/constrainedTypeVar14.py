# This sample verifies that a generic class parameterized with a
# constrained TypeVar properly translates an explicit type argument
# into the correct constrained type.

from typing import TypeVar, Generic


class A: ...


class B: ...


class A2(A): ...


T = TypeVar("T", A, B)


class F(Generic[T]):
    def __init__(self, thing: T) -> None:
        self.thing = thing


f2 = F[A2](A2())

reveal_type(F[A2], expected_text="type[F[A]]")
reveal_type(f2, expected_text="F[A]")
reveal_type(f2.thing, expected_text="A")
