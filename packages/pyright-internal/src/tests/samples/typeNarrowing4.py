# This sample tests the type narrowing logic for
# conditional expression involving assignment expressions
# (walrus operator), including narrowing of the RHS when
# the assignment expression is used in a comparison or type
# guard call (consistent with truthiness narrowing).

# pyright: strict

from typing import Literal


class C:
    def method1(self):
        pass


def good(b: C | None) -> None:
    a = b
    if a:
        a.method1()


def bad(b: C | None) -> None:
    # Truthiness narrows both the walrus target and the RHS.
    if c := b:
        c.method1()
        b.method1()


def func1(b: C | None) -> None:
    # "is not None" should narrow the RHS the same way as truthiness.
    if (d := b) is not None:
        reveal_type(d, expected_text="C")
        reveal_type(b, expected_text="C")
        b.method1()


def func2(x: str | None) -> str:
    if (y := x) is not None:
        reveal_type(y, expected_text="str")
        reveal_type(x, expected_text="str")
        return x
    return ""


def func3(x: str | None) -> None:
    if (y := x) is None:
        reveal_type(y, expected_text="None")
        reveal_type(x, expected_text="None")
    else:
        reveal_type(y, expected_text="str")
        reveal_type(x, expected_text="str")


def func4(x: int | None) -> None:
    assert (y := x) is not None
    reveal_type(y, expected_text="int")
    reveal_type(x, expected_text="int")


def func5(x: str | None) -> None:
    if (y := x) != None:
        reveal_type(y, expected_text="str")
        reveal_type(x, expected_text="str")


def func6(v1: int | str, v2: str | None) -> None:
    if isinstance(x1 := v1, str):
        reveal_type(x1, expected_text="str")
        reveal_type(v1, expected_text="str")

    if (x2 := v2) == "hello":
        reveal_type(x2, expected_text="Literal['hello']")
        reveal_type(v2, expected_text="Literal['hello']")


class D:
    pass


def func7(x: D | Literal["a"] | None) -> None:
    if type(d := x) is D:
        reveal_type(d, expected_text="D")
        reveal_type(x, expected_text="D")
