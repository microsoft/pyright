# This sample tests the handling of refinement types that use the
# IntTuple refinement domain.

# pyright: reportMissingModuleSource=false

from typing import cast
from typing_extensions import Shape


class Tensor:
    ...


def func1(a: int @ "x", b: int @ "y") -> Tensor @ Shape("x, y"):
    ...


v1 = func1(1, 2)
reveal_type(v1, expected_text='Tensor @ Shape("1, 2")')


def func2(a: Tensor @ Shape("x, y")) -> Tensor @ Shape("y, x"):
    ...


t2 = cast(Tensor @ Shape("1, 2"), Tensor())
v2 = func2(t2)
reveal_type(v2, expected_text='Tensor @ Shape("2, 1")')


def func3(a: Tensor @ Shape("a, b")):
    x = func2(a)
    reveal_type(x, expected_text='Tensor @ Shape("b, a")')
    return x


t3_1 = cast(Tensor @ Shape("1, 2"), Tensor())
v3_1 = func3(t3_1)
reveal_type(v3_1, expected_text='Tensor @ Shape("2, 1")')

t3_2 = cast(Tensor @ Shape("_, 1"), Tensor())
v3_2 = func3(t3_2)
reveal_type(v3_2, expected_text='Tensor @ Shape("1, _")')


def func4(a: Tensor @ Shape("a, b, *other")) -> Tensor @ Shape("a, *other, b"):
    ...


t4_1 = cast(Tensor @ Shape("1, 2, 3, 4"), Tensor())
v4_1 = func4(t4_1)
reveal_type(v4_1, expected_text='Tensor @ Shape("1, 3, 4, 2")')
