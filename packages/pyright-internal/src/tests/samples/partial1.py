# This sample tests the functools.partial support.

from functools import partial
from typing import Literal, TypeVar

_T1 = TypeVar("_T1")


def func1():
    """func1"""
    return 0


p1_0 = partial(func1)

t_p1_0: Literal["Literal[0]"] = reveal_type(p1_0())

# This should generate an error.
p1_0("")

# This should generate an error.
p1_1 = partial(func1, "", "")


def func2(name: str, number: int) -> None:
    """func2"""
    pass


p2_0 = partial(func2)

t_p2_0: Literal["None"] = reveal_type(p2_0("", 3))

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

t_p3_0: Literal["Literal[0]"] = reveal_type(p3_0("", 3))

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
t_p5_0_0: Literal["int"] = reveal_type(p5_0(3, 3))
t_p5_0_1: Literal["str"] = reveal_type(p5_0("3", "3"))


p5_1 = partial(func5, 2)

p5_1(3)

# This should generate an error.
p5_1("3")


def func6(a: int, name: _T1, number: _T1) -> _T1:
    return name


p6_0 = partial(func6, 3, 4)

t_p6_0_0: Literal["int"] = reveal_type(p6_0(3))


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
