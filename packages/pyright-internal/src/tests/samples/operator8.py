# This sample tests various "literal math" binary and unary operations that
# are applied when all operands are literal types with the same associated
# class.

from functools import reduce
from typing import Iterable, Literal, TypeVar

TLiteral = TypeVar("TLiteral", bound=Literal[0, 1, 2])


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

    c1 = ~c1
    reveal_type(c1, expected_text="Literal[-3, -2, 1, 2, 5, 6]")

    c1 = (-5 & 1) ^ (4 | 2)
    reveal_type(c1, expected_text="Literal[7]")

    c1 = 1 << 128
    reveal_type(c1, expected_text="Literal[340282366920938463463374607431768211456]")

    c1 = 2**10
    reveal_type(c1, expected_text="Literal[1024]")

    c1 = (-1) ** 10
    reveal_type(c1, expected_text="Literal[1]")

    c1 = (2 - 3) ** 100001
    reveal_type(c1, expected_text="Literal[-1]")

    c1 = 2**100
    reveal_type(c1, expected_text="Literal[1267650600228229401496703205376]")

    c6 = 1
    for _ in range(100):
        c6 += a
        reveal_type(c6, expected_text="int")

    c7 = -10 // 8
    reveal_type(c7, expected_text="Literal[-2]")

    c8 = 10 // -6
    reveal_type(c8, expected_text="Literal[-2]")

    c9 = 0 // -6
    reveal_type(c9, expected_text="Literal[0]")

    c10 = 0 // 6
    reveal_type(c10, expected_text="Literal[0]")

    c11 = -6 // 6
    reveal_type(c11, expected_text="Literal[-1]")

    c12 = 6 // -6
    reveal_type(c12, expected_text="Literal[-1]")

    c13 = 6 // -3
    reveal_type(c13, expected_text="Literal[-2]")

    c14 = 256 // -16
    reveal_type(c14, expected_text="Literal[-16]")

    c20 = 1 << -1
    reveal_type(c20, expected_text="int")

    c21 = 1 >> -1
    reveal_type(c21, expected_text="int")

    c30 = -129 % 16
    reveal_type(c30, expected_text="Literal[15]")

    c31 = -129 % 32
    reveal_type(c31, expected_text="Literal[31]")

    c32 = -129 % 100
    reveal_type(c32, expected_text="Literal[71]")

    c33 = 256 % -32678
    reveal_type(c33, expected_text="Literal[-32422]")

    c34 = 256 % -129
    reveal_type(c34, expected_text="Literal[-2]")

    c35 = 0 % -1
    reveal_type(c35, expected_text="Literal[0]")

    c36 = -1 % -1
    reveal_type(c36, expected_text="Literal[0]")

    c37 = 1 % 1
    reveal_type(c37, expected_text="Literal[0]")

    c38 = -2 % 1
    reveal_type(c38, expected_text="Literal[0]")

    c39 = 4 % -2
    reveal_type(c39, expected_text="Literal[0]")


def func2(cond: bool):
    c1 = "Hi " + ("Steve" if cond else "Amy")
    reveal_type(c1, expected_text="Literal['Hi Steve', 'Hi Amy']")


def func3(cond: bool):
    c1 = b"Hi " + (b"Steve" if cond else b"Amy")
    reveal_type(c1, expected_text='Literal[b"Hi Steve", b"Hi Amy"]')


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
    # Make sure this degenerate case falls back to "LiteralString".
    reveal_type(a + b + c + d + e + f + g + h + i, expected_text="LiteralString")


def func6(x: Literal[1, 3, 5, 7, 11, 13]):
    y = x
    y *= x

    reveal_type(
        y,
        expected_text="Literal[1, 3, 5, 7, 11, 13, 9, 15, 21, 33, 39, 25, 35, 55, 65, 49, 77, 91, 121, 143, 169]",
    )

    y *= x
    reveal_type(y, expected_text="int")


def func7(values: Iterable[str]) -> tuple[str, int]:
    return reduce(
        lambda x, value: (x[0] + value, x[1] + 1),
        values,
        ("", 0),
    )


def func8(values: Iterable[float]) -> float:
    total, num_of_values = reduce(
        lambda total_and_count, value: (
            total_and_count[0] + value,
            total_and_count[1] + 1,
        ),
        values,
        (0, 0),
    )
    return total / num_of_values


def func9(a: int) -> None:
    b = 0
    reveal_type(b, expected_text="Literal[0]")

    def inner1() -> None:
        nonlocal b
        b += 1
        reveal_type(b, expected_text="int")
        b = b + 1

    def inner2() -> None:
        nonlocal b
        b = b + 1
        reveal_type(b, expected_text="int")

    inner1()
    inner2()


def func10(a: TLiteral) -> TLiteral:
    # This should generate an error.
    return -a


def func11(a: TLiteral, b: TLiteral) -> TLiteral:
    # This should generate an error.
    return a + b
