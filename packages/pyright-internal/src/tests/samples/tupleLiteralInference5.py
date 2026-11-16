# Optional truthiness must not become mandatory literal precision.
from typing import Literal, assert_type


def string_and() -> None:
    value = (("a",),)[0][0]
    result = value and "b"
    row = (result,)
    rows = [row]
    assert_type(result, Literal["", "b"])
    assert_type(rows, list[tuple[Literal["", "b"]]])
    rows.append(("",))
    assert_type(value, str)


def empty_string_or() -> None:
    value = (("",),)[0][0]
    result = value or "b"
    row = (result,)
    rows = [row]
    assert_type(result, str)
    assert_type(rows, list[tuple[str]])
    rows.append(("c",))
    assert_type(value, str)


def number_and() -> None:
    value = ((1,),)[0][0]
    result = value and 2
    row = (result,)
    rows = [row]
    assert_type(result, Literal[0, 2])
    assert_type(rows, list[tuple[Literal[0, 2]]])
    rows.append((0,))
    assert_type(value, int)


def zero_or() -> None:
    value = ((0,),)[0][0]
    result = value or 2
    row = (result,)
    rows = [row]
    assert_type(result, int)
    assert_type(rows, list[tuple[int]])
    rows.append((3,))
    assert_type(value, int)


def conditional_control() -> None:
    value = (("a",),)[0][0]
    result = "b" if value else ""
    row = (result,)
    rows = [row]
    assert_type(rows, list[tuple[Literal["", "b"]]])
    rows.append(("",))


def unmarked_control(value: str) -> None:
    result = value and "b"
    row = (result,)
    rows = [row]
    assert_type(rows, list[tuple[Literal["", "b"]]])
    rows.append(("",))


def selected_operand_control() -> None:
    value = ((1,),)[0]
    result = True and value
    assert_type(result, tuple[Literal[1]])
    rows = [result]
    assert_type(rows, list[tuple[int]])
    rows.append((2,))


def annotated_control(value: Literal["a"]) -> None:
    result = value and "b"
    row = (result,)
    rows = [row]
    assert_type(rows, list[tuple[Literal["b"]]])
    rows.append(("",))  # This should generate an argument-type error.


def independent_guard_control(value: str) -> None:
    if value == "a":
        result = value and "b"
        row = (result,)
        rows = [row]
        assert_type(rows, list[tuple[Literal["b"]]])
        rows.append(("",))  # This should generate an argument-type error.
