# This sample tests various "literal math" binary and unary operations that
# are applied when all operands are literal types with the same associated
# class.

from typing import Literal


def func1(a: Literal[1, 2], b: Literal[0, 4], c: Literal[3, 4]):
    c1 = a * b + c
    reveal_type(c1, expected_text="Literal[3, 4, 7, 8, 11, 12]")

    c2 = a // 0
    reveal_type(c2, expected_text="int")

    c3 = a % 0
    reveal_type(c3, expected_text="int")

    c4 = ((a * 1000) % 39) // c
    reveal_type(c4, expected_text="Literal[8, 6, 3, 2]")

    c5 = a + True
    reveal_type(c5, expected_text="int")

    c1 -= 5
    reveal_type(c1, expected_text="Literal[-2, -1, 2, 3, 6, 7]")

    c1 = -c1
    reveal_type(c1, expected_text="Literal[2, 1, -2, -3, -6, -7]")

    c1 = +c1
    reveal_type(c1, expected_text="Literal[2, 1, -2, -3, -6, -7]")

    c6 = 1
    for _ in range(100):
        c6 += a
        reveal_type(c6, expected_text="int")


def func2(cond: bool):
    c1 = "Hi " + ("Steve" if cond else "Amy")
    reveal_type(c1, expected_text="Literal['Hi Steve', 'Hi Amy']")


def func3(cond: bool):
    c1 = b"Hi " + (b"Steve" if cond else b"Amy")
    reveal_type(c1, expected_text="Literal[b'Hi Steve', b'Hi Amy']")


def func4(a: Literal[True], b: Literal[False]):
    c1 = a and b
    reveal_type(c1, expected_text="Literal[False]")

    c2 = a and a
    reveal_type(c2, expected_text="Literal[True]")

    c3 = a or b
    reveal_type(c3, expected_text="Literal[True]")

    c4 = not a
    reveal_type(c4, expected_text="Literal[False]")

    c5 = not b
    reveal_type(c5, expected_text="Literal[True]")

    c6 = not b and not a
    reveal_type(c6, expected_text="Literal[False]")

    c7 = not b or not a
    reveal_type(c7, expected_text="Literal[True]")

    c8 = b
    reveal_type(c8, expected_text="Literal[False]")
    while True:
        c8 = not c8
        reveal_type(c8, expected_text="bool")


mode = Literal[
    "a",
    "b",
    "c",
    "d",
    "e",
    "f",
    "g",
    "h",
    "i",
    "j",
    "k",
    "l",
    "m",
    "n",
    "o",
    "p",
    "q",
    "r",
    "s",
    "t",
    "u",
    "v",
    "w",
    "z",
    "y",
    "z",
]


def func5(
    a: mode, b: mode, c: mode, d: mode, e: mode, f: mode, g: mode, h: mode, i: mode
):
    # Make sure this degenerate case falls back to "str".
    reveal_type(a + b + c + d + e + f + g + h + i, expected_text="str")
