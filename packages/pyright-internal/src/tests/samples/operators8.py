# This sample tests various "literal math" binary and unary operations that
# are applied when all operands are literal types with the same associated
# class.

from typing import Literal


def func1(a: Literal[1, 2], b: Literal[0, 4], c: Literal[3, 4]):
    c1 = a * b + c
    t1: Literal["Literal[3, 4, 7, 8, 11, 12]"] = reveal_type(c1)

    c2 = a // 0
    t2: Literal["int"] = reveal_type(c2)

    c3 = a % 0
    t3: Literal["int"] = reveal_type(c3)

    c4 = ((a * 1000) % 39) // c
    t4: Literal["Literal[8, 6, 3, 2]"] = reveal_type(c4)

    c5 = a + True
    t5: Literal["int"] = reveal_type(c5)

    c1 -= 5
    t1_0: Literal["Literal[-2, -1, 2, 3, 6, 7]"] = reveal_type(c1)

    c1 = -c1
    t1_1: Literal["Literal[2, 1, -2, -3, -6, -7]"] = reveal_type(c1)

    c1 = +c1
    t1_2: Literal["Literal[2, 1, -2, -3, -6, -7]"] = reveal_type(c1)

    c6 = 1
    for _ in range(100):
        c6 += a
        t6: Literal["int"] = reveal_type(c6)


def func2(cond: bool):
    c1 = "Hi " + ("Steve" if cond else "Amy")
    t1: Literal["Literal['Hi Steve', 'Hi Amy']"] = reveal_type(c1)


def func3(cond: bool):
    c1 = b"Hi " + (b"Steve" if cond else b"Amy")
    t1: Literal["Literal[b'Hi Steve', b'Hi Amy']"] = reveal_type(c1)


def func4(a: Literal[True], b: Literal[False]):
    c1 = a and b
    t1: Literal["Literal[False]"] = reveal_type(c1)

    c2 = a and a
    t2: Literal["Literal[True]"] = reveal_type(c2)

    c3 = a or b
    t3: Literal["Literal[True]"] = reveal_type(c3)

    c4 = not a
    t4: Literal["Literal[False]"] = reveal_type(c4)

    c5 = not b
    t5: Literal["Literal[True]"] = reveal_type(c5)

    c6 = not b and not a
    t6: Literal["Literal[False]"] = reveal_type(c6)

    c7 = not b or not a
    t7: Literal["Literal[True]"] = reveal_type(c7)

    c8 = b
    t8_0: Literal["Literal[False]"] = reveal_type(c8)
    while True:
        c8 = not c8
        t8_1: Literal["bool"] = reveal_type(c8)


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
    t1: Literal["str"] = reveal_type(a + b + c + d + e + f + g + h + i)
