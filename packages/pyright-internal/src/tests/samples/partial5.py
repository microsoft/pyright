# This sample tests the case where a class is passed as the first argument
# to functools.partial.

from dataclasses import dataclass
from functools import partial
from typing import Self, TypeVar


class A:
    def __init__(self, x: int, y: int) -> None: ...


# This should generate an error because "y" has the wrong type.
v1 = partial(A, x=1, y="a")

v2 = partial(A, x=1, y=2)
reveal_type(v2, expected_text="partial[A]")
v2()
v2(x=2)


T = TypeVar("T", bound=A)


def func1(x: type[T]):
    # This should generate an error because "z" is not a valid parameter.
    v1 = partial(x, x=1, z="a")

    v2 = partial(x, y=1)

    # This should generate an error because it's missing "x".
    v2()

    v2(x=1)


@dataclass
class B:
    x: int
    y: str

    @classmethod
    def from_x(cls, x: int) -> Self:
        make_b = partial(cls, x=x)
        reveal_type(make_b, expected_text="partial[Self@B]")

        self = make_b(y="")
        reveal_type(self, expected_text="Self@B")

        return self
