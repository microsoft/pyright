# This sample tests the handling of if/elif chains that omit an else
# statement. The "implied else" statement should be assumed never taken if the
# final if/elif test expression evaluates to Never in the negative case.

from enum import Enum
from typing import Literal


def func1(x: int | str):
    if isinstance(x, int):
        y = 0
    elif isinstance(x, str):
        y = 1

    print(y)


def func2(x: Literal[1, 2, 3, 4]):
    if x == 1 or x == 2:
        y = 0
    elif x == 3 or not x == 3:
        y = 1

    print(y)


def func3(x: Literal[1, 2], y: Literal["one", "two"]):
    if x == 1 or y != "two":
        z = 0
    elif x == 2 or y != "one":
        z = 1

    print(z)


class Color(Enum):
    RED = 1
    BLUE = 2
    GREEN = 3
    PERIWINKLE = 4


def func4(x: Color):
    if x == Color.RED:
        return

    if x == Color.GREEN or (x == Color.PERIWINKLE and True):
        y = 2
    else:
        if x == Color.BLUE:
            y = 3

    print(y)


def func5():
    if True:
        y = 2

    print(y)


def func6():
    if not None:
        y = 2

    print(y)


def func7(color: Color) -> str:
    if color == Color.RED or color == Color.BLUE:
        return "yes"
    elif color == Color.GREEN or color == Color.PERIWINKLE:
        return "no"


def func8(color: Color) -> bool:
    if color == Color.RED or color == Color.BLUE:
        return True
    elif color == Color.GREEN or color == Color.PERIWINKLE:
        return False


reveal_type(func8(Color.RED), expected_text="bool")


def func9(a: str | int, b: str | int) -> bool:
    if isinstance(a, str):
        return True
    elif isinstance(a, int):
        if isinstance(b, str):
            return False
        elif isinstance(b, int):
            return False


def func10(foo: list[str]) -> bool:
    i = 0
    x: int | None = None

    while i < 5:
        foo[i]

        if x is None:
            return False
        reveal_type(x, expected_text="Never")
        i = x

    return True


class A:
    pass


class B(A):
    pass


def func11(val: A | B):
    if not (isinstance(val, A) or isinstance(val, B)):
        raise Exception


reveal_type(func11(A()), expected_text="None")


def func12(val: A | B):
    if isinstance(val, A) or isinstance(val, B):
        raise Exception


reveal_type(func12(A()), expected_text="NoReturn")


def func13(val: int | float):
    err_msg = "error!"
    if isinstance(val, int):
        return 1
    elif isinstance(val, float):
        return 1.0
    raise ValueError(err_msg)
