# Literal arithmetic must not carry an unchanged inference fallback into its result.
from typing import Literal, assert_type


def takes_original_text(rows: list[tuple[Literal["a", "b"]]]) -> None:
    pass


def takes_original_numbers(rows: list[tuple[Literal[1, 2]]]) -> None:
    pass


def text_arithmetic() -> None:
    text = (("a",),)[0][0]
    if text in ("a", "b"):
        suffixed = text + "x"
        assert_type(suffixed, Literal["ax", "bx"])
        row = (suffixed,)
        rows = [row]
        assert_type(rows, list[tuple[Literal["ax", "bx"]]])
        rows.append(("ax",))
        rows.append(("bx",))
        takes_original_text(rows)  # This should generate an argument error.
        assert_type("x" + text, Literal["xa", "xb"])
        assert_type(text, Literal["a"])


def integer_arithmetic() -> None:
    number = ((1,),)[0][0]
    if number in (1, 2):
        negated = -number
        assert_type(negated, Literal[-1, -2])
        row = (negated,)
        rows = [row]
        assert_type(rows, list[tuple[Literal[-1, -2]]])
        rows.append((-2,))
        takes_original_numbers(rows)  # This should generate an argument error.
        assert_type(+number, Literal[1, 2])
        assert_type(~number, Literal[-2, -3])
        assert_type(number + 3, Literal[4, 5])
        assert_type(3 + number, Literal[4, 5])
        assert_type(number * 2, Literal[2, 4])
        assert_type(number, Literal[1])


def independent_guards() -> None:
    text = (("a",),)[0][0]
    if text == "a":
        assert_type(text + "x", Literal["ax"])
        row = (text + "x",)
        assert_type([row], list[tuple[Literal["ax"]]])
    number = ((1,),)[0][0]
    if number == 1:
        assert_type(-number, Literal[-1])
        number_row = (-number,)
        assert_type([number_row], list[tuple[Literal[-1]]])
    flag = ((True,),)[0][0]
    if flag:
        assert_type(not flag, Literal[False])
