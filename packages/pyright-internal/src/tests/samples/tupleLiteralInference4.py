# Alternative patterns must preserve the previous mutable-container inference.
from typing import Literal, assert_type


def takes_allowed(rows: list[tuple[Literal["a", "b"]]]) -> None:
    pass


def pattern_or() -> None:
    value = (("a",),)[0][0]
    alias = value
    match value:
        case "a" | "b":
            row = (value,)
            rows = [row]
            assert_type(rows, list[tuple[Literal["a", "b"]]])
            rows.append(("b",))
            takes_allowed(rows)
    assert_type(alias, Literal["a"])
    alias_row = (alias,)
    alias_rows = [alias_row]
    assert_type(alias_rows, list[tuple[str]])
    alias_rows.append(("b",))


def pattern_or_reversed() -> None:
    value = (("a",),)[0][0]
    match value:
        case "b" | "a":
            row = (value,)
            rows = [row]
            assert_type(rows, list[tuple[Literal["a", "b"]]])
            rows.append(("b",))
            takes_allowed(rows)


def sequence_or() -> None:
    value = (("a",),)[0]
    match value:
        case ("a",) | ("b",):
            rows = [value]
            assert_type(rows, list[tuple[Literal["a"]] | tuple[Literal["b"]]])
            rows.append(("b",))


def sequence_element_or() -> None:
    value = (("a",),)[0]
    match value:
        case ("a" | "b",):
            rows = [value]
            assert_type(rows, list[tuple[Literal["a", "b"]]])
            rows.append(("b",))
            takes_allowed(rows)


def capture_or() -> None:
    value = (("a",),)[0][0]
    match value:
        case "a" | "b" as captured:
            row = (captured,)
            rows = [row]
            assert_type(rows, list[tuple[Literal["a", "b"]]])
            rows.append(("b",))
            takes_allowed(rows)


def membership_control() -> None:
    value = (("a",),)[0][0]
    if value in ("a", "b"):
        row = (value,)
        rows = [row]
        assert_type(rows, list[tuple[Literal["a", "b"]]])
        rows.append(("b",))
        takes_allowed(rows)


def guarded_pattern_control() -> None:
    value = (("a",),)[0][0]
    match value:
        case _ if value in ("a", "b"):
            row = (value,)
            rows = [row]
            assert_type(rows, list[tuple[Literal["a", "b"]]])
            rows.append(("b",))
            takes_allowed(rows)


def class_pattern_control() -> None:
    value = (("a",),)[0][0]
    match value:
        case str() as captured:
            row = (captured,)
            rows = [row]
            assert_type(rows, list[tuple[str]])
            rows.append(("b",))


def unmarked_control(value: str) -> None:
    match value:
        case "a" | "b":
            row = (value,)
            rows = [row]
            assert_type(rows, list[tuple[Literal["a", "b"]]])
            rows.append(("b",))
            takes_allowed(rows)


def annotated_control(value: Literal["a"]) -> None:
    match value:
        case "a" | "b":
            row = (value,)
            rows = [row]
            assert_type(rows, list[tuple[Literal["a"]]])
            rows.append(("b",))  # This should generate an argument-type error.


def independent_guard_control() -> None:
    value = (("a",),)[0][0]
    if value == "a":
        row = (value,)
        rows = [row]
        assert_type(rows, list[tuple[Literal["a"]]])
        rows.append(("b",))  # This should generate an argument-type error.
