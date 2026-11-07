# Equal operator results must merge inferred fallback information in either order.
from typing import Literal, assert_type


class Inferred:
    def __add__(self, other: int):
        return ((1,),)


class Declared:
    def __add__(self, other: int) -> tuple[tuple[Literal[1]]]:
        return ((1,),)


def declared_first(value: Declared | Inferred) -> None:
    result = value + 0
    assert_type(result, tuple[tuple[Literal[1]]])
    rows = [result[0]]
    assert_type(rows, list[tuple[Literal[1]] | tuple[int]])
    rows.append((2,))


def inferred_first(value: Inferred | Declared) -> None:
    result = value + 0
    assert_type(result, tuple[tuple[Literal[1]]])
    rows = [result[0]]
    assert_type(rows, list[tuple[int] | tuple[Literal[1]]])
    rows.append((2,))


def declared_only(value: Declared) -> None:
    result = value + 0
    rows = [result[0]]
    assert_type(rows, list[tuple[Literal[1]]])
    rows.append((2,))  # This should generate an argument-type error.


def guarded(value: Declared | Inferred) -> None:
    result = value + 0
    if result[0][0] == 1:
        row = (result[0][0],)
        rows = [row]
        assert_type(rows, list[tuple[Literal[1]]])
        rows.append((2,))  # This should generate an argument-type error.
