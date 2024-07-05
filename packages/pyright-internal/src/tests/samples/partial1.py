# This sample tests the functools.partial support.

from functools import partial
from typing import Callable, Protocol, Self, TypeVar

_T1 = TypeVar("_T1")
_T2 = TypeVar("_T2", covariant=True)


def func1():
    """func1"""
    return 0


p1_0 = partial(func1)

reveal_type(p1_0(), expected_text="Literal[0]")

# This should generate an error.
p1_0("")

# This should generate an error.
p1_1 = partial(func1, "", "")


def func2(name: str, number: int) -> None:
    """func2"""
    pass


p2_0 = partial(func2)

reveal_type(p2_0("", 3), expected_text="None")

# This should generate an error.
p2_0()

# This should generate an error.
p2_0("")

# This should generate an error.
p2_0("", 3, 3)

# This should generate an error.
p2_0("", 3, 3)

p2_0("", number=3)

# This should generate an error.
p2_0("", 3, number=3)

p2_1 = partial(func2, "")

# This should generate an error.
p2_1()

p2_1(3)
p2_1(number=3)

# This should generate an error.
p2_1(3, number=3)

p2_2 = partial(func2, number=3)
p2_2("")

p2_3 = partial(func2, number=3, name="")
p2_3()


def func3(name: str, /, number: int):
    return 0


p3_0 = partial(func3)

reveal_type(p3_0("", 3), expected_text="Literal[0]")

# This should generate an error.
p3_0(name="", number=3)

p3_1 = partial(func3, "")

p3_1(3)
p3_1(number=3)


def func4(name: str, *, number: int):
    return 0


p4_0 = partial(func4)

# This should generate an error.
p4_0("", 3)

p4_0("", number=3)


def func5(name: _T1, number: _T1) -> _T1:
    return name


p5_0 = partial(func5)
reveal_type(p5_0(3, 3), expected_text="int")
reveal_type(p5_0("3", "3"), expected_text="str")


p5_1 = partial(func5, 2)

p5_1(3)

# This should generate an error.
p5_1("3")


def func6(a: int, name: _T1, number: _T1) -> _T1:
    return name


p6_0 = partial(func6, 3, 4)

reveal_type(p6_0(3), expected_text="int")


def func7(a: int, name: float, *args: str):
    return 0


p7_0 = partial(func7, 3, 3, "", "", "")
p7_0("", "")

# This should generate an error.
p7_0(3)

p7_1 = partial(func7)
p7_1(3, 0)
p7_1(3, 0, "", "")

# This should generate an error.
p7_1(3, 0, foo=3)


def func8(a: int, name: str, **kwargs: int):
    return 0


p8_0 = partial(func8, 3, "")
p8_0()
p8_0(foo=3)

# This should generate an error.
p8_0(foo="")

p8_1 = partial(func8)
p8_1(3, "")

# This should generate an error.
p8_1(3)


# This should generate an error.
p8_1(3, "", 5)

p8_1(3, "", foo=4, bar=5)


class Partial(Protocol[_T2]):
    def __new__(cls, __func: Callable[..., _T2]) -> Self: ...


def func9() -> int: ...


# This should generate an error.
x: Partial[str] = partial(func9)
