# This sample tests overload matching in cases where one or more
# matches are found due to an Any or Unknown argument.

from typing import Any, Literal, overload
from typing_extensions import LiteralString


@overload
def overload1(x: int, y: float) -> float:
    ...


@overload
def overload1(x: str, y: float) -> str:
    ...


def overload1(x: str | int, y: float) -> float | str:
    ...


def func1(a: Any):
    v1 = overload1(1, 3.4)
    reveal_type(v1, expected_text="float")

    v2 = overload1("", 3.4)
    reveal_type(v2, expected_text="str")

    v3 = overload1(a, 3.4)
    reveal_type(v3, expected_text="Unknown")

    v4 = overload1("", a)
    reveal_type(v4, expected_text="str")


@overload
def overload2(x: int) -> Any:
    ...


@overload
def overload2(x: str) -> str:
    ...


def overload2(x: str | int) -> Any | str:
    ...


def func2(a: Any):
    v1 = overload2("")
    reveal_type(v1, expected_text="str")

    v2 = overload2(3)
    reveal_type(v2, expected_text="Any")

    v3 = overload2(a)
    reveal_type(v3, expected_text="Any")


@overload
def overload3(x: LiteralString) -> LiteralString:
    ...


@overload
def overload3(x: str) -> str:
    ...


def overload3(x: str) -> str:
    ...


def func3(a: Any, b: str):
    v1 = overload3("")
    reveal_type(v1, expected_text="LiteralString")

    v2 = overload3(b)
    reveal_type(v2, expected_text="str")

    v3 = overload3(a)
    reveal_type(v3, expected_text="str")


def func4(a: Any):
    d = dict(a)
    reveal_type(d, expected_text="dict[Any, Any]")


@overload
def overload4(x: str, *, flag: Literal[True]) -> int:
    ...


@overload
def overload4(x: str, *, flag: Literal[False] = ...) -> str:
    ...


@overload
def overload4(x: str, *, flag: bool = ...) -> int | str:
    ...


def overload4(x: str, *, flag: bool = False) -> int | str:
    ...


reveal_type(overload4("0"), expected_text="str")
reveal_type(overload4("0", flag=True), expected_text="int")
reveal_type(overload4("0", flag=False), expected_text="str")


def unknown_any() -> Any:
    ...


def func5(a: Any):
    reveal_type(overload4(a, flag=False), expected_text="str")
    reveal_type(overload4("0", flag=a), expected_text="Unknown")
